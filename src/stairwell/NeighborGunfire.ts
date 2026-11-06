import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { SeededRandom } from '../world/SeededRandom';
import type { Vec3Data } from '../world/types';

export interface GunfireAudioOutput { readonly context: AudioContext; readonly destination: AudioNode }

export interface GunfireHost {
  readonly scene: THREE.Scene;
  readonly physics: PhysicsWorld;
  audio(): GunfireAudioOutput | null;
  /** Player capsule centre (feet + 0.865) and horizontal velocity. */
  playerCenter(out: THREE.Vector3): THREE.Vector3;
  playerVelocity(out: THREE.Vector3): THREE.Vector3;
  listener(out: { position: THREE.Vector3; right: THREE.Vector3 }): void;
  doorSound(kind: 'open' | 'slam', position: Readonly<Vec3Data>, doorId: string): void;
  flash(level: number): void;
  shake(level: number): void;
  /** The bullet reached the player. */
  onPlayerHit(direction: THREE.Vector3): void;
}

const PLAYER_RADIUS = 0.3;
const PLAYER_HALF_SEGMENT = 0.565;
const MAX_DECALS = 8;

/** Where a straight shot ends: on the player, on the first wall, or nowhere close. */
export function resolveShot(
  origin: Readonly<Vec3Data>, direction: Readonly<Vec3Data>, player: Readonly<Vec3Data>,
  wallDistance: number | null, range = 40,
): { kind: 'player' | 'wall' | 'none'; distance: number } {
  // Closest approach between the ray and the vertical capsule segment.
  const dx = direction.x, dy = direction.y, dz = direction.z;
  const ox = origin.x - player.x, oy = origin.y - player.y, oz = origin.z - player.z;
  let best = Infinity, bestT = 0;
  for (let i = 0; i <= 24; i += 1) {
    const s = -PLAYER_HALF_SEGMENT + (2 * PLAYER_HALF_SEGMENT * i) / 24;
    const t = Math.max(0, -(ox * dx + (oy - s) * dy + oz * dz));
    const px = ox + dx * t, py = oy + dy * t - s, pz = oz + dz * t;
    const d = Math.hypot(px, py, pz);
    if (d < best) { best = d; bestT = t; }
  }
  const playerT = best <= PLAYER_RADIUS + 0.02 ? bestT : Infinity;
  if (wallDistance !== null && wallDistance < playerT) return { kind: 'wall', distance: wallDistance };
  if (Number.isFinite(playerT) && playerT <= range) return { kind: 'player', distance: playerT };
  return { kind: 'none', distance: range };
}

/**
 * A resident at the end of their tether: the door snaps ajar, a pistol comes
 * out of the gap and fires once at the player's chest (aim error grows with
 * distance and movement). Walls and doors stop the bullet; a miss leaves an
 * impact. Everything is built up front so the first shot never hitches.
 */
export class NeighborGunfire {
  private readonly gun = new THREE.Group();
  private readonly flash: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly decals: THREE.Mesh[] = [];
  private readonly decalGeometry = new THREE.CircleGeometry(0.024, 10);
  private readonly decalMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0a09, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  private readonly voidMaterial = new THREE.MeshBasicMaterial({ color: 0x020202 });
  private readonly voidGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly random = new SeededRandom('neighbor-gunfire');
  private impulse?: AudioBuffer;
  private shot?: AudioBuffer;
  private reverb?: { convolver: ConvolverNode; gain: GainNode; context: AudioContext };
  private sequence?: {
    doorId: string; leaf: THREE.Object3D; parent: THREE.Object3D; closed: THREE.Matrix4; auto: boolean;
    pivot: THREE.Group; void: THREE.Mesh; sign: number; center: THREE.Vector3; inward: THREE.Vector3; time: number; fired: boolean;
  };
  private readonly scratch = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly listener = { position: new THREE.Vector3(), right: new THREE.Vector3() };

  constructor(private readonly host: GunfireHost) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.45, metalness: 0.7, name: 'neighbor-pistol' });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb98d73, roughness: 0.8, name: 'neighbor-hand' });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2c2a33, roughness: 0.95, name: 'neighbor-sleeve' });
    const flash = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.materials.push(metal, skin, sleeve, flash);
    const part = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      this.gun.add(mesh);
      return mesh;
    };
    // Built along +Z (the muzzle), grip down, hand and sleeve behind.
    part(new THREE.BoxGeometry(0.032, 0.036, 0.19), metal, 0, 0.018, 0.04);
    part(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8).rotateX(Math.PI / 2), metal, 0, 0.012, 0.15);
    part(new THREE.BoxGeometry(0.028, 0.11, 0.045), metal, 0, -0.045, -0.025).rotation.x = -0.25;
    part(new THREE.BoxGeometry(0.06, 0.07, 0.11), skin, 0, -0.03, -0.075);
    part(new THREE.BoxGeometry(0.085, 0.085, 0.32), sleeve, 0, -0.035, -0.27);
    this.flash = part(new THREE.PlaneGeometry(0.34, 0.34), flash, 0, 0.014, 0.25);
    this.gun.name = 'neighbor-pistol';
    this.gun.visible = false;
    host.scene.add(this.gun);
    this.materials.push(this.decalMaterial, this.voidMaterial);
    this.geometries.push(this.decalGeometry, this.voidGeometry);
    this.prepareAudio();
  }

  get warmupRoots(): readonly THREE.Object3D[] { return [this.gun]; }
  get isActive(): boolean { return !!this.sequence; }

  /** Bakes the dry report and a hard-walled stairwell tail once, off the hot path. */
  private prepareAudio(): void {
    const output = this.host.audio();
    if (!output || this.shot) return;
    const { context } = output, rate = context.sampleRate, random = new SeededRandom('gunshot-buffers');
    const shot = context.createBuffer(2, Math.floor(rate * 0.5), rate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = shot.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < data.length; i += 1) {
        const t = i / rate, noise = random.float(-1, 1);
        low += (noise - low) * 0.08;
        // Supersonic crack, muzzle blast body, then a falling low thump.
        const crack = noise * Math.exp(-t / 0.0035) * 0.95;
        const blast = low * 3.2 * Math.exp(-t / 0.045);
        const thump = Math.sin(2 * Math.PI * (58 - 30 * Math.min(1, t / 0.12)) * t) * Math.exp(-t / 0.09) * 0.55;
        data[i] = Math.max(-0.97, Math.min(0.97, crack + blast + thump));
      }
    }
    const impulse = context.createBuffer(2, Math.floor(rate * 2.1), rate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        const t = i / rate;
        // Concrete stairwell: dense early slaps, then a long bright decay.
        const early = t < 0.09 && i % Math.floor(rate * (0.011 + channel * 0.003)) < 40 ? 0.9 : 0;
        data[i] = (random.float(-1, 1) * Math.exp(-t / 0.55) + early * Math.exp(-t / 0.05)) * 0.6;
      }
    }
    this.shot = shot;
    this.impulse = impulse;
    const convolver = context.createConvolver();
    convolver.buffer = impulse;
    const gain = context.createGain();
    gain.gain.value = 0.55;
    convolver.connect(gain).connect(output.destination);
    this.reverb = { convolver, gain, context };
  }

  fire(doorId: string, leaf: THREE.Object3D, center: Readonly<Vec3Data>): void {
    if (this.sequence) return;
    this.prepareAudio();
    leaf.updateWorldMatrix(true, true);
    const parent = leaf.parent;
    if (!parent) return;
    const box = new THREE.Box3().setFromObject(leaf), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    const hinge = new THREE.Vector3().fromArray((leaf.userData.neighborHinge as number[] | undefined) ?? [mid.x, box.min.y, box.min.z]);
    // The thin axis of the leaf is its normal; inward points away from the player.
    const normal = size.x < size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    this.host.playerCenter(this.scratch);
    if (normal.dot(this.scratch.clone().sub(mid)) > 0) normal.negate();
    const pivot = new THREE.Group();
    pivot.name = 'neighbor-gunfire-hinge';
    parent.add(pivot);
    pivot.position.copy(parent.worldToLocal(hinge.clone()));
    pivot.updateWorldMatrix(true, false);
    const closed = leaf.matrix.clone(), auto = leaf.matrixAutoUpdate;
    pivot.attach(leaf);
    // Choose the swing that moves the free edge inward.
    pivot.rotation.y = 0.2; pivot.updateMatrixWorld(true);
    const opened = new THREE.Box3().setFromObject(leaf).getCenter(new THREE.Vector3());
    const sign = opened.sub(mid).dot(normal) > 0 ? 1 : -1;
    pivot.rotation.y = 0; pivot.updateMatrixWorld(true);
    // Darkness behind the crack, never the void of the model.
    const shade = new THREE.Mesh(this.voidGeometry, this.voidMaterial);
    shade.name = 'neighbor-gunfire-darkness';
    shade.scale.set(size.x < size.z ? 1.1 : size.x + 0.3, size.y + 0.1, size.x < size.z ? size.z + 0.3 : 1.1);
    shade.position.copy(mid).addScaledVector(normal, 0.62);
    this.host.scene.add(shade);
    this.sequence = { doorId, leaf, parent, closed, auto, pivot, void: shade, sign, center: new THREE.Vector3(center.x, center.y, center.z), inward: normal, time: 0, fired: false };
    this.host.doorSound('open', center, doorId);
  }

  update(delta: number): void {
    const s = this.sequence;
    if (!s) return;
    const dt = Math.max(0, Math.min(0.05, delta));
    s.time += dt;
    const t = s.time;
    const open = t < 0.16 ? 0.34 * (1 - (1 - t / 0.16) ** 3) : t < 1.25 ? 0.34 : 0.34 * Math.max(0, 1 - (t - 1.25) / 0.1);
    s.pivot.rotation.y = s.sign * open;
    s.pivot.updateMatrixWorld(true);
    // The gun slides out of the gap at chest height, then withdraws.
    const out = THREE.MathUtils.smoothstep(t, 0.18, 0.38) * (1 - THREE.MathUtils.smoothstep(t, 1.02, 1.2));
    this.gun.visible = out > 0.01;
    if (this.gun.visible) this.placeGun(s, out);
    const flash = this.flash.material as THREE.MeshBasicMaterial;
    flash.opacity = s.fired ? Math.max(0, 1 - (t - 0.62) / 0.07) : 0;
    if (!s.fired && t >= 0.62) { s.fired = true; this.shoot(s); }
    if (t >= 1.35 && open === 0) this.finish(true);
  }

  private placeGun(s: NonNullable<NeighborGunfire['sequence']>, out: number): void {
    // The free edge of the ajar leaf: the crack the hand comes through.
    const edge = new THREE.Box3().setFromObject(s.leaf);
    const point = edge.getCenter(this.scratch);
    point.y = edge.min.y + 1.36;
    const lateral = new THREE.Vector3(-s.inward.z, 0, s.inward.x);
    const toHinge = new THREE.Vector3().copy(s.pivot.getWorldPosition(new THREE.Vector3())).sub(point).setY(0);
    if (lateral.dot(toHinge) > 0) lateral.negate();
    point.addScaledVector(lateral, 0.16).addScaledVector(s.inward, -0.05 - out * 0.22);
    this.gun.position.copy(point);
    this.host.playerCenter(this.aim);
    this.aim.y += 0.45;
    this.gun.lookAt(this.aim);
    this.gun.updateMatrixWorld(true);
  }

  private shoot(s: NonNullable<NeighborGunfire['sequence']>): void {
    const host = this.host;
    const muzzle = new THREE.Vector3(0, 0.012, 0.18).applyMatrix4(this.gun.matrixWorld);
    const player = host.playerCenter(new THREE.Vector3());
    const chest = player.clone().setY(player.y + 0.4);
    const velocity = host.playerVelocity(new THREE.Vector3());
    const range = muzzle.distanceTo(chest);
    // A frightened, fast shot: tight up close, loose on a moving target.
    const spread = 0.05 + range * 0.035 + Math.min(1, Math.hypot(velocity.x, velocity.z) / 6.5) * 0.32;
    chest.x += this.random.float(-spread, spread);
    chest.y += this.random.float(-spread * 0.6, spread * 0.6);
    chest.z += this.random.float(-spread, spread);
    const direction = chest.sub(muzzle).normalize();
    const wall = host.physics.castEnvironmentRay(muzzle, direction, 40);
    const result = resolveShot(muzzle, direction, player, wall ? wall.distance : null);
    this.playShot(muzzle);
    host.flash(0.55);
    host.shake(1);
    if (result.kind === 'player') {
      host.onPlayerHit(direction);
    } else if (result.kind === 'wall' && wall) {
      const normal = new THREE.Vector3(wall.normal.x, wall.normal.y, wall.normal.z);
      this.addDecal(muzzle.clone().addScaledVector(direction, wall.distance), normal);
    }
    void s;
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    const decal = new THREE.Mesh(this.decalGeometry, this.decalMaterial);
    decal.name = 'neighbor-bullet-impact';
    decal.position.copy(point).addScaledVector(normal, 0.004);
    decal.lookAt(point.clone().add(normal));
    decal.rotateZ(this.random.float(0, Math.PI));
    decal.scale.setScalar(this.random.float(0.8, 1.25));
    this.host.scene.add(decal);
    this.decals.push(decal);
    while (this.decals.length > MAX_DECALS) this.decals.shift()!.removeFromParent();
  }

  private playShot(position: THREE.Vector3): void {
    const output = this.host.audio();
    if (!output || !this.shot || !this.reverb || this.reverb.context !== output.context) return;
    const { context } = output;
    if (context.state !== 'running') return;
    this.host.listener(this.listener);
    const toward = position.clone().sub(this.listener.position);
    const distance = Math.max(0.5, toward.length());
    const pan = THREE.MathUtils.clamp(toward.normalize().dot(this.listener.right), -1, 1) * 0.7;
    const source = context.createBufferSource(), dry = context.createGain(), panner = context.createStereoPanner(), send = context.createGain();
    source.buffer = this.shot;
    dry.gain.value = Math.min(1, 2.6 / (1 + distance * 0.35));
    panner.pan.value = pan;
    send.gain.value = 0.9;
    source.connect(dry).connect(panner).connect(output.destination);
    source.connect(send).connect(this.reverb.convolver);
    source.addEventListener('ended', () => { source.disconnect(); dry.disconnect(); panner.disconnect(); send.disconnect(); }, { once: true });
    source.start();
  }

  private finish(slam: boolean): void {
    const s = this.sequence;
    if (!s) return;
    this.sequence = undefined;
    this.gun.visible = false;
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 0;
    s.pivot.rotation.y = 0;
    s.pivot.updateMatrixWorld(true);
    s.parent.attach(s.leaf);
    s.leaf.matrix.copy(s.closed);
    s.leaf.matrix.decompose(s.leaf.position, s.leaf.quaternion, s.leaf.scale);
    s.leaf.matrixAutoUpdate = s.auto;
    s.leaf.updateMatrixWorld(true);
    s.pivot.removeFromParent();
    s.void.removeFromParent();
    if (slam) this.host.doorSound('slam', s.center, s.doorId);
  }

  dispose(): void {
    this.finish(false);
    for (const decal of this.decals) decal.removeFromParent();
    this.decals.length = 0;
    this.gun.removeFromParent();
    try { this.reverb?.convolver.disconnect(); this.reverb?.gain.disconnect(); } catch { /* closed */ }
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
