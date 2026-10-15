import { characterRandom } from './CharacterRandom';
import * as THREE from 'three';

const MAX_BLOOD_DECALS = 72;
const DECAL_TEXTURE_PATHS = [
  '/assets/blood/blood-decal-a.png',
  '/assets/blood/blood-decal-b.png',
  '/assets/blood/blood-decal-c.png',
] as const;

const seededNoise = (value: number): number => {
  const x = Math.sin(value * 91.733 + 17.91) * 43758.5453;
  return x - Math.floor(x);
};

/** Offline fallback: alpha-rich irregular stain, final colour comes from PBR. */
const createFallbackSplatter = (seed: number): THREE.CanvasTexture => {
  const size = 384;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.CanvasTexture(canvas);
  context.clearRect(0, 0, size, size);
  context.fillStyle = 'rgba(255,255,255,.88)';
  context.filter = 'blur(.55px)';

  const centerX = size * (0.48 + (seededNoise(seed + 1) - 0.5) * 0.08);
  const centerY = size * (0.50 + (seededNoise(seed + 2) - 0.5) * 0.08);
  context.beginPath();
  for (let point = 0; point < 128; point += 1) {
    const angle = point / 128 * Math.PI * 2;
    const jagged = 0.54
      + seededNoise(seed * 3.1 + point * 2.17) * 0.34
      + seededNoise(seed * 7.7 + point * 9.31) * 0.12;
    const radius = size * 0.22 * jagged;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius * (0.72 + seededNoise(seed + point * 4.7) * 0.24);
    if (point === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();

  context.filter = 'none';
  for (let index = 0; index < 46; index += 1) {
    const angle = seededNoise(seed * 11.3 + index * 7.1) * Math.PI * 2;
    const distance = size * (0.18 + seededNoise(seed * 4.2 + index * 9.3) * 0.32);
    const radius = size * (0.0025 + seededNoise(seed * 8.8 + index * 5.7) * 0.013);
    context.globalAlpha = 0.38 + seededNoise(seed * 5.3 + index) * 0.55;
    context.beginPath();
    context.ellipse(
      centerX + Math.cos(angle) * distance,
      centerY + Math.sin(angle) * distance * 0.84,
      radius * (0.7 + seededNoise(seed + index * 1.7) * 1.5),
      radius,
      angle,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

const createBloodMaterial = (
  map: THREE.Texture,
  variant: number,
): THREE.MeshStandardMaterial => {
  const colors = [0x63322b, 0x532822, 0x714037, 0x4a241f];
  const opacities = [0.72, 0.62, 0.78, 0.57];
  return new THREE.MeshStandardMaterial({
    name: 'ragdoll-blood-decal',
    map,
    color: colors[variant % colors.length]!,
    roughness: THREE.MathUtils.lerp(0.80, 0.93, (variant % 4) / 3),
    metalness: 0,
    transparent: true,
    opacity: opacities[variant % opacities.length]!,
    alphaTest: 0.035,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    fog: true,
  });
};

export interface BloodBurstOptions {
  readonly impactVelocity?: Readonly<THREE.Vector3>;
}

interface PendingDecal {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly materialIndex: number;
}

/**
 * Bounded, preallocated surface decals. A burst's main contact mark is visible
 * immediately; the secondary marks are spread over a small per-frame budget.
 * Every queued mark stores its own transform, so a second impact cannot rotate
 * the previous impact's queued blood.
 */
export class BloodDecalSystem {
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly fallbackTextures: THREE.CanvasTexture[];
  private readonly materials: THREE.MeshStandardMaterial[];
  private readonly loadedTextures: THREE.Texture[] = [];
  private readonly decals: THREE.Mesh[] = [];
  private readonly pendingDecals: PendingDecal[] = [];
  private readonly normal = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly bitangent = new THREE.Vector3();
  private readonly helperAxis = new THREE.Vector3();
  private readonly flow = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly projectedVelocity = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly basisQuaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private flowStrength = 0;
  private flowAngle = 0;
  private cursor = 0;

  constructor(private readonly scene: THREE.Scene, private readonly random = characterRandom('blood')) {
    this.fallbackTextures = [
      createFallbackSplatter(11),
      createFallbackSplatter(29),
      createFallbackSplatter(47),
    ];
    this.materials = this.fallbackTextures.flatMap((texture) => [
      createBloodMaterial(texture, 0),
      createBloodMaterial(texture, 1),
      createBloodMaterial(texture, 2),
      createBloodMaterial(texture, 3),
    ]);
    // Allocate all GPU-facing objects at startup rather than during a collision.
    for (let i = 0; i < MAX_BLOOD_DECALS; i += 1) {
      const mesh = new THREE.Mesh(this.geometry, this.materials[0]!);
      mesh.name = 'ragdoll-impact-blood';
      mesh.renderOrder = 8;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      this.decals.push(mesh);
    }
    const loader = new THREE.TextureLoader();
    DECAL_TEXTURE_PATHS.forEach((path, textureIndex) => {
      loader.load(path, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 2;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        this.loadedTextures.push(texture);
        for (let variant = 0; variant < 4; variant += 1) {
          const material = this.materials[textureIndex * 4 + variant];
          if (material) {
            material.map = texture;
            material.needsUpdate = true;
          }
        }
      }, undefined, () => undefined);
    });
  }

  update(_delta: number): void {
    this.flushPending(12);
  }

  private displayDecal(next: PendingDecal): void {
    const mesh = this.decals[this.cursor]!;
    this.cursor = (this.cursor + 1) % MAX_BLOOD_DECALS;
    mesh.position.copy(next.position);
    mesh.quaternion.copy(next.quaternion);
    mesh.scale.set(next.scaleX, next.scaleY, 1);
    mesh.material = this.materials[next.materialIndex] ?? this.materials[0]!;
    mesh.visible = true;
  }

  private flushPending(budget: number): void {
    for (let i = 0; i < budget && this.pendingDecals.length > 0; i += 1) {
      this.displayDecal(this.pendingDecals.shift()!);
    }
  }

  private prepareBasis(surfaceNormal: Readonly<THREE.Vector3>): void {
    this.normal.copy(surfaceNormal);
    if (this.normal.lengthSq() < 1e-8) this.normal.set(0, 1, 0);
    else this.normal.normalize();
    this.helperAxis.set(0, Math.abs(this.normal.y) < 0.92 ? 1 : 0,
      Math.abs(this.normal.y) < 0.92 ? 0 : 1);
    this.tangent.crossVectors(this.helperAxis, this.normal).normalize();
    this.bitangent.crossVectors(this.normal, this.tangent).normalize();
    this.basis.makeBasis(this.tangent, this.bitangent, this.normal);
    this.basisQuaternion.setFromRotationMatrix(this.basis);
    this.flow.copy(this.tangent);
    this.side.copy(this.bitangent);
    this.flowStrength = 0;
    this.flowAngle = 0;
  }

  private prepareDirectionalFlow(impactVelocity?: Readonly<THREE.Vector3>): void {
    if (!impactVelocity) return;
    const alongNormal = this.normal.dot(impactVelocity);
    this.projectedVelocity.copy(impactVelocity).addScaledVector(this.normal, -alongNormal);
    const speed = this.projectedVelocity.length();
    if (speed < 0.08) return;
    this.flow.copy(this.projectedVelocity).divideScalar(speed);
    this.side.crossVectors(this.normal, this.flow).normalize();
    this.flowStrength = THREE.MathUtils.clamp((speed - 0.25) / 4.5, 0, 1);
    this.flowAngle = Math.atan2(this.flow.dot(this.bitangent), this.flow.dot(this.tangent));
  }

  private queueMark(
    point: Readonly<THREE.Vector3>,
    size: number,
    severity: number,
    alignment = 0,
    immediate = false,
  ): void {
    const aspect = THREE.MathUtils.lerp(0.60, 1.48, this.random());
    const stretch = THREE.MathUtils.lerp(1, 1.45, alignment);
    const rotation = alignment > 0.08
      ? this.flowAngle + (this.random() - 0.5) * Math.PI * THREE.MathUtils.lerp(0.18, 0.8, 1 - alignment)
      : this.random() * Math.PI * 2;
    const quaternion = this.basisQuaternion.clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotation));
    const pending: PendingDecal = {
      position: new THREE.Vector3(point.x, point.y, point.z).addScaledVector(this.normal, 0.0065),
      quaternion,
      scaleX: size * aspect * stretch,
      scaleY: size / Math.max(0.62, aspect) * THREE.MathUtils.lerp(0.82, 1.16, this.random()),
      materialIndex: Math.floor(this.random() * this.materials.length),
    };
    // A major impact must never wait behind old satellites for its first mark.
    if (immediate) this.displayDecal(pending);
    else {
      if (this.pendingDecals.length >= 96) this.pendingDecals.shift();
      this.pendingDecals.push(pending);
    }
    void severity;
  }

  spawn(
    position: Readonly<THREE.Vector3>,
    surfaceNormal: Readonly<THREE.Vector3>,
    size: number,
    severity = 1,
  ): void {
    this.prepareBasis(surfaceNormal);
    const base = THREE.MathUtils.clamp(size, 0.14, 1.18);
    const strength = THREE.MathUtils.clamp(severity, 0, 1);
    this.queueMark(position, base, strength, 0, true);
    const satelliteCount = strength >= 0.86 ? 5 + Math.floor(this.random() * 5)
      : strength >= 0.60 ? 3 + Math.floor(this.random() * 4)
        : strength >= 0.34 ? 1 + Math.floor(this.random() * 3) : 0;
    for (let i = 0; i < satelliteCount; i += 1) {
      const angle = this.random() * Math.PI * 2;
      const distance = base * THREE.MathUtils.lerp(0.12, 0.62, Math.pow(this.random(), 1.18));
      this.position.copy(position)
        .addScaledVector(this.tangent, Math.cos(angle) * distance)
        .addScaledVector(this.bitangent, Math.sin(angle) * distance);
      this.queueMark(this.position, base * THREE.MathUtils.lerp(0.055, 0.24, this.random()), strength);
    }
  }

  spawnBurst(
    position: Readonly<THREE.Vector3>,
    surfaceNormal: Readonly<THREE.Vector3>,
    size: number,
    severity = 1,
    intensity = 1,
    options: BloodBurstOptions = {},
  ): void {
    this.prepareBasis(surfaceNormal);
    this.prepareDirectionalFlow(options.impactVelocity);
    const base = THREE.MathUtils.clamp(size, 0.20, 1.22);
    const strength = THREE.MathUtils.clamp(severity, 0, 1);
    const power = THREE.MathUtils.clamp(intensity, 0.55, 3);
    const directional = this.flowStrength > 0.12;

    // Dense main pool: the majority of volume stays at the actual contact.
    const corePoolCount = Math.min(5, 2 + Math.floor(strength * 1.8 + power * 0.85 + this.random() * 2));
    for (let i = 0; i < corePoolCount; i += 1) {
      const forward = base * THREE.MathUtils.lerp(directional ? -0.035 : -0.05, directional ? 0.14 : 0.05, this.random());
      const lateral = base * (this.random() - 0.5) * THREE.MathUtils.lerp(0.04, 0.18, this.random());
      this.position.copy(position).addScaledVector(this.flow, forward).addScaledVector(this.side, lateral);
      this.queueMark(this.position, base * THREE.MathUtils.lerp(0.78, 1.16, this.random()), strength,
        Math.max(this.flowStrength, 0.22), i === 0);
    }

    // A second irregular dominant mark, still close enough to overlap the body.
    if (power >= 1.15) {
      this.position.copy(position)
        .addScaledVector(this.flow, base * THREE.MathUtils.lerp(directional ? 0.05 : -0.08, directional ? 0.36 : 0.12, this.random()))
        .addScaledVector(this.side, base * (this.random() - 0.5) * 0.48);
      this.queueMark(this.position, base * THREE.MathUtils.lerp(0.52, 0.94, this.random()), strength, this.flowStrength);
    }

    const clusterCount = Math.min(16, 6 + Math.floor(strength * 3.8 + power * 2.7 + this.random() * 4.2));
    for (let i = 1; i < clusterCount; i += 1) {
      const backward = base * (directional ? 0.12 : 0.22);
      const reach = base * (directional ? 1.08 : 0.52) * power;
      const forward = directional
        ? THREE.MathUtils.lerp(-backward, reach, Math.pow(this.random(), 0.84))
        : (this.random() * 2 - 1) * reach;
      const lateral = (this.random() * 2 - 1) * base
        * (directional ? 0.16 + Math.max(0, forward) * 0.18 / base : 0.42) * this.random();
      this.position.copy(position).addScaledVector(this.flow, forward).addScaledVector(this.side, lateral);
      this.queueMark(this.position, base * THREE.MathUtils.lerp(0.12, 0.78, Math.pow(this.random(), 1.06)),
        strength, directional ? THREE.MathUtils.lerp(0.28, 0.92, this.random()) : 0);
    }

    // Only small droplets may travel far, and only along real tangential motion.
    if (this.flowStrength > 0.18 && power >= 1.05) {
      const trailCount = Math.min(18, 4 + Math.floor(power * 3.1 + strength * 3 + this.random() * 3));
      for (let i = 0; i < trailCount; i += 1) {
        const forward = base * THREE.MathUtils.lerp(0.18, 1.85 * power, Math.pow(this.random(), 0.62));
        const lateral = (this.random() - 0.5) * 2 * base
          * THREE.MathUtils.lerp(0.03, 0.18 + forward * 0.16 / base, this.random());
        this.position.copy(position).addScaledVector(this.flow, forward).addScaledVector(this.side, lateral);
        this.queueMark(this.position, base * THREE.MathUtils.lerp(0.03, 0.12, this.random()), strength,
          THREE.MathUtils.lerp(0.55, 1, this.random()));
      }
    }
  }

  clear(): void {
    for (const decal of this.decals) decal.visible = false;
    this.pendingDecals.length = 0;
    this.cursor = 0;
  }

  dispose(): void {
    this.clear();
    for (const decal of this.decals) this.scene.remove(decal);
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.loadedTextures) texture.dispose();
    for (const texture of this.fallbackTextures) texture.dispose();
  }
}
