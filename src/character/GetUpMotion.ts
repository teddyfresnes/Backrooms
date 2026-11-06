import * as THREE from 'three';

/** Keep the weight-bearing part of the supplied take at one consistent tempo. */
const RECOVERY_TAKES = {
  back: { start: 1.42, end: 6.25 },
  belly: { start: 3.15, end: 8.60 },
} as const;
export const GET_UP_MOTION_RATE = 1.45;
export const GET_UP_SETTLE_SECONDS = 0.72;
const GET_UP_SETTLE_OVERLAP_SECONDS = 0.36;

export const createGetUpMotionClip = (
  character: THREE.Group,
  source: THREE.AnimationClip,
  standing: THREE.AnimationClip,
  side: 'back' | 'belly',
): THREE.AnimationClip => {
  // The removed sections are prone waiting and the already-standing tail.
  // The actual roll, hand support, knee placement and rise remain authored.
  const take = RECOVERY_TAKES[side];
  const start = Math.min(take.start, source.duration * 0.35);
  const end = Math.min(take.end, source.duration);
  const riseSeconds = (end - start) / GET_UP_MOTION_RATE;
  const duration = riseSeconds + GET_UP_SETTLE_SECONDS;
  const count = Math.ceil(duration * 60);
  const times = Array.from({ length: count + 1 }, (_, i) => duration * i / count);
  const sourceTracks = new Map(source.tracks.map(track => [track.name, track]));
  const standingTracks = new Map(standing.tracks.map(track => [track.name, track]));
  const tracks: THREE.KeyframeTrack[] = [];
  const settle = (t: number): number => {
    // Begin relaxing only once the hands have left the floor. The shoulders
    // and head settle over more than a second, rather than whipping into idle.
    const u = THREE.MathUtils.clamp((t - riseSeconds + GET_UP_SETTLE_OVERLAP_SECONDS)
      / (GET_UP_SETTLE_SECONDS + GET_UP_SETTLE_OVERLAP_SECONDS), 0, 1);
    return u * u * u * (u * (u * 6 - 15) + 10);
  };
  character.traverse(object => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    const rotationName = `${bone.name}.quaternion`;
    const sourceRotation = sourceTracks.get(rotationName);
    const restRotationTrack = standingTracks.get(rotationName);
    const motion = sourceRotation ? new THREE.QuaternionLinearInterpolant(sourceRotation.times, sourceRotation.values, 4) : undefined;
    const restRotation = restRotationTrack ? new THREE.QuaternionLinearInterpolant(restRotationTrack.times, restRotationTrack.values, 4).evaluate(0) : undefined;
    const standingRotation = restRotation
      ? new THREE.Quaternion().fromArray(restRotation) : bone.quaternion.clone();
    const quaternionValues: number[] = [];
    const previous = new THREE.Quaternion();
    for (const [i, t] of times.entries()) {
      const q = motion ? new THREE.Quaternion().fromArray(motion.evaluate(Math.min(end, start + t * GET_UP_MOTION_RATE)))
        : bone.quaternion.clone();
      q.normalize().slerp(standingRotation, settle(t)).normalize();
      if (i > 0 && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      quaternionValues.push(q.x, q.y, q.z, q.w);
      previous.copy(q);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(rotationName, times, quaternionValues));

    const positionName = `${bone.name}.position`;
    const isHips = /hips$/i.test(bone.name);
    const sourcePosition = isHips ? sourceTracks.get(positionName) : undefined;
    const restPositionTrack = isHips ? standingTracks.get(positionName) : undefined;
    const hipMotion = sourcePosition ? new THREE.LinearInterpolant(sourcePosition.times, sourcePosition.values, 3) : undefined;
    const restPosition = restPositionTrack ? new THREE.LinearInterpolant(restPositionTrack.times, restPositionTrack.values, 3).evaluate(0) : undefined;
    const standingPosition = restPosition ? new THREE.Vector3().fromArray(restPosition) : bone.position.clone();
    const positionValues: number[] = [];
    for (const t of times) {
      const p = hipMotion ? new THREE.Vector3().fromArray(hipMotion.evaluate(Math.min(end, start + t * GET_UP_MOTION_RATE)))
        : standingPosition.clone();
      p.lerp(standingPosition, settle(t));
      positionValues.push(p.x, p.y, p.z);
    }
    // Ragdoll bone positions may have stretched slightly. Restore the ordinary
    // skeleton through the entry crossfade, instead of leaving those offsets
    // behind until the final handoff to the player/NPC mixer.
    tracks.push(new THREE.VectorKeyframeTrack(positionName, times, positionValues));
  });
  return new THREE.AnimationClip(`${source.name}_NaturalRecovery`, duration, tracks);
};
