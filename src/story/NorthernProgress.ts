/** Sparse story checkpoint; never stores the history of streamed circuits. */
export type NorthernStage = 'approach' | 'red-zone' | 'inspect-compass' | 'compass-glitch' | 'slides' | 'slides-ready';
export interface NorthernProgress {
  version: 1;
  stage: NorthernStage;
  walkedRed: number;
  compassSeconds: number;
  target?: { x: number; story: number };
}
export const COMPASS_GLITCH_SECONDS = 3.2;
export const freshNorthernProgress = (): NorthernProgress => ({ version: 1, stage: 'approach', walkedRed: 0, compassSeconds: 0 });
const STAGES: NorthernStage[] = ['approach', 'red-zone', 'inspect-compass', 'compass-glitch', 'slides', 'slides-ready'];
export const sanitizeNorthernProgress = (value: unknown): NorthernProgress | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const s = value as Partial<NorthernProgress>;
  if (s.version !== 1 || !STAGES.includes(s.stage as NorthernStage)
    || !Number.isFinite(s.walkedRed) || s.walkedRed! < 0 || s.walkedRed! > 8
    || !Number.isFinite(s.compassSeconds) || s.compassSeconds! < 0 || s.compassSeconds! > COMPASS_GLITCH_SECONDS) return null;
  let target: NorthernProgress['target'];
  if (s.target !== undefined) {
    if (!s.target || !Number.isSafeInteger(s.target.x) || Math.abs(s.target.x) > 1e6
      || !Number.isSafeInteger(s.target.story) || Math.abs(s.target.story) > 1e6) return null;
    target = { x: s.target.x, story: s.target.story };
  }
  if (['compass-glitch', 'slides', 'slides-ready'].includes(s.stage!) && !target) return null;
  return { version: 1, stage: s.stage!, walkedRed: s.walkedRed!, compassSeconds: s.compassSeconds!, ...(target ? { target } : {}) };
};

export interface NorthernStep {
  delta: number;
  z: number;
  redEntryZ: number;
  available: boolean;
  riftResolved: boolean;
  compassVisible: boolean;
  owner: { x: number; story: number };
}
export class NorthernProgression {
  readonly state: NorthernProgress;
  private previousZ?: number;
  constructor(saved?: NorthernProgress) { this.state = saved ? { ...saved, ...(saved.target ? { target: { ...saved.target } } : {}) } : freshNorthernProgress(); }
  /** Called only in unpaused play. Equipping must finish before the anomaly runs. */
  step(input: NorthernStep): { changed: boolean; comment: boolean } {
    const s = this.state, before = s.stage, last = this.previousZ;
    this.previousZ = input.z;
    if (!input.available || !input.riftResolved) return { changed: false, comment: false };
    let comment = false;
    if (s.stage === 'approach' && input.z <= input.redEntryZ) s.stage = 'red-zone';
    if (s.stage === 'red-zone') {
      const north = last === undefined ? 0 : last - input.z;
      // Ignore teleports, falls and huge frame gaps; entering an old far-north
      // checkpoint catches up without demanding a return to the band entrance.
      if (north > 0 && north < 3 && input.z <= input.redEntryZ) s.walkedRed = Math.min(8, s.walkedRed + north);
      if (s.walkedRed >= 8 || input.z < input.redEntryZ - 24) { s.stage = 'inspect-compass'; comment = true; }
    }
    if (s.stage === 'inspect-compass' && input.compassVisible) {
      s.stage = 'compass-glitch'; s.target = { ...input.owner };
    }
    if (s.stage === 'compass-glitch' && input.compassVisible) {
      s.compassSeconds = Math.min(COMPASS_GLITCH_SECONDS, s.compassSeconds + Math.max(0, Math.min(.1, input.delta)));
      if (s.compassSeconds >= COMPASS_GLITCH_SECONDS) s.stage = 'slides';
    }
    return { changed: before !== s.stage, comment };
  }
  get anomaly(): number {
    if (this.state.stage !== 'compass-glitch') return 0;
    return this.state.compassSeconds < 2.2 ? 1 : Math.max(0, 1 - (this.state.compassSeconds - 2.2));
  }
  get quest(): string | null {
    switch (this.state.stage) {
      case 'approach': return null;
      case 'red-zone': return 'Avancer dans la zone rouge';
      case 'inspect-compass': return 'Regarder la boussole';
      case 'compass-glitch': return 'Observer la boussole';
      case 'slides': return 'Suivre la direction indiquée par la boussole';
      case 'slides-ready': return 'Trouver l’accès aux toboggans';
    }
  }
  get snapshot(): NorthernProgress { return { ...this.state, ...(this.state.target ? { target: { ...this.state.target } } : {}) }; }
}
