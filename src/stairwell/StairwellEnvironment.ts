import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { StairwellMaterialSet } from './StairwellMaterials';
import { APARTMENT_ENTRY_DOOR } from '../apartment/layout';
import { SeededRandom } from '../world/SeededRandom';
import {
  batchStaticMeshes,
  disposeObject3D,
  makeBox,
  makeCylinder,
  makeCylinderBetween,
  makeSphere,
  makeTorus,
} from './geometry';
import {
  floorY,
  midLandingY,
  STAIRWELL_BOUNDS,
  STAIRWELL_ENTRANCE_HEIGHT,
  STAIRWELL_ENTRANCE_WIDTH,
  STAIRWELL_FLIGHT_COUNT,
  STAIRWELL_FLOOR_HEIGHT,
  STAIRWELL_FLOOR_FINISH_THICKNESS,
  STAIRWELL_LEFT_FLIGHT,
  STAIRWELL_LEVEL_COUNT,
  STAIRWELL_MAIN_LANDING,
  STAIRWELL_MID_LANDING,
  STAIRWELL_RIGHT_FLIGHT,
  STAIRWELL_ROOF_Y,
  STAIRWELL_STEP_DEPTH,
  STAIRWELL_STEP_RISE,
  STAIRWELL_STEPS_PER_FLIGHT,
  STAIRWELL_WALL_THICKNESS,
  STAIRWELL_WINDOW_HEIGHT,
  STAIRWELL_WINDOW_SILL,
  STAIRWELL_WINDOW_WIDTH,
} from './layout';

interface RainDrop {
  x: number;
  y: number;
  z: number;
  length: number;
  speed: number;
  dx: number;
  dz: number;
  zoneIndex: number;
}

interface RainZone {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface WindowRainShaderState {
  time: { value: number };
}

const addFrameZ = (
  parent: THREE.Object3D,
  name: string,
  centerX: number,
  centerY: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  strip: number,
  material: THREE.Material,
): void => {
  parent.add(
    makeBox(`${name}-left`, [strip, height, depth], [centerX - width * 0.5 + strip * 0.5, centerY, z], material),
    makeBox(`${name}-right`, [strip, height, depth], [centerX + width * 0.5 - strip * 0.5, centerY, z], material),
    makeBox(`${name}-top`, [Math.max(0.02, width - strip * 2), strip, depth], [centerX, centerY + height * 0.5 - strip * 0.5, z], material),
    makeBox(`${name}-bottom`, [Math.max(0.02, width - strip * 2), strip, depth], [centerX, centerY - height * 0.5 + strip * 0.5, z], material),
  );
};

const center = (min: number, max: number): number => (min + max) * 0.5;

const STAIRWELL_WINDOW_MODEL_URL = '/assets/stairwell-window/window.glb';
const STAIRWELL_ENTRANCE_DOOR_MODEL_URL = '/assets/stairwell-hall-door/double_doors_with_windows.glb';
const STAIRWELL_MAILBOX_MODEL_URL = '/assets/stairwell-mailbox/old_soviet_mailbox.glb';
const STAIRWELL_SECOND_FLOOR_TABLE_MODEL_URL = '/assets/stairwell-furniture/soviet_old_table.glb';
const WINDOW_RAIN_NORMAL_URL = '/assets/stairwell-window/raindrop-fx.png';
const STAIRWELL_RANDOM_SEED = 'russian-stairwell-environment:v1';

export class StairwellEnvironment {
  readonly group = new THREE.Group();
  hallEntranceDoor?: THREE.Object3D;
  private readonly importedWindowTemplate?: THREE.Object3D;
  private readonly importedEntranceDoorTemplate?: THREE.Object3D;
  private readonly importedMailboxTemplate?: THREE.Object3D;
  private readonly importedSecondFloorTableTemplate?: THREE.Object3D;
  private readonly windowRainNormalTexture?: THREE.Texture;
  private readonly extraMaterials: THREE.Material[] = [];
  private readonly extraTextures: THREE.Texture[] = [];
  private rainGeometry?: THREE.BufferGeometry;
  private rain?: THREE.LineSegments;
  private readonly rainDrops: RainDrop[] = [];
  private readonly rainZones: RainZone[] = [];
  private readonly windowRainShaders: WindowRainShaderState[] = [];
  private readonly cloudGroups: Array<{ group: THREE.Group; baseX: number; drift: number; phase: number }> = [];
  private readonly skyRandom = new SeededRandom(STAIRWELL_RANDOM_SEED).fork('sky');
  private readonly cloudRandom = new SeededRandom(STAIRWELL_RANDOM_SEED).fork('cloud');
  private readonly rainRandom = new SeededRandom(STAIRWELL_RANDOM_SEED).fork('rain');

  constructor(
    private readonly materials: StairwellMaterialSet,
    importedWindowTemplate?: THREE.Object3D,
    importedEntranceDoorTemplate?: THREE.Object3D,
    importedMailboxTemplate?: THREE.Object3D,
    importedSecondFloorTableTemplate?: THREE.Object3D,
    windowRainNormalTexture?: THREE.Texture,
  ) {
    this.importedWindowTemplate = importedWindowTemplate;
    this.importedEntranceDoorTemplate = importedEntranceDoorTemplate;
    this.importedMailboxTemplate = importedMailboxTemplate;
    this.importedSecondFloorTableTemplate = importedSecondFloorTableTemplate;
    this.windowRainNormalTexture = windowRainNormalTexture;
    if (windowRainNormalTexture) this.extraTextures.push(windowRainNormalTexture);
    this.group.name = 'russian-residential-stairwell-v15';
    this.buildLandingsAndStairs();
    this.buildShell();
    this.buildRailings();
    this.buildFacadeGlazing();
    // Neighbor apartment doors are cloned from the real imported Sketchfab
    // front door after that asset loads; do not build the old procedural doors.
    this.buildUtilities();
    this.buildExteriorDoomer();
    this.buildLighting();
    batchStaticMeshes(this.group);
  }

  private cloneStandardMaterial(
    base: THREE.MeshStandardMaterial,
    name: string,
    overrides: Partial<THREE.MeshStandardMaterialParameters> = {},
  ): THREE.MeshStandardMaterial {
    const material = base.clone();
    material.name = name;
    Object.assign(material, overrides);
    material.needsUpdate = true;
    this.extraMaterials.push(material);
    return material;
  }

  private cloneImportedMaterial(base: THREE.Material): THREE.Material {
    const material = base.clone();
    this.extraMaterials.push(material);
    return material;
  }

  private createExtraBasicMaterial(
    name: string,
    parameters: THREE.MeshBasicMaterialParameters,
  ): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial(parameters);
    material.name = name;
    this.extraMaterials.push(material);
    return material;
  }

  private createExtraStandardMaterial(
    name: string,
    parameters: THREE.MeshStandardMaterialParameters,
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(parameters);
    material.name = name;
    this.extraMaterials.push(material);
    return material;
  }

  private createRainMaterial(): THREE.LineBasicMaterial {
    const material = new THREE.LineBasicMaterial({
      color: 0xa8bfd3,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false,
    });
    material.name = 'doomer-rain';
    this.extraMaterials.push(material);
    return material;
  }

  private installWindowRainShader(material: THREE.MeshStandardMaterial, phase: number): void {
    const rainNormalTexture = this.windowRainNormalTexture;
    if (!rainNormalTexture) return;

    const timeUniform = { value: 0 };
    const phaseUniform = { value: phase };
    this.windowRainShaders.push({ time: timeUniform });

    const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
    const previousProgramCacheKey = material.customProgramCacheKey.bind(material);

    material.onBeforeCompile = (shader, renderer) => {
      previousOnBeforeCompile(shader, renderer);
      shader.uniforms.uWindowRainTime = timeUniform;
      shader.uniforms.uWindowRainPhase = phaseUniform;
      shader.uniforms.uWindowRainNormal = { value: rainNormalTexture };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec2 vWindowRainUv;`,
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>\nvWindowRainUv = uv;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>

uniform float uWindowRainTime;
uniform float uWindowRainPhase;
uniform sampler2D uWindowRainNormal;
varying vec2 vWindowRainUv;

float windowRainHash11(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 windowRainHash22(vec2 p) {
  vec2 q = vec2(
    dot(p, vec2(127.1, 311.7)),
    dot(p, vec2(269.5, 183.3))
  );
  return fract(sin(q) * 43758.5453123);
}

vec3 windowRainLayer(
  vec2 uv,
  float cellScale,
  float phase,
  float moveSpeed,
  float density,
  float elongation
) {
  vec2 p = uv * vec2(cellScale, cellScale * 0.78);
  vec2 id = floor(p);
  vec2 gv = fract(p) - 0.5;
  vec2 rnd = windowRainHash22(id + vec2(phase, phase * 0.37));
  float enabled = step(1.0 - density, rnd.x);
  float moving = step(0.0001, moveSpeed);

  float staticY = (rnd.y - 0.5) * 0.72;
  float movingY = fract(rnd.y + phase * 0.071 - uWindowRainTime * moveSpeed) - 0.5;
  float wiggle = moving * sin(uWindowRainTime * 0.24 + rnd.x * 6.28318 + id.y * 1.71) * 0.055;
  vec2 center = vec2((rnd.x - 0.5) * 0.62 + wiggle, mix(staticY, movingY, moving));
  vec2 delta = gv - center;

  float sizeRnd = windowRainHash11(id + vec2(phase * 1.91, phase * 0.73));
  float radius = mix(0.052, 0.105, sizeRnd);
  float heightScale = mix(1.05, 1.5, elongation) * mix(0.92, 1.18, rnd.y);
  vec2 q = delta / vec2(radius, radius * heightScale);
  float angle = (rnd.x - 0.5) * 0.28;
  float ca = cos(angle);
  float sa = sin(angle);
  q = mat2(ca, -sa, sa, ca) * q;

  float irregular = sin(q.y * 4.7 + rnd.x * 6.28318) * 0.035
    + sin(q.x * 6.1 + rnd.y * 5.17) * 0.022;
  float shape = length(q) + irregular;
  float bead = enabled * (1.0 - smoothstep(0.7, 1.0, shape));

  vec2 spriteUv = clamp(q * 0.43 + 0.5, vec2(0.02), vec2(0.98));
  vec2 spriteNormal = texture2D(uWindowRainNormal, spriteUv).rg * 2.0 - 1.0;
  vec2 rainNormal = spriteNormal * bead;

  float trailLength = mix(0.13, 0.32, rnd.y);
  float trailWave = sin(delta.y * 21.0 + rnd.x * 8.0 + phase) * radius * 0.09;
  float trailX = delta.x - trailWave;
  float trailWidth = radius * mix(0.13, 0.23, rnd.x);
  float trail = moving * enabled
    * (1.0 - smoothstep(trailWidth * 0.35, trailWidth, abs(trailX)))
    * step(0.0, delta.y)
    * (1.0 - smoothstep(trailLength * 0.58, trailLength, delta.y));

  rainNormal.x += -sign(trailX) * trail * 0.16;
  rainNormal.y += trail * 0.035;
  float mask = max(bead, trail * 0.52);
  return vec3(rainNormal, mask);
}

vec3 windowRainSurface(vec2 uv) {
  vec2 warpedUv = uv;
  warpedUv.x += sin(uv.y * 15.0 + uWindowRainPhase) * 0.0025;

  vec3 fineDrops = windowRainLayer(
    warpedUv,
    18.0,
    uWindowRainPhase + 2.3,
    0.0,
    0.58,
    0.08
  );
  vec3 mediumDrops = windowRainLayer(
    warpedUv + vec2(0.173, 0.291),
    10.5,
    uWindowRainPhase + 17.7,
    0.0,
    0.34,
    0.4
  );
  vec3 slowRuns = windowRainLayer(
    warpedUv + vec2(0.087, 0.113),
    3.2,
    uWindowRainPhase + 41.9,
    0.052,
    0.36,
    1.0
  );

  vec3 result = fineDrops + mediumDrops + slowRuns;
  result.xy = clamp(result.xy, vec2(-1.0), vec2(1.0));
  result.z = clamp(result.z, 0.0, 1.0);
  return result;
}`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
vec3 windowRain = windowRainSurface(vWindowRainUv);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.04 + vec3(0.01), windowRain.z * 0.08);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.018, windowRain.z * 0.62);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
normal = normalize(normal + vec3(windowRain.xy * 0.16, 0.0));`,
        );
    };

    material.customProgramCacheKey = () => `${previousProgramCacheKey()}|window-rain-v3`;
    material.needsUpdate = true;
  }

  private buildLandingsAndStairs(): void {
    const mainWidth = STAIRWELL_MAIN_LANDING.maxX - STAIRWELL_MAIN_LANDING.minX;
    const mainDepth = STAIRWELL_MAIN_LANDING.maxZ - STAIRWELL_MAIN_LANDING.minZ;
    const midWidth = STAIRWELL_MID_LANDING.maxX - STAIRWELL_MID_LANDING.minX;
    const midDepth = STAIRWELL_MID_LANDING.maxZ - STAIRWELL_MID_LANDING.minZ;
    const structureThickness = 0.16;

    // Une seule dalle continue au RDC : aucune superposition, aucune couture et aucun z-fighting.
    const groundInset = STAIRWELL_WALL_THICKNESS * 0.45;
    const groundWidth = STAIRWELL_BOUNDS.maxX - STAIRWELL_BOUNDS.minX - groundInset * 2;
    const groundDepth = STAIRWELL_BOUNDS.maxZ - STAIRWELL_BOUNDS.minZ - groundInset * 2;
    const groundCenterZ = center(STAIRWELL_BOUNDS.minZ + groundInset, STAIRWELL_BOUNDS.maxZ - groundInset);
    this.group.add(
      makeBox(
        'ground-floor-structure',
        [groundWidth, structureThickness, groundDepth],
        [0, -STAIRWELL_FLOOR_FINISH_THICKNESS - structureThickness * 0.5, groundCenterZ],
        this.materials.ceiling,
      ),
      makeBox(
        'ground-floor-finish',
        [groundWidth, STAIRWELL_FLOOR_FINISH_THICKNESS, groundDepth],
        // Raise the visible finish slightly to avoid z-fighting on the extended entry area.
        [0, -STAIRWELL_FLOOR_FINISH_THICKNESS * 0.5 + 0.003, groundCenterZ],
        this.materials.landingTerrazzo,
      ),
    );

    // Aux étages, seuls les paliers principaux sont générés séparément.
    for (let level = 1; level < STAIRWELL_LEVEL_COUNT; level += 1) {
      const topY = floorY(level);
      this.group.add(
        makeBox(
          `main-landing-structure-${level}`,
          [mainWidth, structureThickness, mainDepth],
          [0, topY - STAIRWELL_FLOOR_FINISH_THICKNESS - structureThickness * 0.5, center(STAIRWELL_MAIN_LANDING.minZ, STAIRWELL_MAIN_LANDING.maxZ)],
          this.materials.ceiling,
        ),
        makeBox(
          `main-landing-finish-${level}`,
          [mainWidth, STAIRWELL_FLOOR_FINISH_THICKNESS, mainDepth],
          [0, topY - STAIRWELL_FLOOR_FINISH_THICKNESS * 0.5, center(STAIRWELL_MAIN_LANDING.minZ, STAIRWELL_MAIN_LANDING.maxZ)],
          this.materials.landingTerrazzo,
        ),
      );
    }

    const flightRun = STAIRWELL_STEP_DEPTH * STAIRWELL_STEPS_PER_FLIGHT;
    const flightRise = STAIRWELL_STEP_RISE * STAIRWELL_STEPS_PER_FLIGHT;
    const slabLength = Math.hypot(flightRun, flightRise);
    const slabAngle = Math.atan2(flightRise, flightRun);

    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level += 1) {
      const base = floorY(level);
      const mid = midLandingY(level);
      this.group.add(
        makeBox(
          `mid-landing-structure-${level}`,
          [midWidth, structureThickness, midDepth],
          [0, mid - STAIRWELL_FLOOR_FINISH_THICKNESS - structureThickness * 0.5, center(STAIRWELL_MID_LANDING.minZ, STAIRWELL_MID_LANDING.maxZ)],
          this.materials.ceiling,
        ),
        makeBox(
          `mid-landing-finish-${level}`,
          [midWidth, STAIRWELL_FLOOR_FINISH_THICKNESS, midDepth],
          [0, mid - STAIRWELL_FLOOR_FINISH_THICKNESS * 0.5, center(STAIRWELL_MID_LANDING.minZ, STAIRWELL_MID_LANDING.maxZ)],
          this.materials.landingTerrazzo,
        ),
      );

      const leftSlab = makeBox(
        `left-flight-slab-${level}`,
        [STAIRWELL_LEFT_FLIGHT.maxX - STAIRWELL_LEFT_FLIGHT.minX - 0.08, 0.105, slabLength - 0.08],
        [center(STAIRWELL_LEFT_FLIGHT.minX, STAIRWELL_LEFT_FLIGHT.maxX), base + flightRise * 0.5 - 0.105, 0],
        this.materials.slabUnderside,
      );
      leftSlab.rotation.x = -slabAngle;
      const rightSlab = makeBox(
        `right-flight-slab-${level}`,
        [STAIRWELL_RIGHT_FLIGHT.maxX - STAIRWELL_RIGHT_FLIGHT.minX - 0.08, 0.105, slabLength - 0.08],
        [center(STAIRWELL_RIGHT_FLIGHT.minX, STAIRWELL_RIGHT_FLIGHT.maxX), mid + flightRise * 0.5 - 0.105, 0],
        this.materials.slabUnderside,
      );
      rightSlab.rotation.x = slabAngle;

      const curbHeight = 0.34;
      const leftCurb = makeBox(
        `left-flight-central-curb-${level}`,
        [0.17, curbHeight, slabLength - 0.02],
        [-0.075, base + flightRise * 0.5 + 0.035, 0],
        this.materials.stairTerrazzo,
      );
      leftCurb.rotation.x = -slabAngle;
      const rightCurb = makeBox(
        `right-flight-central-curb-${level}`,
        [0.17, curbHeight, slabLength - 0.02],
        [0.075, mid + flightRise * 0.5 + 0.035, 0],
        this.materials.stairTerrazzo,
      );
      rightCurb.rotation.x = slabAngle;
      this.group.add(leftSlab, rightSlab, leftCurb, rightCurb);

      for (let step = 0; step < STAIRWELL_STEPS_PER_FLIGHT; step += 1) {
        const leftTop = base + STAIRWELL_STEP_RISE * (step + 1);
        const leftZ = STAIRWELL_LEFT_FLIGHT.minZ + STAIRWELL_STEP_DEPTH * (step + 0.5);
        this.group.add(makeBox(
          `left-flight-${level}-step-${step}`,
          [STAIRWELL_LEFT_FLIGHT.maxX - STAIRWELL_LEFT_FLIGHT.minX, STAIRWELL_STEP_RISE, STAIRWELL_STEP_DEPTH],
          [center(STAIRWELL_LEFT_FLIGHT.minX, STAIRWELL_LEFT_FLIGHT.maxX), leftTop - STAIRWELL_STEP_RISE * 0.5, leftZ],
          this.materials.stairTerrazzo,
        ));

        const rightTop = mid + STAIRWELL_STEP_RISE * (step + 1);
        const rightZ = STAIRWELL_RIGHT_FLIGHT.maxZ - STAIRWELL_STEP_DEPTH * (step + 0.5);
        this.group.add(makeBox(
          `right-flight-${level}-step-${step}`,
          [STAIRWELL_RIGHT_FLIGHT.maxX - STAIRWELL_RIGHT_FLIGHT.minX, STAIRWELL_STEP_RISE, STAIRWELL_STEP_DEPTH],
          [center(STAIRWELL_RIGHT_FLIGHT.minX, STAIRWELL_RIGHT_FLIGHT.maxX), rightTop - STAIRWELL_STEP_RISE * 0.5, rightZ],
          this.materials.stairTerrazzo,
        ));
      }
    }
  }

  private buildShell(): void {
    const width = STAIRWELL_BOUNDS.maxX - STAIRWELL_BOUNDS.minX;
    const depth = STAIRWELL_BOUNDS.maxZ - STAIRWELL_BOUNDS.minZ;
    const wall = STAIRWELL_WALL_THICKNESS;

    const openingMinZ = APARTMENT_ENTRY_DOOR.centerZ - APARTMENT_ENTRY_DOOR.width * 0.5;
    const openingMaxZ = APARTMENT_ENTRY_DOOR.centerZ + APARTMENT_ENTRY_DOOR.width * 0.5;
    const southDepth = openingMinZ - STAIRWELL_BOUNDS.minZ;
    const northDepth = STAIRWELL_BOUNDS.maxZ - openingMaxZ;
    const openingBottom = APARTMENT_ENTRY_DOOR.bottom;
    const openingTop = APARTMENT_ENTRY_DOOR.bottom + APARTMENT_ENTRY_DOOR.height;

    // Every apartment entrance uses the same wall reveal as the real imported
    // front door. Previously the seven decorative copies were pasted in front
    // of an uncut wall, which made their outer frame protrude into the landing.
    // Split both long walls around the doorway on every floor instead.
    const addApartmentDoorWall = (side: 'west' | 'east', level: number): void => {
      const x = side === 'west' ? STAIRWELL_BOUNDS.minX : STAIRWELL_BOUNDS.maxX;
      const baseY = floorY(level);
      const levelHeight = Math.min(STAIRWELL_FLOOR_HEIGHT, STAIRWELL_ROOF_Y - baseY);
      const prefix = `${side}-wall-shell-${level}`;

      this.group.add(
        makeBox(`${prefix}-south`, [wall, levelHeight, southDepth], [x, baseY + levelHeight * 0.5, STAIRWELL_BOUNDS.minZ + southDepth * 0.5], this.materials.upperPlaster),
        makeBox(`${prefix}-north`, [wall, levelHeight, northDepth], [x, baseY + levelHeight * 0.5, openingMaxZ + northDepth * 0.5], this.materials.upperPlaster),
      );

      if (openingBottom > 0.001) {
        this.group.add(makeBox(
          `${prefix}-threshold-wall`,
          [wall, openingBottom, APARTMENT_ENTRY_DOOR.width],
          [x, baseY + openingBottom * 0.5, APARTMENT_ENTRY_DOOR.centerZ],
          this.materials.upperPlaster,
        ));
      }

      const headerHeight = Math.max(0, levelHeight - openingTop);
      // Keep the masonry lintel above every entrance, including the player's
      // real apartment door. The frame itself now uses a stable depth-biased
      // front-sided material, so the wall no longer needs to be deleted as a
      // workaround for the blinking upper trim.
      if (headerHeight > 0.001) {
        this.group.add(makeBox(
          `${prefix}-header`,
          [wall, headerHeight, APARTMENT_ENTRY_DOOR.width],
          [x, baseY + openingTop + headerHeight * 0.5, APARTMENT_ENTRY_DOOR.centerZ],
          this.materials.upperPlaster,
        ));
      }
    };

    for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level += 1) {
      addApartmentDoorWall('west', level);
      addApartmentDoorWall('east', level);
    }

    this.group.add(
      makeBox('north-wall-shell', [width, STAIRWELL_ROOF_Y, wall], [0, STAIRWELL_ROOF_Y * 0.5, STAIRWELL_BOUNDS.maxZ], this.materials.upperPlaster),
      // Keep the roof aligned with the now deeper south/window side shell.
      makeBox('roof-slab', [width, 0.22, depth], [0, STAIRWELL_ROOF_Y + 0.11, center(STAIRWELL_BOUNDS.minZ, STAIRWELL_BOUNDS.maxZ)], this.materials.ceiling),
    );

    const groundSideWidth = (width - STAIRWELL_ENTRANCE_WIDTH) * 0.5;
    this.group.add(
      makeBox('south-ground-left', [groundSideWidth, 2.88, wall], [STAIRWELL_BOUNDS.minX + groundSideWidth * 0.5, 1.44, STAIRWELL_BOUNDS.minZ], this.materials.upperPlaster),
      makeBox('south-ground-right', [groundSideWidth, 2.88, wall], [STAIRWELL_BOUNDS.maxX - groundSideWidth * 0.5, 1.44, STAIRWELL_BOUNDS.minZ], this.materials.upperPlaster),
      makeBox('south-ground-above-entry', [STAIRWELL_ENTRANCE_WIDTH, 2.88 - STAIRWELL_ENTRANCE_HEIGHT, wall], [0, STAIRWELL_ENTRANCE_HEIGHT + (2.88 - STAIRWELL_ENTRANCE_HEIGHT) * 0.5, STAIRWELL_BOUNDS.minZ], this.materials.upperPlaster),
    );

    const windowSideWidth = (width - STAIRWELL_WINDOW_WIDTH) * 0.5;
    for (let level = 1; level < STAIRWELL_LEVEL_COUNT; level += 1) {
      const base = floorY(level);
      const bottom = base + STAIRWELL_WINDOW_SILL;
      const top = bottom + STAIRWELL_WINDOW_HEIGHT;
      this.group.add(
        makeBox(`south-window-left-${level}`, [windowSideWidth, 2.88, wall], [STAIRWELL_BOUNDS.minX + windowSideWidth * 0.5, base + 1.44, STAIRWELL_BOUNDS.minZ], this.materials.upperPlaster),
        makeBox(`south-window-right-${level}`, [windowSideWidth, 2.88, wall], [STAIRWELL_BOUNDS.maxX - windowSideWidth * 0.5, base + 1.44, STAIRWELL_BOUNDS.minZ], this.materials.upperPlaster),
        makeBox(`south-window-below-${level}`, [STAIRWELL_WINDOW_WIDTH, bottom - base, wall], [0, base + (bottom - base) * 0.5, STAIRWELL_BOUNDS.minZ], this.materials.upperPlaster),
        makeBox(`south-window-above-${level}`, [STAIRWELL_WINDOW_WIDTH, base + 2.88 - top, wall], [0, top + (base + 2.88 - top) * 0.5, STAIRWELL_BOUNDS.minZ], this.materials.upperPlaster),
      );
    }

    this.buildPaintBand();
  }

  private buildPaintBand(): void {
    const wall = STAIRWELL_WALL_THICKNESS;
    const paintHeight = 1.16;
    const horizontalPaintHeight = 0.98;
    const horizontalUpOverlap = 0.18;
    const diagonalPaintHeight = 0.86;
    const thin = 0.024;
    const sideInset = 0.02;
    const westX = STAIRWELL_BOUNDS.minX + wall * 0.5 + thin * 0.5;
    const eastX = STAIRWELL_BOUNDS.maxX - wall * 0.5 - thin * 0.5;
    const southZ = STAIRWELL_BOUNDS.minZ + wall * 0.5 + thin * 0.5;
    const northZ = STAIRWELL_BOUNDS.maxZ - wall * 0.5 - thin * 0.5;
    const shortWallInset = 0.02;

    // Bordures latérales sur les longs côtés : cette partie était déjà correcte.
    for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level += 1) {
      const mainMinZ = STAIRWELL_MAIN_LANDING.minZ + sideInset;
      const mainMaxZ = STAIRWELL_MAIN_LANDING.maxZ - sideInset;
      const mainY = floorY(level) + horizontalPaintHeight * 0.5;
      // The green lower-wall paint is a thin mesh sitting on top of the plaster.
      // Cut it around *every* apartment frame too; otherwise it overlays the
      // recessed door/frame and creates the same pasted-on / flickering look.
      const paintOpeningMinZ = APARTMENT_ENTRY_DOOR.centerZ - APARTMENT_ENTRY_DOOR.width * 0.5 - 0.06;
      const paintOpeningMaxZ = APARTMENT_ENTRY_DOOR.centerZ + APARTMENT_ENTRY_DOOR.width * 0.5 + 0.06;
      const southStart = mainMinZ;
      const southEnd = Math.min(mainMaxZ, paintOpeningMinZ);
      const northStart = Math.max(mainMinZ, paintOpeningMaxZ);
      const northEnd = mainMaxZ;
      const horizontalStairOverlap = 0.28;
      const longSidePaint: THREE.Mesh[] = [];
      for (const [side, x] of [['west', westX], ['east', eastX]] as const) {
        if (southEnd > southStart) longSidePaint.push(makeBox(
          `${side}-paint-main-${level}-south`,
          [thin, horizontalPaintHeight, southEnd - southStart],
          [x, mainY, center(southStart, southEnd)],
          this.materials.lowerPaint,
        ));

        // Extend the flat green band horizontally beyond the landing toward the
        // stair so it overlaps the diagonal stair band. The west side is the
        // player-apartment side and gets this on every level; at level 0 the
        // opposite side gets it too to cover the bottom-of-stairs condition.
        const extendTowardStairs = (side === 'west' && level < STAIRWELL_LEVEL_COUNT - 1) || level === 0;
        const sideNorthEnd = northEnd + (extendTowardStairs ? horizontalStairOverlap : 0);
        if (sideNorthEnd > northStart) longSidePaint.push(makeBox(
          `${side}-paint-main-${level}-north`,
          [thin, horizontalPaintHeight, sideNorthEnd - northStart],
          [x, mainY, center(northStart, sideNorthEnd)],
          this.materials.lowerPaint,
        ));
      }
      this.group.add(...longSidePaint);

      // Sur la façade sud, la bordure ne doit jamais passer devant les vitrages.
      // On la découpe donc en deux segments latéraux de part et d'autre de l'ouverture.
      const southOpeningWidth = level === 0 ? STAIRWELL_ENTRANCE_WIDTH : STAIRWELL_WINDOW_WIDTH;
      const mainWidth = (STAIRWELL_MAIN_LANDING.maxX - shortWallInset) - (STAIRWELL_MAIN_LANDING.minX + shortWallInset);
      const southSideSegmentWidth = Math.max(0.08, (mainWidth - southOpeningWidth) * 0.5);
      const southSegmentOffset = southOpeningWidth * 0.5 + southSideSegmentWidth * 0.5;
      const southPaintMeshes = [
        makeBox(`south-paint-main-left-${level}`, [southSideSegmentWidth, horizontalPaintHeight, thin], [-southSegmentOffset, mainY, southZ], this.materials.lowerPaint),
        makeBox(`south-paint-main-right-${level}`, [southSideSegmentWidth, horizontalPaintHeight, thin], [southSegmentOffset, mainY, southZ], this.materials.lowerPaint),
      ];
      if (level > 0) {
        const windowBottomPaintHeight = Math.min(horizontalPaintHeight, STAIRWELL_WINDOW_SILL + 0.06);
        southPaintMeshes.push(
          makeBox(`south-paint-below-window-${level}`, [southOpeningWidth + 0.06, windowBottomPaintHeight, thin], [0, floorY(level) + windowBottomPaintHeight * 0.5, southZ], this.materials.lowerPaint),
        );
      }
      this.group.add(...southPaintMeshes);

      if (level < STAIRWELL_FLIGHT_COUNT) {
        const midMinZ = STAIRWELL_MID_LANDING.minZ + sideInset;
        const midMaxZ = STAIRWELL_MID_LANDING.maxZ - sideInset;
        const midCenterZ = center(midMinZ, midMaxZ);
        const midDepth = midMaxZ - midMinZ;
        const midY = midLandingY(level) + horizontalPaintHeight * 0.5;
        this.group.add(
          makeBox(`west-paint-mid-${level}`, [thin, horizontalPaintHeight, midDepth], [westX, midY, midCenterZ], this.materials.lowerPaint),
          makeBox(
            `east-paint-mid-${level}`,
            [thin, horizontalPaintHeight, midDepth + horizontalUpOverlap],
            [eastX, midY, midCenterZ - horizontalUpOverlap * 0.5],
            this.materials.lowerPaint,
          ),
        );

        // Sur le petit côté concerné du demi-palier : on garde la bordure côté mur opposé.
        const midWidth = (STAIRWELL_MID_LANDING.maxX - shortWallInset) - (STAIRWELL_MID_LANDING.minX + shortWallInset);
        this.group.add(
          makeBox(`north-paint-mid-${level}`, [midWidth, horizontalPaintHeight, thin], [0, midY, northZ], this.materials.lowerPaint),
        );
      }
    }

    // On conserve la bordure en diagonale le long des volées d'escalier.
    const flightRun = STAIRWELL_STEP_DEPTH * STAIRWELL_STEPS_PER_FLIGHT;
    const flightRise = STAIRWELL_STEP_RISE * STAIRWELL_STEPS_PER_FLIGHT;
    const slabLength = Math.hypot(flightRun, flightRise);
    const slabAngle = Math.atan2(flightRise, flightRun);
    const topOnlyExtension = 0.34;
    const diagonalReduction = paintHeight - diagonalPaintHeight;
    const diagonalCenterLift = diagonalReduction * 0.5;
    const diagonalLiftY = Math.cos(slabAngle) * diagonalCenterLift;
    const diagonalLiftZ = Math.sin(slabAngle) * diagonalCenterLift;
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level += 1) {
      const base = floorY(level);
      const mid = midLandingY(level);
      const leftPanel = makeBox(
        `west-slope-paint-${level}`,
        [thin, diagonalPaintHeight, slabLength + topOnlyExtension],
        [
          westX,
          base + flightRise * 0.5 + paintHeight * 0.34 + diagonalLiftY,
          topOnlyExtension * 0.5 - diagonalLiftZ,
        ],
        this.materials.lowerPaint,
      );
      leftPanel.rotation.x = -slabAngle;
      const rightPanel = makeBox(
        `east-slope-paint-${level}`,
        [thin, diagonalPaintHeight, slabLength + topOnlyExtension],
        [
          eastX,
          mid + flightRise * 0.5 + paintHeight * 0.34 + diagonalLiftY,
          -topOnlyExtension * 0.5 + diagonalLiftZ,
        ],
        this.materials.lowerPaint,
      );
      rightPanel.rotation.x = slabAngle;
      this.group.add(leftPanel, rightPanel);
    }
  }

  private buildRailings(): void {
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level += 1) {
      const base = floorY(level);
      const mid = midLandingY(level);
      this.addFlightRailing(
        `left-railing-${level}`,
        -0.075,
        (step) => STAIRWELL_LEFT_FLIGHT.minZ + STAIRWELL_STEP_DEPTH * (step + 0.5),
        (step) => base + STAIRWELL_STEP_RISE * (step + 1),
      );
      this.addFlightRailing(
        `right-railing-${level}`,
        0.075,
        (step) => STAIRWELL_RIGHT_FLIGHT.maxZ - STAIRWELL_STEP_DEPTH * (step + 0.5),
        (step) => mid + STAIRWELL_STEP_RISE * (step + 1),
      );
    }
  }

  private addFlightRailing(
    name: string,
    x: number,
    zAt: (step: number) => number,
    topAt: (step: number) => number,
  ): void {
    const firstStep = 0;
    const lastStep = STAIRWELL_STEPS_PER_FLIGHT - 1;
    const curbTop = 0.2;
    const railTop = 0.96;
    const midRail = 0.58;
    const firstHand = new THREE.Vector3(x, topAt(firstStep) + railTop, zAt(firstStep));
    const lastHand = new THREE.Vector3(x, topAt(lastStep) + railTop, zAt(lastStep));
    const firstMid = new THREE.Vector3(x, topAt(firstStep) + midRail, zAt(firstStep));
    const lastMid = new THREE.Vector3(x, topAt(lastStep) + midRail, zAt(lastStep));
    this.group.add(
      makeCylinderBetween(`${name}-handrail`, firstHand, lastHand, 0.032, this.materials.railing, 10),
      makeCylinderBetween(`${name}-midrail`, firstMid, lastMid, 0.019, this.materials.railing, 8),
    );

    const postSteps = [0, 2, 4, 6, 7];
    for (const step of postSteps) {
      const bottom = topAt(step) + curbTop;
      const top = topAt(step) + railTop;
      this.group.add(makeCylinder(
        `${name}-post-${step}`,
        0.023,
        top - bottom,
        [x, (bottom + top) * 0.5, zAt(step)],
        this.materials.railing,
        8,
      ));
    }
  }

  private buildFacadeGlazing(): void {
    const wallFaceZ = STAIRWELL_BOUNDS.minZ + STAIRWELL_WALL_THICKNESS * 0.5;
    this.buildEntrance(wallFaceZ);

    for (let level = 1; level < STAIRWELL_LEVEL_COUNT; level += 1) {
      const bottom = floorY(level) + STAIRWELL_WINDOW_SILL;
      const centerY = bottom + STAIRWELL_WINDOW_HEIGHT * 0.5;
      this.buildResidentialWindow(`south-window-${level}`, 0, centerY, wallFaceZ, STAIRWELL_WINDOW_WIDTH, STAIRWELL_WINDOW_HEIGHT);
    }

    this.addSecondFloorWindowTable(wallFaceZ);
  }

  private buildResidentialWindow(
    name: string,
    centerX: number,
    centerY: number,
    wallFaceZ: number,
    width: number,
    height: number,
  ): void {
    const template = this.importedWindowTemplate;
    if (!template) return;

    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    if (sourceSize.x <= 0.0001 || sourceSize.y <= 0.0001 || sourceSize.z <= 0.0001) return;

    const window = template.clone(true);
    window.name = `${name}-imported-window`;

    // Fit the user-supplied window model into the hall opening with a small
    // overlap so it hides the edge of the masonry cleanly.
    // Fit the imported frame inside the opening instead of overlapping it.
    const targetWidth = width - 0.04;
    const targetHeight = height - 0.04;
    const scaleX = targetWidth / sourceSize.x;
    const scaleY = targetHeight / sourceSize.y;
    // The source asset is proportionally much wider than the wall opening once
    // constrained by height. Fit X/Y independently so the frame actually hugs
    // the masonry instead of leaving large side gaps.
    window.scale.set(scaleX, scaleY, scaleX);
    window.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(window);
    const scaledCenter = bounds.getCenter(new THREE.Vector3());
    // Recess the window slightly toward the exterior so it does not stick out so much inside the hall.
    const targetZ = wallFaceZ - 0.028;
    window.position.set(
      centerX - scaledCenter.x,
      centerY - 0.005 - scaledCenter.y,
      targetZ - scaledCenter.z,
    );

    let glassMaterialIndex = 0;
    const rainSeed = [...name].reduce((hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0, 5381) % 997;

    window.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      const tuneMaterial = (material: THREE.Material): THREE.Material => {
        const clone = this.cloneImportedMaterial(material);
        const materialName = (clone.name ?? '').toLowerCase();
        const objectName = (object.name ?? '').toLowerCase();
        if (materialName.includes('glass') || objectName.includes('glass')) {
          clone.transparent = true;
          clone.opacity = 0.2;
          clone.depthWrite = false;
          clone.depthTest = true;
          clone.side = THREE.DoubleSide;
          if (clone instanceof THREE.MeshStandardMaterial) {
            clone.color = new THREE.Color(0xd7e4ef);
            clone.roughness = 0.055;
            clone.metalness = 0;
            if (clone instanceof THREE.MeshPhysicalMaterial) {
              // Physical transmission gives the rain-normal perturbation a subtle refraction
              // without an extra screen-space pass. Keep opacity at 1 as required by Three.js.
              clone.opacity = 1;
              clone.transmission = 0.72;
              clone.thickness = 0.028;
              clone.ior = 1.42;
            }
            this.installWindowRainShader(clone, rainSeed * 0.071 + glassMaterialIndex * 13.37);
            glassMaterialIndex += 1;
          }
        } else {
          clone.depthWrite = true;
          clone.depthTest = true;
        }
        clone.needsUpdate = true;
        return clone;
      };
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => tuneMaterial(material));
      } else {
        mesh.material = tuneMaterial(mesh.material);
      }
    });

    this.group.add(window);
  }

  static async loadImportedWindowTemplate(): Promise<THREE.Object3D | undefined> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(STAIRWELL_WINDOW_MODEL_URL);
    const root = gltf.scene || gltf.scenes[0];
    if (!root) return undefined;
    root.name = 'stairwell-window-template';
    root.updateMatrixWorld(true);
    return root;
  }

  static async loadEntranceDoorTemplate(): Promise<THREE.Object3D | undefined> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(STAIRWELL_ENTRANCE_DOOR_MODEL_URL);
    const root = gltf.scene || gltf.scenes[0];
    if (!root) return undefined;
    root.name = 'stairwell-entrance-door-template';
    root.updateMatrixWorld(true);
    return root;
  }

  static async loadMailboxTemplate(): Promise<THREE.Object3D | undefined> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(STAIRWELL_MAILBOX_MODEL_URL);
    const root = gltf.scene || gltf.scenes[0];
    if (!root) return undefined;
    root.name = 'stairwell-mailbox-template';
    root.updateMatrixWorld(true);
    return root;
  }

  static async loadSecondFloorTableTemplate(): Promise<THREE.Object3D | undefined> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(STAIRWELL_SECOND_FLOOR_TABLE_MODEL_URL);
    const root = gltf.scene || gltf.scenes[0];
    if (!root) return undefined;
    root.name = 'stairwell-second-floor-table-template';
    root.updateMatrixWorld(true);
    return root;
  }

  private addSecondFloorWindowTable(wallFaceZ: number): void {
    const template = this.importedSecondFloorTableTemplate;
    if (!template) return;

    const table = template.clone(true);
    table.name = 'second-floor-window-table';
    // Turn the long side of the furniture parallel to the window wall.
    // Give the furniture a slight natural angle so it does not look perfectly spawned.
    table.rotation.y = Math.PI * 0.42;

    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    if (sourceSize.x <= 0.0001 || sourceSize.y <= 0.0001 || sourceSize.z <= 0.0001) return;

    const targetWidth = 1.55;
    const targetHeight = 0.96;
    const uniformScale = Math.min(targetWidth / sourceSize.z, targetHeight / sourceSize.y);
    table.scale.setScalar(uniformScale);
    table.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(table);
    const centerPoint = bounds.getCenter(new THREE.Vector3());
    const targetCenterX = -0.42;
    const targetMinY = floorY(2);
    const targetCenterZ = STAIRWELL_MAIN_LANDING.minZ + 0.64;
    table.position.set(
      targetCenterX - centerPoint.x,
      targetMinY - bounds.min.y,
      targetCenterZ - centerPoint.z,
    );

    table.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => {
          const clone = this.cloneImportedMaterial(material);
          clone.depthWrite = true;
          clone.depthTest = true;
          clone.needsUpdate = true;
          return clone;
        });
      } else {
        const clone = this.cloneImportedMaterial(mesh.material);
        clone.depthWrite = true;
        clone.depthTest = true;
        clone.needsUpdate = true;
        mesh.material = clone;
      }
    });

    this.group.add(table);
  }

  private buildEntrance(wallFaceZ: number): void {
    // Keep the widened masonry returns and threshold, but replace the old
    // procedural glazed hall door completely with the user-provided model.
    const revealDepth = 0.34;
    const revealZ = wallFaceZ + revealDepth * 0.5;
    this.group.add(
      makeBox('entrance-reveal-left', [0.1, STAIRWELL_ENTRANCE_HEIGHT + 0.08, revealDepth], [-STAIRWELL_ENTRANCE_WIDTH * 0.5 + 0.05, STAIRWELL_ENTRANCE_HEIGHT * 0.5, revealZ], this.materials.upperPlaster),
      makeBox('entrance-reveal-right', [0.1, STAIRWELL_ENTRANCE_HEIGHT + 0.08, revealDepth], [STAIRWELL_ENTRANCE_WIDTH * 0.5 - 0.05, STAIRWELL_ENTRANCE_HEIGHT * 0.5, revealZ], this.materials.upperPlaster),
      makeBox('entrance-reveal-top', [Math.max(0.2, STAIRWELL_ENTRANCE_WIDTH - 0.2), 0.1, revealDepth], [0, STAIRWELL_ENTRANCE_HEIGHT - 0.05, revealZ], this.materials.upperPlaster),
    );

    const thresholdZ = wallFaceZ + 0.12;
    this.group.add(
      makeBox('entrance-threshold', [STAIRWELL_ENTRANCE_WIDTH + 0.08, 0.04, 0.24], [0, 0.02, thresholdZ], this.materials.landingTerrazzo),
      makeBox('entrance-step-nose', [STAIRWELL_ENTRANCE_WIDTH + 0.04, 0.018, 0.08], [0, -0.009, wallFaceZ + 0.18], this.materials.landingTerrazzo),
    );

    const template = this.importedEntranceDoorTemplate;
    if (!template) return;

    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    if (sourceSize.x <= 0.0001 || sourceSize.y <= 0.0001 || sourceSize.z <= 0.0001) return;

    const hallDoor = template.clone(true);
    hallDoor.name = 'hall-entrance-door-imported';
    this.markHierarchyNoBatch(hallDoor);

    // Match the stairwell opening as closely as possible. The provided model is
    // used as the complete replacement, so non-uniform scaling is acceptable to
    // make it fill the aperture cleanly.
    const targetWidth = STAIRWELL_ENTRANCE_WIDTH - 0.04;
    const targetHeight = STAIRWELL_ENTRANCE_HEIGHT - 0.06;
    const scaleX = targetWidth / sourceSize.x;
    const scaleY = targetHeight / sourceSize.y;
    const scaleZ = scaleX;
    hallDoor.scale.set(scaleX, scaleY, scaleZ);
    hallDoor.updateMatrixWorld(true);

    const doorBounds = new THREE.Box3().setFromObject(hallDoor);
    const doorCenter = doorBounds.getCenter(new THREE.Vector3());
    const doorSize = doorBounds.getSize(new THREE.Vector3());
    const targetCenterY = doorSize.y * 0.5;
    const targetCenterZ = wallFaceZ + 0.072;
    hallDoor.position.set(
      -doorCenter.x,
      targetCenterY - doorCenter.y,
      targetCenterZ - doorCenter.z,
    );

    hallDoor.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => {
          const clone = this.cloneImportedMaterial(material);
          clone.depthWrite = true;
          clone.depthTest = true;
          clone.needsUpdate = true;
          return clone;
        });
      } else {
        const clone = this.cloneImportedMaterial(mesh.material);
        clone.depthWrite = true;
        clone.depthTest = true;
        clone.needsUpdate = true;
        mesh.material = clone;
      }
    });

    this.hallEntranceDoor = hallDoor;
    this.group.add(hallDoor);
    this.addEntranceMailbox(wallFaceZ);
  }

  private addEntranceMailbox(wallFaceZ: number): void {
    const template = this.importedMailboxTemplate;
    if (!template) return;

    const mailbox = template.clone(true);
    mailbox.name = 'hall-entrance-mailbox';
    // Put it on the visible wall of the entrance hall, large and almost flush.
    mailbox.rotation.y = -Math.PI * 0.5;

    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    if (sourceSize.x <= 0.0001 || sourceSize.y <= 0.0001 || sourceSize.z <= 0.0001) return;

    const targetLength = 1.95;
    const targetHeight = 1.38;
    const uniformScale = Math.min(targetLength / sourceSize.x, targetHeight / sourceSize.y);
    mailbox.scale.setScalar(uniformScale);
    mailbox.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(mailbox);
    const centerPoint = bounds.getCenter(new THREE.Vector3());
    const interiorFaceX = STAIRWELL_BOUNDS.maxX - STAIRWELL_WALL_THICKNESS;
    const targetMaxX = interiorFaceX - 0.006;
    const targetCenterY = 1.42;
    const targetCenterZ = wallFaceZ + 1.18;
    mailbox.position.set(
      targetMaxX - bounds.max.x,
      targetCenterY - centerPoint.y,
      targetCenterZ - centerPoint.z,
    );

    mailbox.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => {
          const clone = this.cloneImportedMaterial(material);
          clone.depthWrite = true;
          clone.depthTest = true;
          clone.needsUpdate = true;
          return clone;
        });
      } else {
        const clone = this.cloneImportedMaterial(mesh.material);
        clone.depthWrite = true;
        clone.depthTest = true;
        clone.needsUpdate = true;
        mesh.material = clone;
      }
    });

    this.group.add(mailbox);
  }

  private buildUtilities(): void {
    const z = STAIRWELL_BOUNDS.maxZ - STAIRWELL_WALL_THICKNESS * 0.5 - 0.08;
    const pipeBottom = 0.28;
    const pipeTop = STAIRWELL_ROOF_Y - 0.35;
    const pipeXs = [1.54, 1.72];
    for (const [index, x] of pipeXs.entries()) {
      this.group.add(makeCylinder(`heating-riser-${index}`, 0.036, pipeTop - pipeBottom, [x, (pipeBottom + pipeTop) * 0.5, z], this.materials.pipe, 12));
      for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level += 1) {
        const clampY = floorY(level) + 0.72;
        this.group.add(
          makeCylinder(`heating-collar-${index}-${level}`, 0.052, 0.032, [x, clampY, z], this.materials.galvanized, 12),
          makeBox(`heating-bracket-${index}-${level}`, [0.11, 0.035, 0.1], [x, clampY, z + 0.055], this.materials.galvanized),
        );
      }
    }

    const branchY = 0.62;
    const branchEndX = 1.08;
    this.group.add(
      makeCylinderBetween('heating-branch', new THREE.Vector3(pipeXs[0]!, branchY, z), new THREE.Vector3(branchEndX, branchY, z), 0.032, this.materials.pipe, 12),
      makeSphere('heating-branch-junction', 0.048, [pipeXs[0]!, branchY, z], this.materials.pipe, 10),
      makeCylinderBetween('heating-valve-stem', new THREE.Vector3(branchEndX, branchY, z), new THREE.Vector3(branchEndX - 0.13, branchY, z), 0.021, this.materials.galvanized, 10),
      makeTorus('heating-valve-wheel', 0.085, 0.012, [branchEndX - 0.17, branchY, z - 0.005], [0, 0, 0], this.materials.galvanized, 8, 20),
    );

    for (const [index, x] of pipeXs.entries()) {
      const endX = x - 0.34 - index * 0.05;
      this.group.add(
        makeCylinderBetween(`heating-top-run-${index}`, new THREE.Vector3(x, pipeTop, z), new THREE.Vector3(endX, pipeTop, z), 0.032, this.materials.pipe, 12),
        makeSphere(`heating-top-junction-${index}`, 0.046, [x, pipeTop, z], this.materials.pipe, 10),
      );
    }
  }

  private buildExteriorDoomer(): void {
    const wallFaceZ = STAIRWELL_BOUNDS.minZ - 0.02;
    const fogTint = 0x5d666f;

    const asphalt = this.cloneStandardMaterial(this.materials.ceiling, 'exterior-asphalt', {
      color: new THREE.Color(0x23292f),
      roughness: 0.93,
      metalness: 0.02,
      normalScale: new THREE.Vector2(0.28, 0.28),
    });
    const asphaltWet = this.cloneStandardMaterial(asphalt, 'exterior-asphalt-wet', {
      color: new THREE.Color(0x1a2026),
      roughness: 0.42,
      metalness: 0.08,
      normalScale: new THREE.Vector2(0.24, 0.24),
    });
    const sidewalk = this.cloneStandardMaterial(this.materials.ceiling, 'exterior-sidewalk', {
      color: new THREE.Color(0x676b6e),
      roughness: 0.88,
      metalness: 0,
      normalScale: new THREE.Vector2(0.18, 0.18),
    });
    const facade = this.cloneStandardMaterial(this.materials.upperPlaster, 'exterior-facade', {
      color: new THREE.Color(0x697177),
      roughness: 0.95,
      metalness: 0,
      normalScale: new THREE.Vector2(0.14, 0.14),
    });
    const facadeAccent = this.cloneStandardMaterial(this.materials.upperPlaster, 'exterior-facade-accent', {
      color: new THREE.Color(0x596168),
      roughness: 0.97,
      metalness: 0,
      normalScale: new THREE.Vector2(0.1, 0.1),
    });
    const distantFacade = this.cloneStandardMaterial(this.materials.upperPlaster, 'exterior-distant-facade', {
      color: new THREE.Color(0x465059),
      roughness: 0.98,
      metalness: 0,
      normalScale: new THREE.Vector2(0.06, 0.06),
    });
    const roof = this.cloneStandardMaterial(this.materials.frameMetal, 'exterior-roof', {
      color: new THREE.Color(0x52585d),
      roughness: 0.84,
      metalness: 0.14,
      normalScale: new THREE.Vector2(0.08, 0.08),
    });
    const wetMetal = this.cloneStandardMaterial(this.materials.frameMetal, 'exterior-wet-metal', {
      color: new THREE.Color(0x70767b),
      roughness: 0.58,
      metalness: 0.42,
      normalScale: new THREE.Vector2(0.12, 0.12),
    });
    const puddle = this.createExtraStandardMaterial('exterior-puddle', {
      color: 0x1a2025,
      roughness: 0.09,
      metalness: 0.06,
      transparent: true,
      opacity: 0.92,
    });
    const darkWindow = this.createExtraStandardMaterial('exterior-window-dark', {
      color: 0x515a61,
      emissive: 0x0f1418,
      emissiveIntensity: 0.16,
      roughness: 0.08,
      metalness: 0.05,
    });
    const litWindowWarm = this.createExtraStandardMaterial('exterior-window-warm', {
      color: 0x8f7862,
      emissive: 0xc9a36a,
      emissiveIntensity: 0.56,
      roughness: 0.14,
      metalness: 0,
    });
    const litWindowCool = this.createExtraStandardMaterial('exterior-window-cool', {
      color: 0x72808a,
      emissive: 0xa8b5bd,
      emissiveIntensity: 0.34,
      roughness: 0.12,
      metalness: 0,
    });
    // Window panes sit only a few centimetres in front of large facade meshes.
    // At city-scale distances that can lose depth precision, so bias panes
    // slightly toward the camera to make them completely stable.
    for (const windowMaterial of [darkWindow, litWindowWarm, litWindowCool]) {
      windowMaterial.polygonOffset = true;
      windowMaterial.polygonOffsetFactor = -2;
      windowMaterial.polygonOffsetUnits = -2;
      windowMaterial.needsUpdate = true;
    }
    const lampGlow = this.createExtraBasicMaterial('exterior-lamp-glow', {
      color: 0xf0cf96,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
      depthWrite: false,
    });
    const hazeMaterial = this.createExtraBasicMaterial('exterior-fog-card', {
      color: fogTint,
      transparent: true,
      opacity: 0.17,
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const tree = this.cloneStandardMaterial(this.materials.pipe, 'exterior-tree', {
      color: new THREE.Color(0x36322d),
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.08, 0.08),
    });
    const carBody = this.cloneStandardMaterial(this.materials.doorSteel, 'exterior-car-body', {
      color: new THREE.Color(0x454a4f),
      roughness: 0.5,
      metalness: 0.22,
      normalScale: new THREE.Vector2(0.08, 0.08),
    });
    const carTrim = this.cloneStandardMaterial(this.materials.galvanized, 'exterior-car-trim', {
      color: new THREE.Color(0x9ba1a4),
      roughness: 0.42,
      metalness: 0.72,
      normalScale: new THREE.Vector2(0.08, 0.08),
    });
    const carGlass = this.createExtraStandardMaterial('exterior-car-glass', {
      color: 0x73808a,
      roughness: 0.12,
      metalness: 0.04,
      transparent: true,
      opacity: 0.38,
    });

    this.buildOvercastSkyDome();

    this.group.add(
      makeBox('courtyard-ground', [66, 0.05, 86], [0, -0.025, -42.5], asphalt),
      makeBox('entry-sidewalk', [7.2, 0.08, 3.1], [0, 0.02, wallFaceZ - 1.45], sidewalk),
      makeBox('entry-curb', [12.8, 0.16, 0.24], [0, 0.08, -6.55], sidewalk),
      makeBox('front-road', [48.5, 0.028, 8.3], [0, 0.014, -11.2], asphaltWet),
      makeBox('front-walkway', [3.0, 0.03, 7.1], [0, 0.015, -8.7], sidewalk),
      makeBox('left-sidewalk', [17.4, 0.04, 2.8], [-15.8, 0.02, -8.5], sidewalk),
      makeBox('right-sidewalk', [17.4, 0.04, 2.8], [15.8, 0.02, -8.5], sidewalk),
      makeBox('parking-left', [14.8, 0.03, 10.6], [-16.4, 0.015, -16.8], asphaltWet),
      makeBox('parking-right', [14.8, 0.03, 10.6], [16.4, 0.015, -16.8], asphaltWet),
      makeBox('back-road', [58.0, 0.026, 5.4], [0, 0.013, -24.8], asphaltWet),
      makeBox('far-service-lane', [62.0, 0.022, 4.8], [0, 0.011, -33.7], asphalt),
      makeBox('median-strip', [52.0, 0.06, 1.2], [0, 0.03, -20.4], sidewalk),
      makeBox('left-courtyard-pad', [14.5, 0.05, 8.5], [-18.2, 0.02, -28.6], asphalt),
      makeBox('right-courtyard-pad', [14.5, 0.05, 8.5], [18.2, 0.02, -28.6], asphalt),
    );

    const puddles: Array<[number, number, number, number]> = [
      [-3.6, -9.2, 1.4, 2.4],
      [2.1, -11.7, 1.35, 2.1],
      [-6.8, -14.1, 2.1, 2.8],
      [7.2, -15.8, 1.7, 2.3],
      [0.4, -17.9, 2.0, 2.4],
      [-12.4, -26.2, 2.2, 3.0],
      [11.0, -29.1, 2.1, 2.7],
      [-20.8, -16.8, 1.6, 2.2],
      [19.6, -18.1, 1.5, 2.0],
    ];
    for (const [x, z, w, d] of puddles) {
      this.group.add(makeBox(`puddle-${x}-${z}`, [w, 0.004, d], [x, 0.018, z], puddle, false, false));
    }

    this.buildApartmentBlock(
      'near-center-hlm',
      { x: 0.0, y: 7.2, z: -25.0 },
      { width: 22.0, height: 14.4, depth: 7.2 },
      { cols: 8, rows: 6 },
      { facade, facadeAccent, windowDark: darkWindow, windowWarm: litWindowWarm, windowCool: litWindowCool, metal: roof, sidewalk },
    );
    this.buildApartmentBlock(
      'near-left-hlm',
      { x: -20.5, y: 6.1, z: -22.8 },
      { width: 10.6, height: 12.2, depth: 6.0 },
      { cols: 4, rows: 5 },
      { facade, facadeAccent, windowDark: darkWindow, windowWarm: litWindowWarm, windowCool: litWindowCool, metal: roof, sidewalk },
    );
    this.buildApartmentBlock(
      'near-right-hlm',
      { x: 20.2, y: 6.2, z: -23.4 },
      { width: 10.8, height: 12.4, depth: 6.2 },
      { cols: 4, rows: 5 },
      { facade, facadeAccent, windowDark: darkWindow, windowWarm: litWindowWarm, windowCool: litWindowCool, metal: roof, sidewalk },
    );
    this.buildApartmentBlock(
      'mid-left-hlm',
      { x: -13.8, y: 7.0, z: -39.8 },
      { width: 18.0, height: 14.0, depth: 6.0 },
      { cols: 7, rows: 6 },
      { facade: distantFacade, facadeAccent, windowDark: darkWindow, windowWarm: litWindowWarm, windowCool: litWindowCool, metal: roof, sidewalk },
    );
    this.buildApartmentBlock(
      'mid-right-hlm',
      { x: 13.6, y: 7.4, z: -41.4 },
      { width: 18.8, height: 14.8, depth: 6.1 },
      { cols: 7, rows: 6 },
      { facade: distantFacade, facadeAccent, windowDark: darkWindow, windowWarm: litWindowWarm, windowCool: litWindowCool, metal: roof, sidewalk },
    );
    this.buildApartmentBlock(
      'mid-deep-bar',
      { x: 0.5, y: 6.8, z: -47.8 },
      { width: 26.5, height: 13.6, depth: 5.2 },
      { cols: 10, rows: 5 },
      { facade: distantFacade, facadeAccent, windowDark: darkWindow, windowWarm: litWindowWarm, windowCool: litWindowCool, metal: roof, sidewalk },
    );

    this.group.add(
      makeBox('left-screen-mass', [8.6, 12.5, 16.0], [-27.6, 6.25, -20.0], distantFacade),
      makeBox('right-screen-mass', [8.6, 12.5, 16.0], [27.6, 6.25, -20.0], distantFacade),
      makeBox('left-screen-roof', [8.9, 0.18, 16.2], [-27.6, 12.59, -20.0], roof),
      makeBox('right-screen-roof', [8.9, 0.18, 16.2], [27.6, 12.59, -20.0], roof),
      makeBox('far-horizon-mass', [78.0, 12.0, 6.0], [0, 6.0, -60.5], distantFacade),
    );

    this.buildTowerLOD('tower-a', new THREE.Vector3(-23.5, 12.8, -58.0), { width: 6.8, height: 25.6, depth: 5.0 }, distantFacade, darkWindow, litWindowCool, roof);
    this.buildTowerLOD('tower-b', new THREE.Vector3(-8.2, 14.2, -62.0), { width: 8.2, height: 28.4, depth: 5.4 }, distantFacade, darkWindow, litWindowWarm, roof);
    this.buildTowerLOD('tower-c', new THREE.Vector3(9.2, 13.8, -64.2), { width: 7.6, height: 27.6, depth: 5.1 }, distantFacade, darkWindow, litWindowCool, roof);
    this.buildTowerLOD('tower-d', new THREE.Vector3(24.5, 15.2, -59.4), { width: 7.2, height: 30.4, depth: 5.4 }, distantFacade, darkWindow, litWindowWarm, roof);

    this.group.add(
      makeCylinder('street-lamp-pole-main', 0.06, 5.1, [4.3, 2.55, -8.1], wetMetal, 10),
      makeBox('street-lamp-arm-main', [0.88, 0.05, 0.09], [4.66, 4.9, -8.1], wetMetal),
      makeBox('street-lamp-head-main', [0.36, 0.1, 0.28], [5.07, 4.83, -8.1], wetMetal),
      makeCylinder('street-lamp-pole-left', 0.05, 4.5, [-9.8, 2.25, -13.5], wetMetal, 10),
      makeBox('street-lamp-head-left', [0.32, 0.1, 0.24], [-9.8, 4.25, -13.5], wetMetal),
      makeCylinder('street-lamp-pole-right', 0.05, 4.65, [11.2, 2.32, -15.2], wetMetal, 10),
      makeBox('street-lamp-head-right', [0.32, 0.1, 0.24], [11.2, 4.35, -15.2], wetMetal),
    );

    // Decorative parked cars removed on request to keep the lower exterior view cleaner.

    const hazePlanes: Array<[number, number, number, number, number, number]> = [
      [0, 6.5, -30.0, 60, 11, 0.15],
      [0, 8.0, -44.0, 70, 14, 0.18],
      [0, 9.5, -58.0, 82, 16, 0.21],
    ];
    for (const [x, y, z, width, height, opacity] of hazePlanes) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), hazeMaterial.clone());
      const planeMaterial = plane.material as THREE.MeshBasicMaterial;
      planeMaterial.opacity = opacity;
      this.extraMaterials.push(planeMaterial);
      plane.name = `fog-card-${z}`;
      plane.position.set(x, y, z);
      plane.userData.noBatch = true;
      this.group.add(plane);
    }

    this.buildRain();
  }

  private buildApartmentBlock(
    name: string,
    center: { x: number; y: number; z: number },
    size: { width: number; height: number; depth: number },
    grid: { cols: number; rows: number },
    materials: {
      facade: THREE.Material;
      facadeAccent: THREE.Material;
      windowDark: THREE.Material;
      windowWarm: THREE.Material;
      windowCool: THREE.Material;
      metal: THREE.Material;
      sidewalk: THREE.Material;
    },
  ): void {
    const { x, y, z } = center;
    const { width, height, depth } = size;
    const baseY = y - height * 0.5;
    const recessDepth = Math.min(0.48, Math.max(0.24, depth * 0.14));
    const coreDepth = Math.max(3.2, depth - recessDepth);
    const coreZ = z - recessDepth * 0.5;
    const frontFaceZ = coreZ + coreDepth * 0.5 + 0.025;
    const roofY = baseY + height + 0.14;

    this.group.add(
      makeBox(`${name}-mass`, [width, height, coreDepth], [x, y, coreZ], materials.facade),
      makeBox(`${name}-plinth`, [width + 0.22, 0.96, coreDepth + 0.1], [x, baseY + 0.48, coreZ], materials.facadeAccent),
      makeBox(`${name}-parapet`, [width + 0.42, 0.22, coreDepth + 0.28], [x, roofY, coreZ], materials.metal),
      makeBox(`${name}-stair-core`, [Math.max(2.2, width * 0.14), height - 0.18, 0.22], [x, y, frontFaceZ + 0.02], materials.facadeAccent),
    );

    const accentXs = [x - width * 0.28, x + width * 0.28];
    for (const accentX of accentXs) {
      this.group.add(makeBox(`${name}-accent-${accentX}`, [0.58, height - 0.22, 0.18], [accentX, y, frontFaceZ + 0.01], materials.facadeAccent));
    }

    const rowBandHeight = Math.max(1.45, (height - 1.8) / Math.max(1, grid.rows));
    for (let row = 0; row < grid.rows; row += 1) {
      const bandY = baseY + 1.05 + rowBandHeight * row;
      this.group.add(makeBox(`${name}-band-${row}`, [width - 0.3, 0.08, 0.06], [x, bandY, frontFaceZ + 0.03], materials.facadeAccent));
    }

    const winWidth = Math.min(1.18, width / (grid.cols + 2.5));
    const winHeight = Math.min(1.22, (height - 2.6) / (grid.rows + 0.6));
    const colStep = width / (grid.cols + 1);
    const rowStep = (height - 2.7) / grid.rows;
    const baseWindowY = baseY + 1.65;
    // Decorative background buildings intentionally have no individual window geometry.
    // This removes the remaining blinking artifacts on distant façades while preserving
    // the overall silhouettes, balcony slabs, entrances and rooflines.

    const entranceWidth = Math.min(2.2, width * 0.16);
    this.group.add(
      makeBox(`${name}-entrance-canopy`, [entranceWidth + 0.5, 0.12, 1.1], [x, baseY + 2.05, frontFaceZ + 0.44], materials.sidewalk),
      makeBox(`${name}-entrance-door-frame`, [entranceWidth, 2.15, 0.07], [x, baseY + 1.15, frontFaceZ + 0.03], materials.facadeAccent),
      makeBox(`${name}-entrance-door`, [entranceWidth - 0.18, 1.92, 0.04], [x, baseY + 1.02, frontFaceZ + 0.055], materials.windowDark, false, false),
      makeBox(`${name}-entrance-step`, [entranceWidth + 0.85, 0.08, 1.25], [x, 0.04, frontFaceZ + 0.58], materials.sidewalk),
    );

    const balconyCols = [1, Math.max(1, grid.cols - 2)];
    const balconyRows = [1, Math.max(2, grid.rows - 2)];
    for (const bRow of balconyRows) {
      for (const bCol of balconyCols) {
        if (bCol >= grid.cols) continue;
        const bx = x - width * 0.5 + colStep * (bCol + 1);
        const by = baseWindowY + bRow * rowStep - 0.74;
        this.group.add(
          makeBox(`${name}-balcony-slab-${bRow}-${bCol}`, [1.55, 0.08, 0.8], [bx, by, frontFaceZ + 0.42], materials.sidewalk),
          makeBox(`${name}-balcony-left-${bRow}-${bCol}`, [0.05, 0.95, 0.8], [bx - 0.75, by + 0.48, frontFaceZ + 0.42], materials.metal),
          makeBox(`${name}-balcony-right-${bRow}-${bCol}`, [0.05, 0.95, 0.8], [bx + 0.75, by + 0.48, frontFaceZ + 0.42], materials.metal),
          makeBox(`${name}-balcony-front-${bRow}-${bCol}`, [1.55, 0.95, 0.05], [bx, by + 0.48, frontFaceZ + 0.78], materials.metal),
        );
      }
    }
  }

  private buildTowerLOD(
    name: string,
    position: THREE.Vector3,
    size: { width: number; height: number; depth: number },
    facadeMaterial: THREE.Material,
    darkWindowMaterial: THREE.Material,
    litWindowMaterial: THREE.Material,
    roofMaterial: THREE.Material,
  ): void {
    const lod = new THREE.LOD();
    lod.name = name;
    lod.position.copy(position);
    lod.userData.noBatch = true;

    const detailed = new THREE.Group();
    detailed.name = `${name}-detailed`;
    const simple = new THREE.Group();
    simple.name = `${name}-simple`;

    detailed.add(
      makeBox(`${name}-mass`, [size.width, size.height, size.depth], [0, 0, 0], facadeMaterial),
      makeBox(`${name}-roof`, [size.width + 0.2, 0.18, size.depth + 0.2], [0, size.height * 0.5 + 0.09, 0], roofMaterial),
      makeBox(`${name}-spine`, [0.5, size.height - 0.2, size.depth + 0.08], [0, 0, 0], roofMaterial),
    );
    simple.add(
      makeBox(`${name}-mass-simple`, [size.width, size.height, size.depth], [0, 0, 0], facadeMaterial),
    );

    this.markHierarchyNoBatch(detailed);
    this.markHierarchyNoBatch(simple);
    lod.addLevel(detailed, 0);
    lod.addLevel(simple, 24);
    this.group.add(lod);
  }

  private buildOvercastSkyDome(): void {
    const texture = this.createOvercastSkyTexture();
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0x7e8a93,
      side: THREE.BackSide,
      toneMapped: false,
      fog: false,
    });
    material.name = 'overcast-night-skydome';
    this.extraMaterials.push(material);

    // Keep the sky well inside the camera far plane. The previous 88 m dome was
    // offset too far from the player while the camera far plane was only 80 m,
    // so the far clip plane cut the sphere into a black circle that appeared to
    // follow mouse movement.
    const dome = new THREE.Mesh(new THREE.SphereGeometry(112, 32, 18), material);
    dome.name = 'overcast-night-skydome';
    dome.position.set(0, 8, -14);
    dome.frustumCulled = false;
    dome.renderOrder = -100;
    dome.userData.noBatch = true;
    this.group.add(dome);
  }

  private createOvercastSkyTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible pour le skydome extérieur.');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#21272c');
    gradient.addColorStop(0.42, '#2c3339');
    gradient.addColorStop(1, '#394148');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let layer = 0; layer < 260; layer += 1) {
      const layerRandom = this.skyRandom.fork(`layer:${layer}`);
      const x = layerRandom.float(0, canvas.width);
      const y = layerRandom.float(0, canvas.height * 0.82);
      const width = layerRandom.float(100, 360);
      const height = layerRandom.float(20, 75);
      const alpha = layerRandom.float(0.025, 0.065);
      ctx.fillStyle = `rgba(210, 220, 228, ${alpha.toFixed(4)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, width, height, layerRandom.float(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#0d1013';
    for (let band = 0; band < 8; band += 1) {
      ctx.fillRect(0, canvas.height * 0.12 * band, canvas.width, canvas.height * 0.028);
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1.2, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.extraTextures.push(texture);
    return texture;
  }

  private markHierarchyNoBatch(root: THREE.Object3D): void {
    root.userData.noBatch = true;
    root.traverse((object) => {
      object.userData.noBatch = true;
    });
  }

  private buildPineTree(name: string, position: readonly [number, number, number], material: THREE.Material, height = 4.2): void {
    const [x, y, z] = position;
    const trunkHeight = height * 0.24;
    this.group.add(makeCylinder(`${name}-trunk`, 0.09, trunkHeight, [x, y + trunkHeight * 0.5, z], material, 8));
    const crownMaterial = this.cloneStandardMaterial(this.materials.lowerPaint, `${name}-crown`, {
      color: new THREE.Color(0x2e4137),
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.08, 0.08),
    });
    const crownHeights = [height * 0.42, height * 0.34, height * 0.26];
    const crownRadii = [height * 0.22, height * 0.18, height * 0.14];
    let offsetY = trunkHeight + crownHeights[0] * 0.34;
    for (let i = 0; i < crownHeights.length; i += 1) {
      const geom = new THREE.CylinderGeometry(0.02, crownRadii[i], crownHeights[i], 9);
      const mesh = new THREE.Mesh(geom, crownMaterial);
      mesh.name = `${name}-crown-${i}`;
      mesh.position.set(x, y + offsetY, z);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      offsetY += crownHeights[i] * 0.43;
    }
  }

  private buildCloudCluster(name: string, position: readonly [number, number, number], scale = 1, opacity = 0.16, drift = 0.01): void {
    const cloudMaterial = this.createExtraBasicMaterial(`${name}-material`, {
      color: 0x5d6670,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    });
    const [x, y, z] = position;
    const group = new THREE.Group();
    group.name = name;
    const parts = [
      [-2.6, 0.0, 0.0, 1.55],
      [-0.8, 0.22, -0.2, 1.95],
      [1.3, 0.12, 0.05, 1.7],
      [3.0, -0.08, 0.18, 1.35],
      [0.9, -0.18, 0.26, 1.15],
    ] as const;
    for (const [dx, dy, dz, radius] of parts) {
      const cloud = makeSphere(`${name}-${dx}-${dy}`, radius * scale, [dx * scale, dy * scale, dz * scale], cloudMaterial, 14);
      cloud.scale.set(2.2, 0.52, 1.05);
      cloud.userData.noBatch = true;
      group.add(cloud);
    }
    group.position.set(x, y, z);
    group.userData.noBatch = true;
    this.group.add(group);
    const phase = this.cloudRandom.fork(`cluster:${name}:phase`).float(0, Math.PI * 2);
    this.cloudGroups.push({ group, baseX: x, drift, phase });
  }

  private buildCar(
    name: string,
    position: readonly [number, number, number],
    bodyMaterial: THREE.Material,
    trimMaterial: THREE.Material,
    glassMaterial: THREE.Material,
    rotationY = 0,
  ): void {
    const [x, y, z] = position;
    const car = new THREE.Group();
    car.name = name;
    car.position.set(x, y, z);
    car.rotation.y = rotationY;
    car.add(
      makeBox(`${name}-body`, [1.78, 0.46, 3.7], [0, 0, 0], bodyMaterial),
      makeBox(`${name}-cabin`, [1.54, 0.56, 1.72], [0, 0.44, -0.1], bodyMaterial),
      makeBox(`${name}-windshield`, [1.34, 0.42, 0.72], [0, 0.46, 0.68], glassMaterial, false, false),
      makeBox(`${name}-rear-window`, [1.34, 0.35, 0.58], [0, 0.48, -0.9], glassMaterial, false, false),
      makeBox(`${name}-bumper-front`, [1.66, 0.14, 0.1], [0, -0.12, 1.84], trimMaterial),
      makeBox(`${name}-bumper-back`, [1.66, 0.14, 0.1], [0, -0.12, -1.84], trimMaterial),
    );
    const wheelXs = [-0.64, 0.64];
    const wheelZs = [-1.18, 1.18];
    for (const wheelX of wheelXs) {
      for (const wheelZ of wheelZs) {
        const wheel = makeCylinder(`${name}-wheel-${wheelX}-${wheelZ}`, 0.28, 0.18, [wheelX, -0.23, wheelZ], this.materials.rubber, 12);
        wheel.rotation.z = Math.PI * 0.5;
        car.add(wheel);
      }
    }
    this.group.add(car);
  }

  private buildBareTree(name: string, position: readonly [number, number, number], material: THREE.Material): void {
    const [x, y, z] = position;
    const trunkHeight = 2.6;
    this.group.add(makeCylinder(`${name}-trunk`, 0.085, trunkHeight, [x, y + trunkHeight * 0.5, z], material, 8));
    const joints = [
      [0.0, 2.1, 0.0, -0.45, 2.85, 0.18],
      [0.0, 2.0, 0.0, 0.38, 2.95, -0.16],
      [0.0, 1.75, 0.0, -0.18, 2.55, -0.42],
      [0.0, 1.9, 0.0, 0.22, 2.65, 0.38],
    ] as const;
    for (const joint of joints) {
      const start = new THREE.Vector3(x + joint[0], y + joint[1], z + joint[2]);
      const end = new THREE.Vector3(x + joint[3], y + joint[4], z + joint[5]);
      this.group.add(makeCylinderBetween(`${name}-branch-${joint.join('-')}`, start, end, 0.034, material, 7));
    }
  }

  private buildRain(): void {
    this.rainZones.length = 0;
    const exteriorFaceZ = STAIRWELL_BOUNDS.minZ - STAIRWELL_WALL_THICKNESS * 0.5;
    this.rainZones.push(
      // Dense near-field rain begins only centimetres outside the facade, never inside it.
      { minX: -12.0, maxX: 12.0, minY: 0.8, maxY: 14.2, minZ: exteriorFaceZ - 2.6, maxZ: exteriorFaceZ - 0.055 },
      { minX: -30.0, maxX: 30.0, minY: 1.0, maxY: 18.6, minZ: -24.0, maxZ: exteriorFaceZ - 2.0 },
      { minX: -38.0, maxX: 38.0, minY: 1.2, maxY: 21.5, minZ: -69.0, maxZ: -20.0 },
    );

    const count = 980;
    const positions = new Float32Array(count * 6);
    this.rainDrops.length = 0;
    for (let index = 0; index < count; index += 1) {
      const zoneIndex = index < 560 ? 0 : (index < 820 ? 1 : 2);
      const zone = this.rainZones[zoneIndex]!;
      const drop = this.randomRainDrop(zoneIndex, zone);
      this.rainDrops.push(drop);
      this.writeRainDrop(positions, index, drop);
    }

    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = this.createRainMaterial();
    material.color.set(0xc7d2d8);
    material.opacity = 0.3;
    this.rain = new THREE.LineSegments(this.rainGeometry, material);
    this.rain.name = 'doomer-rain-lines';
    this.rain.frustumCulled = false;
    this.rain.userData.noBatch = true;
    this.group.add(this.rain);
  }

  private randomRainDrop(zoneIndex: number, zone: RainZone): RainDrop {
    const sway = this.rainRandom.float(0.004, 0.016);
    const driftZ = this.rainRandom.float(0.01, 0.04);
    return {
      x: this.rainRandom.float(zone.minX, zone.maxX),
      y: this.rainRandom.float(zone.minY, zone.maxY),
      z: this.rainRandom.float(zone.minZ, zone.maxZ),
      length: this.rainRandom.float(0.86, 1.28),
      speed: this.rainRandom.float(17.5, 26.0),
      dx: sway,
      dz: -driftZ,
      zoneIndex,
    };
  }

  private writeRainDrop(buffer: Float32Array, index: number, drop: RainDrop): void {
    const offset = index * 6;
    buffer[offset] = drop.x;
    buffer[offset + 1] = drop.y;
    buffer[offset + 2] = drop.z;
    buffer[offset + 3] = drop.x + drop.dx;
    buffer[offset + 4] = drop.y - drop.length;
    buffer[offset + 5] = drop.z + drop.dz;
  }

  private buildLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0x6c7580, 0x24201d, 0.3);
    hemisphere.name = 'stairwell-night-ambient';
    this.group.add(hemisphere);

    const ambient = new THREE.AmbientLight(0x55514b, 0.12);
    ambient.name = 'stairwell-night-fill';
    this.group.add(ambient);

    const moon = new THREE.DirectionalLight(0x728392, 0.15);
    moon.name = 'south-facade-moonlight';
    moon.position.set(5.8, 10.5, -14.5);
    moon.castShadow = false;
    this.group.add(moon);

    const streetLamp = new THREE.PointLight(0xffca82, 1.35, 14, 2);
    streetLamp.name = 'street-lamp-light';
    streetLamp.position.set(4.42, 4.26, -8.2);
    streetLamp.castShadow = false;
    this.group.add(streetLamp);

    for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level += 1) {
      const ceilingBottom = level < STAIRWELL_LEVEL_COUNT - 1
        ? floorY(level + 1) - STAIRWELL_FLOOR_FINISH_THICKNESS - 0.16
        : STAIRWELL_ROOF_Y;
      this.addCeilingFixture(`main-fixture-${level}`, ceilingBottom - 0.024, -2.35);

      const mainLight = new THREE.PointLight(0xfbe7c4, 2.2, 9.4, 2);
      mainLight.position.set(0, ceilingBottom - 0.17, -2.35);
      mainLight.name = `main-fixture-light-${level}`;
      mainLight.castShadow = false;
      this.group.add(mainLight);

      const corridorFill = new THREE.PointLight(0xf3e5cc, 0.6, 10.5, 2);
      corridorFill.position.set(0, ceilingBottom - 0.12, 0.7);
      corridorFill.name = `main-fixture-fill-${level}`;
      corridorFill.castShadow = false;
      this.group.add(corridorFill);
    }

    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level += 1) {
      const y = midLandingY(level) + 2.02;
      this.addNorthWallFixture(`mid-fixture-${level}`, y);

      const wallLight = new THREE.PointLight(0xf6e4c2, 1.18, 6.8, 2);
      wallLight.position.set(0, y - 0.02, STAIRWELL_BOUNDS.maxZ - 0.64);
      wallLight.name = `mid-fixture-light-${level}`;
      wallLight.castShadow = false;
      this.group.add(wallLight);

      const stairWash = new THREE.PointLight(0xe9dbc0, 0.5, 7.6, 2);
      stairWash.position.set(0, y - 0.28, 1.1);
      stairWash.name = `mid-fixture-stair-wash-${level}`;
      stairWash.castShadow = false;
      this.group.add(stairWash);
    }
  }

  private addCeilingFixture(name: string, y: number, z: number): void {
    this.group.add(
      makeBox(`${name}-base`, [1.08, 0.05, 0.28], [0, y, z], this.materials.fixtureBody),
      makeBox(`${name}-tray`, [0.94, 0.03, 0.2], [0, y - 0.026, z], this.materials.fixtureBody),
      makeBox(`${name}-diffuser`, [0.88, 0.03, 0.16], [0, y - 0.046, z], this.materials.fixtureGlow, false, false),
      makeBox(`${name}-end-left`, [0.09, 0.07, 0.28], [-0.495, y - 0.008, z], this.materials.fixtureBody),
      makeBox(`${name}-end-right`, [0.09, 0.07, 0.28], [0.495, y - 0.008, z], this.materials.fixtureBody),
      makeBox(`${name}-rib-left`, [0.018, 0.026, 0.17], [-0.18, y - 0.043, z], this.materials.frameMetal),
      makeBox(`${name}-rib-right`, [0.018, 0.026, 0.17], [0.18, y - 0.043, z], this.materials.frameMetal),
    );
  }

  private addNorthWallFixture(name: string, y: number): void {
    const wallFaceZ = STAIRWELL_BOUNDS.maxZ - STAIRWELL_WALL_THICKNESS * 0.5;
    const baseZ = wallFaceZ - 0.03;
    const diffuser = makeSphere(
      `${name}-oval-diffuser`,
      0.5,
      [0, y, wallFaceZ - 0.095],
      this.materials.fixtureGlow,
      14,
    );
    diffuser.scale.set(0.66, 0.25, 0.16);
    this.group.add(
      makeBox(`${name}-base`, [0.56, 0.26, 0.058], [0, y, baseZ], this.materials.fixtureBody),
      makeBox(`${name}-hood`, [0.62, 0.05, 0.08], [0, y + 0.11, wallFaceZ - 0.06], this.materials.fixtureBody),
      diffuser,
      makeBox(`${name}-cage-left`, [0.022, 0.25, 0.035], [-0.2, y, wallFaceZ - 0.175], this.materials.frameMetal),
      makeBox(`${name}-cage-center`, [0.022, 0.25, 0.035], [0, y, wallFaceZ - 0.175], this.materials.frameMetal),
      makeBox(`${name}-cage-right`, [0.022, 0.25, 0.035], [0.2, y, wallFaceZ - 0.175], this.materials.frameMetal),
    );
  }

  update(elapsed: number): void {
    for (const cloud of this.cloudGroups) {
      cloud.group.position.x = cloud.baseX + Math.sin(elapsed * cloud.drift + cloud.phase) * 2.2;
    }

    for (const rainShader of this.windowRainShaders) {
      rainShader.time.value = elapsed;
    }

    if (!this.rainGeometry) return;
    const attribute = this.rainGeometry.getAttribute('position') as THREE.BufferAttribute;
    const buffer = attribute.array as Float32Array;
    for (let index = 0; index < this.rainDrops.length; index += 1) {
      const drop = this.rainDrops[index]!;
      const zone = this.rainZones[drop.zoneIndex] ?? this.rainZones[0];
      drop.y -= drop.speed * 0.0165;
      drop.x += Math.sin(elapsed * 0.34 + index * 0.17) * 0.00045;
      drop.z += Math.cos(elapsed * 0.12 + index * 0.09) * 0.0002;
      if (drop.y < zone.minY - 0.4 || drop.z > zone.maxZ + 0.05) {
        const refreshed = this.randomRainDrop(drop.zoneIndex, zone);
        drop.x = refreshed.x;
        drop.y = zone.maxY + this.rainRandom.float(0, 2.4);
        drop.z = refreshed.z;
        drop.length = refreshed.length;
        drop.speed = refreshed.speed;
        drop.dx = refreshed.dx;
        drop.dz = refreshed.dz;
      }
      this.writeRainDrop(buffer, index, drop);
    }
    attribute.needsUpdate = true;
  }

  private static async loadWindowRainNormalTexture(): Promise<THREE.Texture | undefined> {
    const loader = new THREE.TextureLoader();
    try {
      const texture = await loader.loadAsync(WINDOW_RAIN_NORMAL_URL);
      texture.name = 'window-rain-normal-sprite';
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.colorSpace = THREE.NoColorSpace;
      texture.needsUpdate = true;
      return texture;
    } catch (error) {
      console.warn('Impossible de charger la normal map locale de pluie sur vitrage.', error);
      return undefined;
    }
  }

  static async load(materials: StairwellMaterialSet): Promise<StairwellEnvironment> {
    const [
      importedWindowTemplate,
      importedEntranceDoorTemplate,
      importedMailboxTemplate,
      importedSecondFloorTableTemplate,
      windowRainNormalTexture,
    ] = await Promise.all([
      StairwellEnvironment.loadImportedWindowTemplate(),
      StairwellEnvironment.loadEntranceDoorTemplate(),
      StairwellEnvironment.loadMailboxTemplate(),
      StairwellEnvironment.loadSecondFloorTableTemplate(),
      StairwellEnvironment.loadWindowRainNormalTexture(),
    ]);
    return new StairwellEnvironment(
      materials,
      importedWindowTemplate,
      importedEntranceDoorTemplate,
      importedMailboxTemplate,
      importedSecondFloorTableTemplate,
      windowRainNormalTexture,
    );
  }

  dispose(): void {
    const importedMaterials = new Set<THREE.Material>();
    const importedTextures = new Set<THREE.Texture>();
    for (const template of [
      this.importedWindowTemplate,
      this.importedEntranceDoorTemplate,
      this.importedMailboxTemplate,
      this.importedSecondFloorTableTemplate,
    ]) {
      if (!template) continue;
      template.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          importedMaterials.add(material);
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) importedTextures.add(value);
          }
        }
      });
      template.clear();
    }
    disposeObject3D(this.group);
    this.extraMaterials.forEach((material) => material.dispose());
    importedMaterials.forEach((material) => material.dispose());
    this.extraTextures.forEach((texture) => texture.dispose());
    importedTextures.forEach((texture) => texture.dispose());
  }
}
