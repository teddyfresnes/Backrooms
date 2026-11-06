/** Shared output calibration for the menu, wardrobe and in-game audio buses. */
export function connectAudioOutput(context: AudioContext, master: GainNode): void {
  const boost = context.createGain();
  boost.gain.value = 3.2;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 5;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  master.connect(boost).connect(limiter).connect(context.destination);
}
