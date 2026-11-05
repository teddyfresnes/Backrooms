import type { Vec3Data } from '../world/types';

export interface SpatialAudioBus { context: AudioContext; destination: AudioNode }

// Firefox still exposes the legacy listener methods on some versions/devices.
// Test the actual AudioParams, independently for position and orientation.
const hasParams = (...params: (AudioParam | undefined)[]): boolean => (
  params.every(param => param != null && typeof param.value === 'number')
);

export function setSpatialPosition(target: PannerNode | AudioListener, position: Readonly<Vec3Data>): void {
  if (hasParams(target.positionX, target.positionY, target.positionZ)) {
    target.positionX.value = position.x; target.positionY.value = position.y; target.positionZ.value = position.z;
  } else if (typeof target.setPosition === 'function') {
    target.setPosition(position.x, position.y, position.z);
  }
}

/** A short direct path, gently occluded by a closed door. No extra context. */
export function doorAudioChain(bus: SpatialAudioBus, position: Readonly<Vec3Data>, level: number, muffled:boolean|'mutter' = false, range: { refDistance?: number; maxDistance?: number; rolloff?: number } = {}): {
  input: AudioNode; setPosition(position: Readonly<Vec3Data>): void; setLevel(level: number): void; dispose(): void;
} {
  const { context, destination } = bus;
  const gain = context.createGain(), panner = context.createPanner(), filter = context.createBiquadFilter();
  gain.gain.value = level;
  filter.type = 'lowpass'; filter.frequency.value = muffled==='mutter'?950:muffled ? 2200 : 7200; filter.Q.value = .45;
  panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
  panner.refDistance = range.refDistance ?? 1.2; panner.maxDistance = range.maxDistance ?? 14; panner.rolloffFactor = range.rolloff ?? 1.4;
  setSpatialPosition(panner, position);
  filter.connect(gain).connect(panner).connect(destination);
  return { input: filter, setLevel: level => { if (typeof gain.gain.setTargetAtTime === 'function') gain.gain.setTargetAtTime(level, context.currentTime, .06); else gain.gain.value = level; }, setPosition: position => setSpatialPosition(panner, position),
    dispose: () => { filter.disconnect(); gain.disconnect(); panner.disconnect(); } };
}

export function setDoorAudioListener(bus: SpatialAudioBus | undefined, position: Readonly<Vec3Data>, forward: Readonly<Vec3Data>): void {
  if (!bus) return;
  const listener = bus.context.listener;
  if (!listener) return;
  setSpatialPosition(listener, position);
  if (hasParams(listener.forwardX, listener.forwardY, listener.forwardZ, listener.upX, listener.upY, listener.upZ)) {
    listener.forwardX.value = forward.x; listener.forwardY.value = forward.y; listener.forwardZ.value = forward.z;
    listener.upX.value = 0; listener.upY.value = 1; listener.upZ.value = 0;
  } else if (typeof listener.setOrientation === 'function') {
    listener.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
  }
}
