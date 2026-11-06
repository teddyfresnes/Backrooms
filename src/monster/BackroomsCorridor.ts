import * as THREE from 'three';
import { BACKROOMS_CORRIDOR as C, corridorPanelZ } from './BacteriaLayout';

const TEXTURES = {
  wallpaper: '/assets/textures/wallpaper/backrooms-wallpaper-seamless.webp',
  carpet: '/assets/textures/carpet/carpet-color-v2.webp',
  ceiling: '/assets/textures/ceiling/ceiling-color.webp',
} as const;

const PANEL_COLOR = new THREE.Color(1.0, 0.95, 0.78);

/**
 * A Level 0 corridor that exists behind the hall door only during the Bacteria
 * encounter. Its surfaces are unlit basic materials shaded by one shared
 * uniform array (one entry per ceiling panel), so the panels can switch on one
 * by one without adding a single light to the stairwell. Two real point lights
 * — present from load, at zero — only exist to light the creature itself.
 */
export class BackroomsCorridor {
  readonly group = new THREE.Group();
  /** Volume to keep clear of exterior props and rain while visible. */
  readonly clearance: THREE.Box3;
  readonly revealLight = new THREE.PointLight(0xfff0c2, 0, 7.5, 1.7);
  readonly chaseLight = new THREE.PointLight(0xfff0c2, 0, 6.5, 1.7);
  private readonly levels: number[] = new Array(C.panelCount).fill(0);
  private readonly targets: number[] = new Array(C.panelCount).fill(0);
  private readonly flicker: number[] = new Array(C.panelCount).fill(0);
  private readonly uniforms = {
    uPanelLevel: { value: this.levels },
    uPanelZ: { value: Array.from({ length: C.panelCount }, (_, index) => corridorPanelZ(index)) },
    uCeilingY: { value: C.floorY + C.height },
  };
  private readonly panelMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private seed = 0x2f6e2b1;
  private time = 0;

  private constructor(textures: Record<keyof typeof TEXTURES, THREE.Texture>, anisotropy: number) {
    this.group.name = 'bacteria-backrooms-corridor';
    this.group.visible = false;
    const length = C.nearZ - C.farZ;
    const width = C.halfWidth * 2;
    const centerZ = (C.nearZ + C.farZ) * 0.5;
    const ceilingY = C.floorY + C.height;

    const surface = (texture: THREE.Texture, repeatX: number, repeatY: number, name: string, gain = 1): THREE.MeshBasicMaterial => {
      const map = texture.clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(repeatX, repeatY);
      map.anisotropy = anisotropy;
      map.colorSpace = THREE.SRGBColorSpace;
      map.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({ map, name });
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uniforms, { uSurfaceGain: { value: gain } });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vCorridorWorld;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvCorridorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
varying vec3 vCorridorWorld;
uniform float uPanelLevel[${C.panelCount}];
uniform float uPanelZ[${C.panelCount}];
uniform float uCeilingY;
uniform float uSurfaceGain;`)
          .replace('#include <map_fragment>', `#include <map_fragment>
float corridorLight = 0.0;
for (int i = 0; i < ${C.panelCount}; i++) {
  vec3 toPanel = vCorridorWorld - vec3(0.0, uCeilingY, uPanelZ[i]);
  corridorLight += uPanelLevel[i] * 2.7 / (1.0 + 0.42 * dot(toPanel, toPanel));
}
diffuseColor.rgb *= vec3(1.0, 0.93, 0.74) * min(corridorLight * uSurfaceGain, 1.3) + vec3(0.006);`);
      };
      material.customProgramCacheKey = () => `bacteria-corridor-light-${gain}`;
      this.disposables.push(map, material);
      return material;
    };

    const plane = (w: number, h: number, material: THREE.Material, name: string, segmentsX = 1, segmentsY = 1): THREE.Mesh => {
      const geometry = new THREE.PlaneGeometry(w, h, segmentsX, segmentsY);
      this.disposables.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      this.group.add(mesh);
      return mesh;
    };

    const floor = plane(width, length, surface(textures.carpet, width / 1.6, length / 1.6, 'corridor-carpet'), 'corridor-floor');
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, C.floorY, centerZ);
    const ceiling = plane(width, length, surface(textures.ceiling, width / 1.2, length / 1.2, 'corridor-ceiling', 0.42), 'corridor-ceiling');
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, ceilingY, centerZ);
    const wallMaterial = surface(textures.wallpaper, length / 1.35, C.height / 1.35, 'corridor-wallpaper');
    for (const side of [-1, 1]) {
      const wall = plane(length, C.height, wallMaterial, `corridor-wall-${side}`);
      wall.rotation.y = side * -Math.PI / 2;
      wall.position.set(side * C.halfWidth, C.floorY + C.height / 2, centerZ);
    }
    const end = plane(width, C.height, surface(textures.wallpaper, width / 1.35, C.height / 1.35, 'corridor-end-wallpaper'), 'corridor-end');
    end.position.set(0, C.floorY + C.height / 2, C.farZ);

    // Exterior skin, so the volume reads as a closed annex from the upper windows.
    const shell = new THREE.MeshLambertMaterial({ color: 0x2b2a26, name: 'corridor-shell' });
    this.disposables.push(shell);
    const roof = plane(width + 0.3, length, shell, 'corridor-roof');
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(0, ceilingY + 0.2, centerZ);
    for (const side of [-1, 1]) {
      const outer = plane(length, C.height + 0.2, shell, `corridor-outer-${side}`);
      outer.rotation.y = side * Math.PI / 2;
      outer.position.set(side * (C.halfWidth + 0.15), C.floorY + (C.height + 0.2) / 2, centerZ);
    }
    const back = plane(width + 0.3, C.height + 0.2, shell, 'corridor-outer-end');
    back.rotation.y = Math.PI;
    back.position.set(0, C.floorY + (C.height + 0.2) / 2, C.farZ - 0.05);

    for (let index = 0; index < C.panelCount; index += 1) {
      const material = new THREE.MeshBasicMaterial({ color: 0x050505, toneMapped: false, name: `corridor-panel-${index}` });
      this.panelMaterials.push(material);
      this.disposables.push(material);
      const panel = plane(0.62, 1.22, material, `corridor-panel-${index}`);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(0, ceilingY - 0.012, corridorPanelZ(index));
    }

    this.revealLight.name = 'bacteria-reveal-light';
    this.revealLight.position.set(0, ceilingY - 0.25, corridorPanelZ(0));
    this.chaseLight.name = 'bacteria-chase-light';
    this.chaseLight.position.set(0, ceilingY - 0.25, corridorPanelZ(0));
    // Lights stay in the scene graph (outside the hidden group) at zero so the
    // stairwell shaders are compiled once with the final light count.
    this.clearance = new THREE.Box3(
      new THREE.Vector3(-C.halfWidth - 0.35, -0.2, C.farZ - 0.4),
      new THREE.Vector3(C.halfWidth + 0.35, ceilingY + 0.45, C.nearZ),
    );
  }

  static async load(renderer: THREE.WebGLRenderer): Promise<BackroomsCorridor> {
    const loader = new THREE.TextureLoader();
    const [wallpaper, carpet, ceiling] = await Promise.all([
      loader.loadAsync(TEXTURES.wallpaper), loader.loadAsync(TEXTURES.carpet), loader.loadAsync(TEXTURES.ceiling),
    ]);
    const corridor = new BackroomsCorridor({ wallpaper, carpet, ceiling }, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    // Each surface owns a clone (own repeat); the decoded sources are no longer needed.
    for (const texture of [wallpaper, carpet, ceiling]) texture.dispose();
    return corridor;
  }

  get lights(): readonly THREE.PointLight[] { return [this.revealLight, this.chaseLight]; }

  /** Back to their corridor posts after the encounter borrowed them elsewhere. */
  resetLightPositions(): void {
    const ceilingY = C.floorY + C.height;
    this.revealLight.position.set(0, ceilingY - 0.25, corridorPanelZ(0));
    this.chaseLight.position.set(0, ceilingY - 0.25, corridorPanelZ(0));
  }

  setVisible(visible: boolean): void { this.group.visible = visible; }
  get isVisible(): boolean { return this.group.visible; }

  /** Switch a panel (0 = farthest). New panels stutter a few times before holding. */
  setPanel(index: number, on: boolean): void {
    if (index < 0 || index >= C.panelCount) return;
    this.targets[index] = on ? 1 : 0;
    this.flicker[index] = on ? 0.55 : 0;
  }

  setAll(on: boolean, instant = false): void {
    for (let index = 0; index < C.panelCount; index += 1) {
      this.targets[index] = on ? 1 : 0;
      this.flicker[index] = 0;
      if (instant) this.levels[index] = on ? 1 : 0;
    }
    this.applyLevels();
  }

  panelLevel(index: number): number { return this.levels[index] ?? 0; }

  /** Brightness of the corridor around a world z (for the creature's tracking light). */
  levelAt(z: number): number {
    let best = 0;
    for (let index = 0; index < C.panelCount; index += 1) {
      const falloff = 1 / (1 + 0.5 * (z - corridorPanelZ(index)) ** 2);
      best = Math.max(best, this.levels[index]! * falloff);
    }
    return best;
  }

  update(delta: number, creatureZ: number | null): void {
    const dt = Math.max(0, Math.min(0.05, delta));
    this.time += dt;
    for (let index = 0; index < C.panelCount; index += 1) {
      const target = this.targets[index]!;
      if (this.flicker[index]! > 0) {
        this.flicker[index] = Math.max(0, this.flicker[index]! - dt);
        this.levels[index] = this.noise() > 0.45 ? target * (0.6 + this.noise() * 0.4) : 0.03;
      } else {
        // A tired tube: rare, short dips once lit.
        const dip = target > 0 && this.noise() < 0.006 ? 0.35 : 1;
        this.levels[index] = THREE.MathUtils.lerp(this.levels[index]!, target * dip, 1 - Math.exp(-dt * 30));
      }
    }
    this.applyLevels();
    this.revealLight.intensity = this.group.visible ? 5.2 * this.levels[0]! : 0;
    if (this.group.visible && creatureZ !== null && creatureZ < C.nearZ + 1.5) {
      const z = THREE.MathUtils.clamp(creatureZ + 0.6, C.farZ + 0.5, C.nearZ - 0.3);
      this.chaseLight.position.z = z;
      this.chaseLight.intensity = 4.4 * this.levelAt(z);
    } else {
      this.chaseLight.intensity = 0;
    }
  }

  private applyLevels(): void {
    for (let index = 0; index < C.panelCount; index += 1) {
      this.panelMaterials[index]!.color.copy(PANEL_COLOR).multiplyScalar(0.02 + this.levels[index]! * 1.55);
    }
  }

  private noise(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.revealLight.removeFromParent();
    this.chaseLight.removeFromParent();
    for (const item of this.disposables) item.dispose();
  }
}
