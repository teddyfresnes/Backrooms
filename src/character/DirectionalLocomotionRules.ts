export type ForwardDiagonalAnimation =
  | 'walking-forward-left'
  | 'walking-forward-right'
  | 'running-forward-left'
  | 'running-forward-right';

/**
 * Forward diagonals are explicit authored-style states instead of falling through
 * to either pure forward or pure strafe. Backward+strafe deliberately keeps the
 * existing behaviour because this pass only targets forward diagonal travel.
 */
export const forwardDiagonalAnimation = (
  forward: number,
  right: number,
  sprinting: boolean,
): ForwardDiagonalAnimation | null => {
  if (!Number.isFinite(forward) || !Number.isFinite(right)) return null;
  if (forward <= 0.15 || Math.abs(right) <= 0.15 || forward < Math.abs(right) * 0.55) return null;
  if (sprinting) return right >= 0 ? 'running-forward-right' : 'running-forward-left';
  return right >= 0 ? 'walking-forward-right' : 'walking-forward-left';
};


export const FORWARD_LATERAL_ANIMATION_COMMIT_SECONDS = 0.105;
export const FORWARD_LATERAL_ANIMATION_DEADZONE = 0.15;
export const STRAFE_DIRECTION_COMMIT_SECONDS = 0.09;

/**
 * Animation-only side-intent gate for forward locomotion. Physics still reacts
 * to Q/D instantly, but the feet only commit to a new left/right diagonal once
 * that side has been held briefly. Rapid Q-D-Q-D spam therefore falls back to
 * the straight walk instead of crossfading opposing strafe cycles every few
 * frames, which was the visible skating/gliding failure. Pure strafing and
 * backward travel remain immediate.
 */
export class ForwardLateralAnimationGate {
  private committedSide: -1 | 0 | 1 = 0;
  private candidateSide: -1 | 0 | 1 = 0;
  private candidateElapsed = 0;
  private strafeCommittedSide: -1 | 0 | 1 = 0;
  private strafeCandidateSide: -1 | 0 | 1 = 0;
  private strafeCandidateElapsed = 0;

  update(forward: number, right: number, delta: number): number {
    if (![forward, right, delta].every(Number.isFinite)) {
      this.reset();
      return 0;
    }

    const safeRight = Math.max(-1, Math.min(1, right));
    const side: -1 | 0 | 1 = Math.abs(safeRight) > FORWARD_LATERAL_ANIMATION_DEADZONE
      ? (safeRight < 0 ? -1 : 1)
      : 0;

    // Pure/reverse strafing needs its own direction hysteresis. Switching the
    // authored left/right FBX every few frames used to reset both clips near
    // frame zero, so the capsule moved while the legs appeared frozen. Keep the
    // currently committed side until the opposite input has been held long
    // enough to be intentional. Physics remains immediate; this is visual only.
    if (forward <= 0.15) {
      this.committedSide = 0;
      this.candidateSide = 0;
      this.candidateElapsed = 0;
      if (side === 0) {
        this.strafeCommittedSide = 0;
        this.strafeCandidateSide = 0;
        this.strafeCandidateElapsed = 0;
        return 0;
      }
      if (this.strafeCommittedSide === 0) {
        this.strafeCommittedSide = side;
        this.strafeCandidateSide = side;
        this.strafeCandidateElapsed = 0;
        return safeRight;
      }
      if (side === this.strafeCommittedSide) {
        this.strafeCandidateSide = side;
        this.strafeCandidateElapsed = 0;
        return safeRight;
      }
      if (side !== this.strafeCandidateSide) {
        this.strafeCandidateSide = side;
        this.strafeCandidateElapsed = 0;
      } else {
        this.strafeCandidateElapsed += Math.max(0, delta);
      }
      if (this.strafeCandidateElapsed >= STRAFE_DIRECTION_COMMIT_SECONDS) {
        this.strafeCommittedSide = side;
        this.strafeCandidateElapsed = 0;
        return safeRight;
      }
      return this.strafeCommittedSide * Math.max(Math.abs(safeRight), FORWARD_LATERAL_ANIMATION_DEADZONE + 0.01);
    }

    this.strafeCommittedSide = 0;
    this.strafeCandidateSide = 0;
    this.strafeCandidateElapsed = 0;

    if (side === 0) {
      this.reset();
      return 0;
    }

    if (side === this.committedSide) {
      this.candidateSide = side;
      this.candidateElapsed = 0;
      return safeRight;
    }

    // The instant an opposite side is requested, drop the old committed diagonal.
    // If the player now chatters back to that old side it must earn the same
    // short stability window again; otherwise a previously committed D could
    // still flash every other frame during Q-D-Q-D spam.
    if (this.committedSide !== 0) this.committedSide = 0;

    if (side !== this.candidateSide) {
      this.candidateSide = side;
      this.candidateElapsed = 0;
    } else {
      this.candidateElapsed += Math.max(0, delta);
    }

    // As soon as the player asks for the opposite side, visually pass through
    // straight walking rather than blending left and right cycles together.
    // Only a stable held side is allowed to become the next diagonal.
    if (this.candidateElapsed < FORWARD_LATERAL_ANIMATION_COMMIT_SECONDS) return 0;

    this.committedSide = side;
    this.candidateElapsed = 0;
    return safeRight;
  }

  reset(): void {
    this.committedSide = 0;
    this.candidateSide = 0;
    this.candidateElapsed = 0;
    this.strafeCommittedSide = 0;
    this.strafeCandidateSide = 0;
    this.strafeCandidateElapsed = 0;
  }
}
