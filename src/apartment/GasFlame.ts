import * as THREE from 'three';

/** World-space underside of a pan: the flat bottom disc, not its handle. */
export interface PanBase { center: THREE.Vector3; radius: number; bottomY: number }

/**
 * Reads the lowest vertices of the pan meshes (within 6 mm of the bottom) so
 * the burner sits under the real base even when the handle widens the bounds.
 */
/** Highest stove surface under the pan base (burner head or grate), if any:
 * rays cast straight down from just under the pan at its centre and ring. */
export function burnerTop(stove: THREE.Object3D | undefined, base: PanBase): number | null {
  if (!stove) return null;
  stove.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3();
  ray.far = .25; let top = -Infinity;
  for (let i = 0; i <= 8; i++) {
    const angle = i / 8 * Math.PI * 2, r = i === 8 ? 0 : base.radius * .45;
    origin.set(base.center.x + Math.cos(angle) * r, base.bottomY - .002, base.center.z + Math.sin(angle) * r);
    ray.set(origin, down);
    const hit = ray.intersectObject(stove, true)[0];
    if (hit) top = Math.max(top, hit.point.y);
  }
  return Number.isFinite(top) ? top : null;
}

export function panBase(pan?: THREE.Object3D): PanBase | null {
  if (!pan) return null;
  pan.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(pan, true);
  if (box.isEmpty()) return null;
  const v = new THREE.Vector3(), bottom = new THREE.Box3();
  pan.traverse(object => {
    const mesh = object as THREE.Mesh, position = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (v.y <= box.min.y + .006) bottom.expandByPoint(v);
    }
  });
  const base = bottom.isEmpty() ? box : bottom;
  const center = base.getCenter(new THREE.Vector3()); center.y = box.min.y;
  const size = base.getSize(new THREE.Vector3());
  return { center, radius: Math.max(.03, Math.min(size.x, size.z) / 2), bottomY: box.min.y };
}

const TONGUES = 22;

/**
 * A domestic gas crown: short blue tongues on a burner ring that lean outward
 * and stop a few millimetres under the pan instead of crossing it. Additive,
 * depth-tested but not depth-writing, so the pan and grate always hide it
 * cleanly and the crossed quads never show their seams.
 */
export class GasFlame {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.BufferGeometry;
  private level = 0;

  /** `gap` is the free height between burner head and pan bottom. */
  constructor(ringRadius: number, gap: number) {
    this.group.name = 'apartment-gas-flame';
    const tilt = .62, height = Math.max(.008, (gap - .004) / Math.cos(tilt)), width = .011;
    const positions: number[] = [], uvs: number[] = [], seeds: number[] = [], indices: number[] = [];
    const corner = new THREE.Vector3(), radial = new THREE.Vector3(), tangent = new THREE.Vector3(), up = new THREE.Vector3();
    for (let t = 0; t < TONGUES; t++) {
      const angle = t / TONGUES * Math.PI * 2, seed = (t * 0.61803398875) % 1;
      radial.set(Math.cos(angle), 0, Math.sin(angle)); tangent.set(-radial.z, 0, radial.x);
      // Lean outward: the tip travels along the pan underside like a real flame.
      up.set(0, Math.cos(tilt), 0).addScaledVector(radial, Math.sin(tilt));
      const base = radial.clone().multiplyScalar(ringRadius);
      for (const across of [tangent, radial.clone().multiplyScalar(.55).addScaledVector(up, -.2).normalize()]) {
        const first = positions.length / 3;
        for (const [u, h] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
          corner.copy(base).addScaledVector(across, (u - .5) * width).addScaledVector(up, h * height);
          positions.push(corner.x, corner.y, corner.z); uvs.push(u, h); seeds.push(seed);
        }
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.geometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
    this.geometry.setIndex(indices);
    this.material = new THREE.ShaderMaterial({
      name: 'apartment-gas-flame',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      toneMapped: false, fog: false,
      uniforms: { time: { value: 0 }, level: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float seed; uniform float time; varying vec2 vUv; varying float vSeed;
        void main() {
          vUv = uv; vSeed = seed;
          vec3 p = position;
          float h = uv.y * uv.y;
          // Height flicker and a small lateral lick, strongest at the tip.
          p.xz += vec2(sin(time * 19.0 + seed * 40.0), cos(time * 23.0 + seed * 31.0)) * .0018 * h;
          p.y -= (.5 + .5 * sin(time * 27.0 + seed * 57.0)) * .0025 * h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float level; uniform float time; varying vec2 vUv; varying float vSeed;
        void main() {
          float y = vUv.y, x = abs(vUv.x - .5) * 2.0;
          float halfWidth = mix(.95, .08, pow(y, .8));
          float shape = 1.0 - smoothstep(halfWidth * .55, halfWidth, x);
          float body = shape * smoothstep(0.0, .12, y) * (1.0 - smoothstep(.55, 1.0, y));
          float core = (1.0 - smoothstep(0.0, .35, x)) * (1.0 - smoothstep(.05, .45, y));
          vec3 deep = vec3(.06, .16, .95), pale = vec3(.45, .62, 1.0), tip = vec3(.55, .35, .65);
          vec3 color = mix(deep, pale, core) + tip * smoothstep(.7, 1.0, y) * .25;
          float flicker = .86 + .14 * sin(time * 31.0 + vSeed * 90.0);
          float alpha = (body * .55 + core * .55) * flicker * level;
          if (alpha < .003) discard;
          gl_FragColor = vec4(color, alpha);
        }`,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.name = 'apartment-gas-flame-crown'; mesh.frustumCulled = false; mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  /** Ignition swells the crown in ~0.25 s; switching off collapses it faster. */
  update(on: boolean, elapsed: number, delta: number): void {
    const target = on ? 1 : 0, rate = on ? 4 : 9;
    this.level += (target - this.level) * Math.min(1, Math.max(0, delta) * rate);
    if (!on && this.level < .01) this.level = 0;
    this.material.uniforms.time!.value = elapsed;
    this.material.uniforms.level!.value = this.level;
    // Keep it in the scene: the program stays compiled; zero level draws nothing.
    this.group.visible = this.level > 0 || on;
  }

  get intensity(): number { return this.level; }

  dispose(): void { this.geometry.dispose(); this.material.dispose(); this.group.removeFromParent(); }
}
