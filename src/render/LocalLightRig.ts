import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

export interface RuntimeLightSource {
  id: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  width: number;
  intensity: number;
  color: number;
  level: number;
  zoneId: string;
}

export type LightOcclusionTest = (
  playerPosition: THREE.Vector3,
  source: RuntimeLightSource,
) => boolean;

type ProxyPhase = 'idle' | 'fading-in' | 'steady' | 'fading-out';

interface BoundTransform {
  x: number;
  y: number;
  z: number;
  rotation: number;
  width: number;
}

interface LightProxy {
  readonly light: THREE.RectAreaLight;
  currentId?: string;
  pendingId?: string;
  bound?: BoundTransform;
  power: number;
  phase: ProxyPhase;
}

interface RankedSource {
  source: RuntimeLightSource;
  distanceSquared: number;
  score: number;
}

const DESKTOP_POOL_SIZE = 4;
const COARSE_POOL_SIZE = 2;
const ENTRY_RADIUS = 15;
const EXIT_RADIUS = 24;
const ENTRY_RADIUS_SQUARED = ENTRY_RADIUS * ENTRY_RADIUS;
const EXIT_RADIUS_SQUARED = EXIT_RADIUS * EXIT_RADIUS;
const SELECTION_INTERVAL = 0.25;
const SELECTION_MOVE_DISTANCE_SQUARED = 1;
const SECONDARY_ZONE_PENALTY = 144;
const STICKY_SCORE_BONUS = 81;
// The ambient field carries the exposure. These are deliberately only a soft
// local fluorescent accent; higher powers read as isolated pools on carpet.
const NOMINAL_POWER = 18;
const LIGHT_HEIGHT = 0.38;
const LIGHT_WIDTH_SCALE = 0.95;
const FADE_IN_RATE = 5;
const FADE_OUT_RATE = 8;
const MOVE_POWER_EPSILON = 0.5;
const STEADY_POWER_EPSILON = 0.5;
const TRANSFORM_EPSILON = 1e-5;

const horizontalDistanceSquared = (
  source: RuntimeLightSource,
  position: THREE.Vector3,
): number => {
  const dx = source.x - position.x;
  const dz = source.z - position.z;
  return dx * dx + dz * dz;
};

const damp = (current: number, target: number, rate: number, delta: number): number =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * delta));

const snapshotTransform = (source: RuntimeLightSource): BoundTransform => ({
  x: source.x,
  y: source.y,
  z: source.z,
  rotation: source.rotation,
  width: source.width,
});

const transformMatches = (bound: BoundTransform | undefined, source: RuntimeLightSource): boolean =>
  bound !== undefined &&
  Math.abs(bound.x - source.x) <= TRANSFORM_EPSILON &&
  Math.abs(bound.y - source.y) <= TRANSFORM_EPSILON &&
  Math.abs(bound.z - source.z) <= TRANSFORM_EPSILON &&
  Math.abs(bound.rotation - source.rotation) <= TRANSFORM_EPSILON &&
  Math.abs(bound.width - source.width) <= TRANSFORM_EPSILON;

const sourcePower = (source: RuntimeLightSource): number =>
  Number.isFinite(source.intensity) ? NOMINAL_POWER * Math.max(0, source.intensity) : 0;

/**
 * Maintains a small, fixed RectAreaLight pool for a streamed world.
 *
 * Runtime sources are selection anchors, not render objects. The rig keeps its
 * shader-visible pool stable and fades a proxy fully to zero before relocating
 * it, so a light can never pop or slide while it is emitting.
 */
export class LocalLightRig {
  private readonly proxies: LightProxy[] = [];
  private readonly sources = new Map<string, RuntimeLightSource>();
  private readonly lastSelectionPosition = new THREE.Vector3();
  private readonly occluded?: LightOcclusionTest;
  private lastSelectionTime = Number.NEGATIVE_INFINITY;
  private lastZoneId = '';
  private lastStoryLevel = Number.NaN;
  private selectionDirty = true;
  private hasSelectionPosition = false;
  private disposed = false;

  constructor(
    parent: THREE.Object3D,
    coarse: boolean,
    occluded?: LightOcclusionTest,
  ) {
    RectAreaLightUniformsLib.init();
    this.occluded = occluded;

    const count = coarse ? COARSE_POOL_SIZE : DESKTOP_POOL_SIZE;
    for (let index = 0; index < count; index += 1) {
      const light = new THREE.RectAreaLight(0xffefb4, 0, 1.5, LIGHT_HEIGHT);
      light.name = `runtime-area-light-${index}`;
      light.visible = true;
      parent.add(light);
      this.proxies.push({
        light,
        power: 0,
        phase: 'idle',
      });
    }
  }

  setSources(sources: readonly RuntimeLightSource[]): void {
    if (this.disposed) return;

    this.sources.clear();
    for (const source of sources) {
      this.sources.set(source.id, { ...source });
    }
    this.selectionDirty = true;
  }

  update(
    time: number,
    delta: number,
    playerPosition: THREE.Vector3,
    zoneId: string,
    storyLevel: number,
  ): void {
    if (this.disposed) return;

    const safeDelta = Number.isFinite(delta) ? THREE.MathUtils.clamp(delta, 0, 0.1) : 0;
    const movedEnough =
      !this.hasSelectionPosition ||
      this.lastSelectionPosition.distanceToSquared(playerPosition) >= SELECTION_MOVE_DISTANCE_SQUARED;
    const contextChanged = zoneId !== this.lastZoneId || storyLevel !== this.lastStoryLevel;
    const intervalElapsed =
      !Number.isFinite(this.lastSelectionTime) ||
      time < this.lastSelectionTime ||
      time - this.lastSelectionTime >= SELECTION_INTERVAL;

    if (this.selectionDirty || movedEnough || contextChanged || intervalElapsed) {
      const desired = this.selectSources(playerPosition, zoneId, storyLevel);
      this.reconcile(desired);
      this.lastSelectionTime = time;
      this.lastSelectionPosition.copy(playerPosition);
      this.hasSelectionPosition = true;
      this.lastZoneId = zoneId;
      this.lastStoryLevel = storyLevel;
      this.selectionDirty = false;
    }

    for (const proxy of this.proxies) {
      this.updateProxy(proxy, safeDelta);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sources.clear();

    for (const proxy of this.proxies) {
      proxy.light.power = 0;
      proxy.light.removeFromParent();
    }
    this.proxies.length = 0;
  }

  private selectSources(
    playerPosition: THREE.Vector3,
    zoneId: string,
    storyLevel: number,
  ): RuntimeLightSource[] {
    const stickyIds = new Set<string>();
    for (const proxy of this.proxies) {
      if (proxy.phase === 'fading-out') {
        if (proxy.pendingId !== undefined) stickyIds.add(proxy.pendingId);
      } else if (proxy.currentId !== undefined) {
        stickyIds.add(proxy.currentId);
      }
    }

    const ranked: RankedSource[] = [];
    for (const source of this.sources.values()) {
      if (source.level !== storyLevel) continue;

      const sticky = stickyIds.has(source.id);
      const distanceSquared = horizontalDistanceSquared(source, playerPosition);
      const radiusSquared = sticky ? EXIT_RADIUS_SQUARED : ENTRY_RADIUS_SQUARED;
      if (distanceSquared > radiusSquared) continue;

      const sameZone = source.zoneId === zoneId;
      if (!sameZone && this.occluded?.(playerPosition, source)) continue;

      ranked.push({
        source,
        distanceSquared,
        score:
          distanceSquared +
          (sameZone ? 0 : SECONDARY_ZONE_PENALTY) -
          (sticky ? STICKY_SCORE_BONUS : 0),
      });
    }

    ranked.sort(
      (a, b) =>
        a.score - b.score ||
        a.distanceSquared - b.distanceSquared ||
        a.source.id.localeCompare(b.source.id),
    );
    return ranked.slice(0, this.proxies.length).map((candidate) => candidate.source);
  }

  private reconcile(desiredSources: RuntimeLightSource[]): void {
    const desiredIds = new Set(desiredSources.map((source) => source.id));
    const claimedIds = new Set<string>();
    const reservedProxies = new Set<LightProxy>();

    // Preserve valid bindings first. A streamed transform change is treated as
    // a relocation and therefore has to pass through a complete fade-out.
    for (const proxy of this.proxies) {
      const currentId = proxy.currentId;
      if (currentId === undefined || !desiredIds.has(currentId)) continue;

      const source = this.sources.get(currentId);
      if (source === undefined || claimedIds.has(currentId)) continue;

      claimedIds.add(currentId);
      reservedProxies.add(proxy);
      if (transformMatches(proxy.bound, source)) {
        proxy.pendingId = undefined;
        if (proxy.phase === 'fading-out' || proxy.phase === 'idle') {
          proxy.phase = 'fading-in';
        }
      } else {
        proxy.pendingId = currentId;
        proxy.phase = 'fading-out';
      }
    }

    // Keep an in-progress target on the same proxy when it remains desirable.
    for (const desired of desiredSources) {
      if (claimedIds.has(desired.id)) continue;
      const proxy = this.proxies.find(
        (candidate) =>
          !reservedProxies.has(candidate) && candidate.pendingId === desired.id,
      );
      if (proxy === undefined) continue;

      claimedIds.add(desired.id);
      reservedProxies.add(proxy);
      proxy.pendingId = desired.id;
      proxy.phase = proxy.currentId === undefined ? 'idle' : 'fading-out';
    }

    // Assign remaining targets to idle proxies first, then to the dimmest proxy
    // that is already on its way out.
    for (const desired of desiredSources) {
      if (claimedIds.has(desired.id)) continue;
      const available = this.proxies
        .filter((proxy) => !reservedProxies.has(proxy))
        .sort((a, b) => {
          const aIdle = a.currentId === undefined ? 0 : 1;
          const bIdle = b.currentId === undefined ? 0 : 1;
          return aIdle - bIdle || a.power - b.power;
        })[0];
      if (available === undefined) break;

      claimedIds.add(desired.id);
      reservedProxies.add(available);
      available.pendingId = desired.id;
      if (available.currentId === undefined) {
        this.bindPendingAtZero(available);
      } else {
        available.phase = 'fading-out';
      }
    }

    // Everything that is no longer selected fades out in place.
    for (const proxy of this.proxies) {
      if (reservedProxies.has(proxy)) continue;
      proxy.pendingId = undefined;
      proxy.phase = proxy.currentId === undefined ? 'idle' : 'fading-out';
    }
  }

  private updateProxy(proxy: LightProxy, delta: number): void {
    let targetPower = 0;
    if (proxy.phase === 'fading-in' || proxy.phase === 'steady') {
      const source = proxy.currentId === undefined ? undefined : this.sources.get(proxy.currentId);
      if (source === undefined) {
        proxy.pendingId = undefined;
        proxy.phase = 'fading-out';
      } else {
        proxy.light.color.setHex(source.color);
        targetPower = sourcePower(source);
      }
    }

    const rate = proxy.phase === 'fading-out' ? FADE_OUT_RATE : FADE_IN_RATE;
    proxy.power = damp(proxy.power, targetPower, rate, delta);

    if (proxy.phase === 'fading-out' && proxy.power <= MOVE_POWER_EPSILON) {
      // Set the actual light to a hard zero before changing any transform.
      proxy.power = 0;
      proxy.light.power = 0;
      proxy.currentId = undefined;
      proxy.bound = undefined;
      if (proxy.pendingId !== undefined) {
        this.bindPendingAtZero(proxy);
      } else {
        proxy.phase = 'idle';
      }
    } else if (
      proxy.phase === 'fading-in' &&
      Math.abs(proxy.power - targetPower) <= STEADY_POWER_EPSILON
    ) {
      proxy.power = targetPower;
      proxy.phase = 'steady';
    } else if (proxy.phase === 'idle') {
      proxy.power = 0;
    }

    proxy.light.power = proxy.power;
  }

  private bindPendingAtZero(proxy: LightProxy): void {
    const pendingId = proxy.pendingId;
    const source = pendingId === undefined ? undefined : this.sources.get(pendingId);
    proxy.pendingId = undefined;

    if (source === undefined) {
      proxy.currentId = undefined;
      proxy.bound = undefined;
      proxy.power = 0;
      proxy.light.power = 0;
      proxy.phase = 'idle';
      return;
    }

    // This method is only called after the emitted power has reached zero.
    proxy.power = 0;
    proxy.light.power = 0;
    proxy.light.color.setHex(source.color);
    proxy.light.width = Math.max(0.05, source.width * LIGHT_WIDTH_SCALE);
    proxy.light.height = LIGHT_HEIGHT;
    proxy.light.position.set(source.x, source.y, source.z);
    proxy.light.lookAt(source.x, source.y - 5, source.z);
    proxy.light.rotateZ(source.rotation);
    proxy.currentId = source.id;
    proxy.bound = snapshotTransform(source);
    proxy.phase = 'fading-in';
  }
}
