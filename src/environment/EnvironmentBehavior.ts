export interface EventState {
  consumed?: boolean;
  visited?: boolean;
  chairMoved?: boolean;
  /** Station of the lonely chair; it advances once per visit and departure. */
  chairIndex?: number;
  cameraYaw?: number;
  cameraPitch?: number;
  circuit?: 'off' | 'restored';
}
export interface EventStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** Only sparse deltas on disk; the cache stays bounded after arbitrarily many chunks.
 * Reading a chunk never scans the history or serializes every visited event. */
export class EnvironmentStateStore {
  private readonly cache = new Map<string, EventState>();
  constructor(readonly session: string, private readonly storage: EventStorage | null) {}
  private key(id: string): string { return `backrooms.environment.v1:${this.session}:${id}`; }
  read(id: string): EventState {
    let state = this.cache.get(id);
    if (!state) {
      state = {};
      try {
        const saved: unknown = JSON.parse(this.storage?.getItem(this.key(id)) ?? 'null');
        if (saved && typeof saved === 'object') {
          const s = saved as EventState;
          state = { consumed: s.consumed === true, visited: s.visited === true, chairMoved: s.chairMoved === true,
            ...(Number.isInteger(s.chairIndex) && s.chairIndex! >= 0 ? { chairIndex: s.chairIndex } : {}),
            ...(Number.isFinite(s.cameraYaw) ? { cameraYaw: s.cameraYaw } : {}), ...(Number.isFinite(s.cameraPitch) ? { cameraPitch: s.cameraPitch } : {}),
            ...(s.circuit === 'off' || s.circuit === 'restored' ? { circuit: s.circuit } : {}) };
        }
      } catch { /* Denied storage: the bounded session cache still works. */ }
    }
    this.touch(id, state); return { ...state };
  }
  write(id: string, state: EventState): void {
    this.touch(id, { ...state });
    try { this.storage?.setItem(this.key(id), JSON.stringify(state)); } catch { /* Quota/disabled storage must not interrupt play. */ }
  }
  private touch(id: string, state: EventState): void {
    this.cache.delete(id); this.cache.set(id, state);
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
  }
  get cachedCount(): number { return this.cache.size; }
}

/** The reveal only exists between two completely dark intervals. */
export const apparitionFrame = (time: number): { level: number; visible: boolean; progress: number } => {
  if (time < .32) return { level: 0, visible: false, progress: 0 };
  if (time < .89) return { level: .8 + .12 * Math.sin(time * 61), visible: true, progress: (time - .32) / .57 };
  if (time < 1.34) return { level: 0, visible: false, progress: 1 };
  if (time < 1.58) return { level: .48, visible: false, progress: 1 };
  if (time < 1.78) return { level: .03, visible: false, progress: 1 };
  return { level: 1, visible: false, progress: 1 };
};

export type PhoneCue = 'breath' | 'silence' | 'warning' | 'decision' | 'turned' | 'step' | 'hangup' | 'interrupt';
export class TelephoneSequence {
  phase: 'idle' | 'call' | 'warning' | 'decision' | 'obedient' | 'done' = 'idle';
  time = 0;
  private silent = false;
  private turnedFor = 0;
  private forward = { x: 0, z: -1 };
  answer(): PhoneCue[] { if (this.phase !== 'idle') return []; this.phase = 'call'; this.time = 0; return ['breath']; }
  interrupt(): PhoneCue[] { if (this.phase === 'idle' || this.phase === 'done') return []; this.phase = 'done'; return ['interrupt']; }
  update(delta: number, direction: { x: number; z: number }, warningDuration: number): PhoneCue[] {
    if (this.phase === 'idle' || this.phase === 'done') return [];
    this.time += Math.max(0, delta);
    const length = Math.hypot(direction.x, direction.z);
    if (this.phase === 'call') {
      if (this.time >= 3.8) {
        this.phase = 'warning'; this.time = 0;
        if (length > .2) this.forward = { x: direction.x / length, z: direction.z / length };
        return ['silence', 'warning'];
      }
      if (this.time >= 2.7 && !this.silent) { this.silent = true; return ['silence']; }
    } else if (this.phase === 'warning' && this.time >= warningDuration + .15) {
      this.phase = 'decision'; this.time = 0; return ['decision'];
    } else if (this.phase === 'decision') {
      const dot = length > .2 ? (this.forward.x * direction.x + this.forward.z * direction.z) / length : 1;
      this.turnedFor = dot < Math.cos(115 * Math.PI / 180) ? this.turnedFor + delta : 0;
      if (this.turnedFor >= .12) { this.phase = 'done'; return ['turned', 'hangup']; }
      if (this.time >= 10) { this.phase = 'obedient'; this.time = 0; return ['step']; }
    } else if (this.phase === 'obedient' && this.time >= .65) { this.phase = 'done'; return ['hangup']; }
    return [];
  }
}

const wrap = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));
export class SurveillanceBehavior {
  yaw = 0;
  pitch = 0;
  frozen = false;
  private awayTime = 0;
  update(delta: number, input: { distance: number; yaw: number; pitch: number; visible: boolean; detected: boolean }): { moving: boolean; click: boolean } {
    const dt = Math.max(0, Math.min(.1, delta));
    if (input.distance < 2.4) {
      const click = !this.frozen; this.frozen = true; this.awayTime = 0;
      return { moving: false, click };
    }
    if (this.frozen) {
      this.awayTime = input.distance > 4 ? this.awayTime + dt : 0;
      if (this.awayTime < 2.2 || input.visible) return { moving: false, click: false };
      this.frozen = false;
    }
    if (!input.detected || input.distance > 23 || Math.abs(input.yaw) > 1.25) return { moving: false, click: false };
    const yaw = Math.max(-1.15, Math.min(1.15, input.yaw)), pitch = Math.max(-.58, Math.min(.38, input.pitch));
    const dy = Math.max(-dt * .32, Math.min(dt * .32, wrap(yaw - this.yaw)));
    const dp = Math.max(-dt * .24, Math.min(dt * .24, pitch - this.pitch));
    this.yaw += dy; this.pitch += dp;
    return { moving: Math.abs(dy) + Math.abs(dp) > .0001, click: false };
  }
}
