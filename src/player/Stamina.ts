/**
 * The player's breath, as plain numbers. Calm, a sprint lasts about
 * `calmSprintSeconds`; walking recovers slowly, standing still faster. Empty,
 * sprinting stays cut until the bar is back to `resumeThreshold` (no stutter
 * sprint). Fear (`threat`) brings adrenaline: the sprint costs less, and the
 * scream that starts a chase refills part of the bar once. When it wears off
 * the crash follows: heavy panting and a slower recovery for a few seconds.
 * Never saved: a loaded game starts rested.
 */
export const STAMINA_TUNING = {
  calmSprintSeconds: 22,
  /** Fractions of the full bar per second. */
  walkRecovery: 1 / 40,
  idleRecovery: 1 / 13,
  /** No recovery right after a sprint (s). */
  recoveryDelay: 0.8,
  resumeThreshold: 0.35,
  /** Drain multiplier at full adrenaline. */
  adrenalineDrain: 0.6,
  /** One-off refill when the threat spikes (the scream). */
  adrenalineRefill: 0.3,
  adrenalineKickThreat: 0.85,
  adrenalineKickCooldown: 25,
  adrenalineRise: 2.5,
  /** Seconds the adrenaline holds once the threat is gone, then its fade per second. */
  adrenalineHold: 2.5,
  adrenalineFade: 1 / 7,
  crashSeconds: 7,
  crashRecovery: 0.35,
  /** Below this the discreet cue may show. */
  critical: 0.25,
} as const;

export interface StaminaInput {
  readonly sprinting: boolean;
  readonly moving: boolean;
  /** 0 calm .. 1 hunted right now (seen, heard close, chased). */
  readonly threat: number;
}

export class Stamina {
  level = 1;
  exhausted = false;
  adrenaline = 0;
  /** Seconds of contrecoup left. */
  crash = 0;
  /** Smoothed 0..1 effort shown by breath, bob and vignette. */
  breath = 0;
  private sinceSprint = 99;
  private hold = 0;
  private kickCooldown = 0;
  private previousThreat = 0;
  private peakAdrenaline = 0;
  private sprinting = false;

  get canSprint(): boolean { return !this.exhausted; }
  get critical(): boolean { return this.exhausted || this.level < STAMINA_TUNING.critical; }
  /** 0..1 how hard the heart pounds (effort or fear). */
  get heart(): number { return Math.max(this.breath * 0.85, this.adrenaline * 0.7); }

  update(delta: number, input: StaminaInput): void {
    const tuning = STAMINA_TUNING;
    const dt = Math.max(0, Math.min(0.25, delta));
    const threat = Math.max(0, Math.min(1, input.threat));
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    if (threat >= tuning.adrenalineKickThreat && this.previousThreat < tuning.adrenalineKickThreat && this.kickCooldown <= 0) {
      this.level = Math.min(1, this.level + tuning.adrenalineRefill);
      this.adrenaline = 1;
      this.kickCooldown = tuning.adrenalineKickCooldown;
    }
    this.previousThreat = threat;
    if (threat > 0.4) {
      this.adrenaline = Math.min(1, this.adrenaline + tuning.adrenalineRise * threat * dt);
      this.hold = tuning.adrenalineHold;
    } else if (this.hold > 0) this.hold -= dt;
    else if (this.adrenaline > 0) this.adrenaline = Math.max(0, this.adrenaline - tuning.adrenalineFade * dt);
    this.peakAdrenaline = Math.max(this.peakAdrenaline, this.adrenaline);
    if (this.adrenaline < 0.15 && this.peakAdrenaline > 0.6) {
      this.crash = tuning.crashSeconds;
      this.peakAdrenaline = 0;
    }
    this.crash = Math.max(0, this.crash - dt);

    this.sprinting = input.sprinting && !this.exhausted;
    if (this.sprinting) {
      this.level -= dt / tuning.calmSprintSeconds * (1 + (tuning.adrenalineDrain - 1) * this.adrenaline);
      this.sinceSprint = 0;
    } else {
      this.sinceSprint += dt;
      if (this.sinceSprint > tuning.recoveryDelay) {
        const rate = (input.moving ? tuning.walkRecovery : tuning.idleRecovery) * (this.crash > 0 ? tuning.crashRecovery : 1);
        this.level += rate * dt;
      }
    }
    if (this.level <= 0) { this.level = 0; this.exhausted = true; }
    this.level = Math.min(1, this.level);
    if (this.exhausted && this.level >= tuning.resumeThreshold) this.exhausted = false;

    const spent = Math.pow(1 - this.level, 1.2) * (this.sprinting ? 1 : 0.85);
    const target = Math.max(spent, this.crash > 0 ? 0.75 : 0, this.exhausted ? 0.9 : 0);
    this.breath += (target - this.breath) * (1 - Math.exp(-dt * (target > this.breath ? 1.5 : 0.35)));
  }

  reset(): void {
    this.level = 1; this.exhausted = false; this.adrenaline = 0; this.crash = 0; this.breath = 0;
    this.sinceSprint = 99; this.hold = 0; this.kickCooldown = 0; this.previousThreat = 0; this.peakAdrenaline = 0;
  }
}
