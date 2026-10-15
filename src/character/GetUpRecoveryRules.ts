export type GetUpSide = 'back' | 'belly';

export interface GetUpEligibility {
  readonly alive: boolean;
  readonly ragdollMode: 'dead' | 'pit-fall' | null;
  readonly settled: boolean;
  readonly recovering: boolean;
  readonly groundAvailable: boolean;
  readonly inputEnabled: boolean;
}

export const canGetUp = (state: GetUpEligibility): boolean =>
  state.alive
  && state.ragdollMode !== null
  && state.ragdollMode !== 'dead'
  && state.settled
  && !state.recovering
  && state.groundAvailable
  && state.inputEnabled;

/** Positive anatomical-front/up dot means lying on the back. */
export const chooseGetUpSide = (frontUpDot: number): GetUpSide =>
  Number.isFinite(frontUpDot) && frontUpDot < -0.08 ? 'belly' : 'back';

export const GET_UP_BLEND_SECONDS = 0.28;
export const GET_UP_MIN_DURATION = 0.5;
export const GET_UP_FORCE_READY_SECONDS = 1.25;

export const recoveryReadyForInput = (nativeReady: boolean, downSeconds: number): boolean =>
  nativeReady || (Number.isFinite(downSeconds) && downSeconds >= GET_UP_FORCE_READY_SECONDS);

export const shouldShowGetUpPrompt = (state: Pick<GetUpEligibility, 'alive' | 'ragdollMode' | 'recovering' | 'inputEnabled'>): boolean =>
  state.alive
  && state.ragdollMode !== null
  && state.ragdollMode !== 'dead'
  && !state.recovering
  && state.inputEnabled;

export const getUpProgress = (elapsed: number, duration: number): number =>
  Math.min(1, Math.max(0, elapsed / Math.max(GET_UP_MIN_DURATION, duration)));

export const getUpYawFromDirection = (
  x: number,
  z: number,
  fallback: number,
): number => Math.hypot(x, z) > 1e-4 ? Math.atan2(x, z) : fallback;
