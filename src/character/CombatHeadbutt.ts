import { characterRandom } from './CharacterRandom';
import * as THREE from 'three';
import { easeCombat } from './CombatRig.js';

/** A rare clinch action with a quota and a cooldown, never a per-frame roll. */
export class ClinchAttackVariation {
  constructor(private readonly random = characterRandom('clinch')) { this.quota = 7 + Math.floor(random() * 5); }
  private pushes = 0;
  private quota: number;
  private lastHeadbutt = -Infinity;

  chooseHeadbutt(now: number, distance: number, aligned = true): boolean {
    if (!Number.isFinite(now + distance) || distance < 0 || distance > .76) return false;
    if (aligned && this.pushes >= this.quota && now - this.lastHeadbutt >= 8) {
      this.pushes = 0;
      this.quota = 7 + Math.floor(this.random() * 5);
      this.lastHeadbutt = now;
      return true;
    }
    this.pushes++;
    return false;
  }

  reset(): void { this.pushes = 0; this.lastHeadbutt = -Infinity; }
}

/** Use the supplied FBX's load/thrust/recoil, without its 60 cm root translation. */
export function createCombatHeadbuttClip(source: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const identity = new THREE.Quaternion(), origin = new THREE.Quaternion(), q = new THREE.Quaternion();
  for (const track of source.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)
      || !/(spine\d*|neck|head|(?:left|right)(?:shoulder|arm|forearm|hand))\.quaternion$/i.test(track.name)) continue;
    const interpolant = new THREE.QuaternionLinearInterpolant(track.times, track.values, 4);
    origin.fromArray(interpolant.evaluate(0)).normalize().invert();
    const times: number[] = [], values: number[] = [];
    const torso = /spine\d*\.quaternion$/i.test(track.name);
    const head = /(head|neck)\.quaternion$/i.test(track.name);
    const maxAngle = THREE.MathUtils.degToRad(head ? 36 : torso ? 28 : 42);
    for (let i = 0; i <= 72; i++) {
      const t = i / 72;
      // The original forward thrust is at about 0.30 of the 2.1 second clip.
      // Preserve that beat, with a deliberate preparation and a longer recoil.
      const phase = t <= .48 ? .30 * t / .48 : .30 + .55 * (t - .48) / .52;
      q.fromArray(interpolant.evaluate(phase * source.duration)).normalize().premultiply(origin);
      const weight = easeCombat(THREE.MathUtils.smoothstep(t, 0, .14))
        * (1 - easeCombat(THREE.MathUtils.smoothstep(t, .70, 1)));
      const angle = identity.angleTo(q);
      const gain = head || torso ? 1 : .62;
      q.copy(identity.clone().slerp(q, weight * gain * Math.min(1, maxAngle / Math.max(1e-6, angle))));
      times.push(t); q.toArray(values, i * 4);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(track.name, times, values));
  }
  if (!tracks.some(track => /head\.quaternion$/i.test(track.name))) throw new Error('Headbutt FBX has no head track.');
  const clip = new THREE.AnimationClip(name, 1, tracks);
  clip.blendMode = THREE.AdditiveAnimationBlendMode;
  return clip;
}

export function headbuttContactDamage(distance: number, speed: number): number {
  if (!Number.isFinite(distance + speed) || distance > .94 || distance < 0 || speed < .35 || speed > 22) return 0;
  return Math.round(10 + 5 * THREE.MathUtils.smoothstep(speed, .8, 3.8));
}
