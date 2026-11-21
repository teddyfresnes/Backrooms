import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SlideDive, type SlideDiveHost, type SlideDiveRequest } from './SlideDive';
import { createSlidesFeature, slidePath } from '../world/SlidesStructure';

const setup = (withCharacter = true) => {
  const feature = createSlidesFeature(), entry = feature.entries[2]!, offset = new THREE.Vector3(448, -10.8, -560);
  const request: SlideDiveRequest = { entry, structureId: feature.id, owner: { x: 4, z: -5, story: -2 }, offset, floorY: 0 };
  const camera = new THREE.PerspectiveCamera(70, 1, .04, 180);
  camera.position.set(offset.x + entry.position.x + .4, offset.y + 1.6, offset.z + feature.wallZ + 2);
  const fades: number[] = [], samples: { pitch: number; leap: number; hips?: THREE.Vector3 }[] = [];
  let landed: () => void = () => undefined;
  const character = {
    beginSlideDive: vi.fn(() => true),
    sampleSlideDive: vi.fn((s: { pitch: number; leap: number; hips?: THREE.Vector3 }) => { samples.push({ ...s, hips: s.hips?.clone() }); return null; }),
    setExternalCameraPresentation: vi.fn(),
  };
  const host: SlideDiveHost = {
    camera, character: () => withCharacter ? character : undefined,
    feet: () => new THREE.Vector3(offset.x + entry.position.x + .4, offset.y, offset.z + feature.wallZ + 2),
    baseFieldOfView: () => 70, reducedMotion: () => false, setFade: level => fades.push(level),
    land: vi.fn(() => new Promise<void>(resolve => { landed = resolve; })),
  };
  return { feature, entry, request, camera, host, character, fades, samples, land: () => landed() };
};

describe('slide dive', () => {
  it('walks up, dives head first into the mouth, rides the real bore and lands once, in the dark', async () => {
    const t = setup(), dive = new SlideDive(t.host, t.request);
    expect(t.character.beginSlideDive).toHaveBeenCalledOnce();
    const mouth = new THREE.Vector3().copy(t.entry.position).add(t.request.offset);
    let lookedAtMouth = false, insideBore = false;
    const path = slidePath(t.entry).map(p => new THREE.Vector3(p.x, p.y, p.z).add(t.request.offset));
    for (let i = 0; i < 400 && dive.active && !(t.host.land as ReturnType<typeof vi.fn>).mock.calls.length; i++) {
      dive.update(1 / 60); dive.applyCamera();
      const toMouth = mouth.clone().sub(t.camera.position).normalize();
      if (t.camera.getWorldDirection(new THREE.Vector3()).dot(toMouth) > .9) lookedAtMouth = true;
      if (Math.min(...path.map(p => p.distanceTo(t.camera.position))) < .25 && t.camera.position.z < mouth.z) insideBore = true;
    }
    expect(lookedAtMouth).toBe(true); expect(insideBore).toBe(true);
    // The body pitches forward and its pelvis ends inside the tube, behind the wall.
    const last = t.samples.at(-1)!;
    expect(last.pitch).toBeGreaterThan(1.3); expect(last.leap).toBe(1); expect(last.hips!.z).toBeLessThan(mouth.z - 1);
    expect(t.character.setExternalCameraPresentation).toHaveBeenCalledWith(true);
    // Fully black before the body is moved, and only one landing.
    expect(t.fades.at(-1)).toBeCloseTo(1, 5); expect(t.host.land).toHaveBeenCalledOnce();
    for (let i = 0; i < 30; i++) { dive.update(1 / 60); dive.applyCamera(); }
    expect(t.host.land).toHaveBeenCalledOnce(); expect(dive.active).toBe(true);
    t.land(); await Promise.resolve(); await Promise.resolve();
    expect(dive.active).toBe(false);
  });
  it('still plays the shot and the ride without a character rig', () => {
    const t = setup(false), dive = new SlideDive(t.host, t.request);
    for (let i = 0; i < 400 && !(t.host.land as ReturnType<typeof vi.fn>).mock.calls.length; i++) { dive.update(1 / 60); dive.applyCamera(); }
    expect(t.host.land).toHaveBeenCalledOnce(); expect(Number.isFinite(t.camera.position.x + t.camera.quaternion.w)).toBe(true);
  });
});
