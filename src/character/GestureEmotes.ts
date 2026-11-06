import * as THREE from 'three';
import { easeCombat, solveCombatTwoBone } from './CombatRig';

export type Gesture = 'middle-finger' | 'follow-me' | 'wait';

/** Bake on the supplied skeleton once; playback uses the ordinary two mixers. */
export function createGestureEmote(rig: THREE.Group, idle: THREE.AnimationClip, gesture: Gesture): THREE.AnimationClip {
  const reference = rig.clone(true), bones = new Map<string, THREE.Bone>();
  reference.traverse(object => { if ((object as THREE.Bone).isBone) bones.set(object.name, object as THREE.Bone); });
  const rest = new Map([...bones.values()].map(bone => [bone, bone.quaternion.clone()]));
  for (const track of idle.tracks) {
    const bone = bones.get(track.name.replace(/\.(quaternion|position)$/, ''));
    if (!bone) continue;
    if (track instanceof THREE.QuaternionKeyframeTrack) bone.quaternion.fromArray(new THREE.QuaternionLinearInterpolant(track.times, track.values, 4).evaluate(0));
  }
  const find = (suffix: string) => [...bones.values()].find(bone => bone.name.toLowerCase().endsWith(suffix));
  const hips = find('hips'), head = find('head'), upper = find('rightarm'), lower = find('rightforearm'), hand = find('righthand');
  if (!hips || !head || !upper || !lower || !hand) throw new Error('Gesture emotes need the right arm and standing skeleton.');
  const middle = find('righthandmiddle1'), index = find('righthandindex1'), pinky = find('righthandpinky1');
  if (!middle || !index || !pinky) throw new Error('Gesture emotes need the articulated fingers.');
  const base = [...bones.values()].map(bone => ({ bone, rotation: bone.quaternion.clone(), position: bone.position.clone() }));
  reference.updateWorldMatrix(true, true);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(reference.getWorldQuaternion(new THREE.Quaternion()));
  forward.y = 0; forward.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = upper.getWorldPosition(new THREE.Vector3()).sub(find('leftarm')?.getWorldPosition(new THREE.Vector3()) ?? hips.getWorldPosition(new THREE.Vector3()));
  right.y = 0; right.normalize();
  const chest = hips.getWorldPosition(new THREE.Vector3()).lerp(head.getWorldPosition(new THREE.Vector3()), .72);
  const finger = middle.position.clone().normalize(), width = index.position.clone().sub(pinky.position);
  width.addScaledVector(finger, -width.dot(finger)).normalize();
  const palm = finger.clone().cross(width).normalize();
  const localHand = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(finger.clone().cross(palm), finger, palm));
  const duration = gesture === 'follow-me' ? 2.5 : 2.1;
  const steps = Math.round(duration * 30), times: number[] = [];
  const values = new Map([...bones.values()].map(bone => [bone, [] as number[]]));
  const rotateWorld = (bone: THREE.Bone, axis: THREE.Vector3, angle: number) => {
    const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)).normalize();
    bone.updateWorldMatrix(false, true);
  };
  for (let i = 0; i <= steps; i++) {
    const time = i * duration / steps;
    for (const pose of base) { pose.bone.quaternion.copy(pose.rotation); pose.bone.position.copy(pose.position); }
    reference.updateWorldMatrix(true, true);
    const weight = easeCombat(time / .38) * (1 - easeCombat((time - duration + .45) / .45));
    const beckon = gesture === 'follow-me' ? (1 - Math.cos(2 * Math.PI * THREE.MathUtils.clamp((time - .4) / 1.5, 0, 1) * 2)) / 2 : 0;
    const target = chest.clone().addScaledVector(right, .21).addScaledVector(forward,
      gesture === 'wait' ? .46 : gesture === 'follow-me' ? .44 - .14 * beckon : .27);
    target.y += gesture === 'middle-finger' ? .13 : gesture === 'wait' ? .08 : -.04;
    solveCombatTwoBone(upper, lower, hand, target, weight, right.clone().addScaledVector(up, -.5), .975, Math.PI / 2);
    const wantedNormal = gesture === 'follow-me' ? up.clone().addScaledVector(forward, -.35).normalize()
      : forward.clone().multiplyScalar(gesture === 'wait' ? 1 : -1);
    const wantedFinger = (gesture === 'follow-me' ? forward : up).clone();
    wantedFinger.addScaledVector(wantedNormal, -wantedFinger.dot(wantedNormal)).normalize();
    const handWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(wantedFinger.clone().cross(wantedNormal), wantedFinger, wantedNormal))
      .multiply(localHand.clone().invert());
    hand.quaternion.slerp(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handWorld).normalize(), weight).normalize();
    hand.updateWorldMatrix(false, true);
    for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      let curlAxis: THREE.Vector3 | undefined;
      for (let joint = 1; joint <= 3; joint++) {
        const bone = find(`righthand${name}${joint}`);
        if (!bone) continue;
        bone.quaternion.slerp(rest.get(bone)!, weight).normalize();
        bone.updateWorldMatrix(false, true);
        const child = bone.children.find(object => (object as THREE.Bone).isBone);
        const direction = child ? child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()))
          : bone.position.clone().applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()));
        // Every phalanx bends about the same palm-width axis. Recomputing it
        // after curling the knuckle would straighten the following joints.
        curlAxis ??= direction.normalize().cross(wantedNormal).normalize();
        const curl = gesture === 'middle-finger' ? name === 'middle' ? 0 : name === 'thumb' ? .55 : [1.2, 1.6, .75][joint - 1]!
          : gesture === 'follow-me' && name !== 'thumb' ? [.8, 1.25, .6][joint - 1]! * beckon : 0;
        if (curl && curlAxis.lengthSq() > .5) rotateWorld(bone, curlAxis, curl * weight);
        if (gesture === 'wait' && joint === 1 && name !== 'thumb' && name !== 'middle') {
          const spread = name === 'index' ? -.07 : name === 'ring' ? .05 : .10;
          rotateWorld(bone, wantedNormal, spread * weight);
        }
      }
    }
    if (gesture === 'middle-finger') {
      const thumb = [1, 2, 3].map(joint => find(`righthandthumb${joint}`));
      if (thumb.every(Boolean)) solveCombatTwoBone(thumb[0]!, thumb[1]!, thumb[2]!,
        index.getWorldPosition(new THREE.Vector3()).lerp(hand.getWorldPosition(new THREE.Vector3()), .18).addScaledVector(wantedNormal, .02),
        weight, wantedNormal, .975, Math.PI / 3);
    }
    times.push(time);
    for (const pose of base) pose.bone.quaternion.toArray(values.get(pose.bone)!, i * 4);
  }
  const tracks: THREE.KeyframeTrack[] = base.map(({ bone }) => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values.get(bone)!));
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, [0, duration], [...hips.position.toArray(), ...hips.position.toArray()]));
  return new THREE.AnimationClip(`emote-${gesture}`, duration, tracks);
}

/** The take's final tail resets its stance. End the rise with a planted idle pose. */
export function finishFreezeEmote(pose: THREE.AnimationClip, source: THREE.AnimationClip, idle: THREE.AnimationClip, hips: THREE.Bone): { pose: THREE.AnimationClip; source: THREE.AnimationClip } {
  const cut = 5.55, duration = cut + .4;
  const tracks = pose.tracks.map(track => {
    const interpolant = track instanceof THREE.QuaternionKeyframeTrack
      ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4) : new THREE.LinearInterpolant(track.times, track.values, 3);
    const size = track.getValueSize(), times = [...track.times].filter(time => time < cut), values: number[] = [];
    for (const time of times) values.push(...Array.from(interpolant.evaluate(time)));
    const from = Array.from(interpolant.evaluate(cut));
    const idleTrack = idle.tracks.find(other => other.name === track.name);
    const to = track instanceof THREE.QuaternionKeyframeTrack
      ? idleTrack ? Array.from(new THREE.QuaternionLinearInterpolant(idleTrack.times, idleTrack.values, 4).evaluate(0)) : from
      : hips.position.toArray();
    for (let i = 0; i <= 12; i++) {
      times.push(cut + .4 * i / 12);
      const weight = easeCombat(i / 12);
      if (size === 4) values.push(...new THREE.Quaternion().fromArray(from).slerp(new THREE.Quaternion().fromArray(to), weight).normalize().toArray());
      else values.push(...from.map((value, index) => THREE.MathUtils.lerp(value, to[index]!, weight)));
    }
    return track instanceof THREE.QuaternionKeyframeTrack ? new THREE.QuaternionKeyframeTrack(track.name, times, values) : new THREE.VectorKeyframeTrack(track.name, times, values);
  });
  const root = source.tracks.find(track => /hips\.position$/i.test(track.name))!;
  const interpolant = new THREE.LinearInterpolant(root.times, root.values, 3);
  const times = [...root.times].filter(time => time < cut), values = times.flatMap(time => Array.from(interpolant.evaluate(time)));
  const end = Array.from(interpolant.evaluate(cut));
  times.push(cut, duration); values.push(...end, ...end);
  return { pose: new THREE.AnimationClip(pose.name, duration, tracks), source: new THREE.AnimationClip(source.name, duration,
    [new THREE.VectorKeyframeTrack(root.name, times, values)]) };
}
