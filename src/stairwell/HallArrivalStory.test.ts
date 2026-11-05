import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { HallArrivalStory, HOME_REMINDER, MAIL_REMINDER } from './HallArrivalStory';
import type { HallArrivalState } from '../core/SaveHistory';

function setup(state: HallArrivalState = 'approach') {
  const mailbox = new THREE.Group();
  const door = new THREE.Group(); door.name = 'Door_3';
  // The source leaf's local Z is the vertical hinge axis.
  door.rotation.x = -Math.PI / 2;
  door.add(new THREE.Mesh(new THREE.BoxGeometry(.4, .02, .3), new THREE.MeshStandardMaterial()));
  mailbox.add(door); mailbox.position.set(-1.6, 1.6, -4.6); mailbox.rotation.y = Math.PI / 2;
  mailbox.updateMatrixWorld(true);
  const ui = { setInteraction: vi.fn() }, voice = vi.fn(), change = vi.fn();
  const caption = { say: vi.fn(), update: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
  return { story: new HallArrivalStory(mailbox, ui, caption, state, voice, change), mailbox, door, ui, voice, change, caption };
}
const player = new THREE.Vector3(-.2, .865, -4.6);
const left = new THREE.Vector3(-1, 0, 0), forward = new THREE.Vector3(0, 0, 1);

describe('arrival mail sequence', () => {
  it('reminds once on the approach to the stairs, highlights one leaf and retrieves only on a valid E action', () => {
    const s = setup();
    s.story.update(.02, player, forward, true);
    expect(s.voice).not.toHaveBeenCalled();
    s.story.update(.02, new THREE.Vector3(-.4, .865, -3.5), forward, true);
    expect(s.story.getState()).toBe('mail'); expect(s.voice).toHaveBeenCalledExactlyOnceWith('hmm');
    expect(s.caption.say).toHaveBeenCalledWith(MAIL_REMINDER);
    expect(s.mailbox.getObjectByName('mail-recipient-highlight')!.visible).toBe(true);
    s.story.update(.02, player, left, true);
    expect(s.ui.setInteraction).toHaveBeenLastCalledWith('Récupérer le courrier');
    expect(s.story.interact(player, forward, true)).toBe(false);
    expect(s.story.interact(player, left, false)).toBe(false);
    const closed = s.door.quaternion.clone();
    expect(s.story.interact(player, left, true)).toBe(true);
    expect(s.story.getState()).toBe('home'); expect(s.caption.say).toHaveBeenLastCalledWith(HOME_REMINDER);
    expect(s.voice).toHaveBeenLastCalledWith('gasp'); expect(s.change).toHaveBeenCalledTimes(2);
    for (let i=0; i<40; i++) s.story.update(.02, player, left, true);
    expect(s.door.quaternion.angleTo(closed)).toBeCloseTo(1.15);
    expect(s.story.interact(player, left, true)).toBe(false); expect(s.voice).toHaveBeenCalledTimes(2);
    s.story.dispose(); expect(s.caption.dispose).toHaveBeenCalledOnce();
    expect(s.mailbox.getObjectByName('mail-recipient-highlight')).toBeUndefined();
  });

  it('respects pause, other floors, distance, an obstructing cabinet, and old/completed saves', () => {
    const s=setup('mail');
    const occluder = new THREE.Mesh(new THREE.BoxGeometry(.15, 1, 1), new THREE.MeshBasicMaterial());
    occluder.position.x = .7; s.mailbox.add(occluder);
    // Place the occluder between the camera and door in world space.
    occluder.position.set(0, 0, .7);
    expect(s.story.interact(player, left, true)).toBe(false);
    occluder.removeFromParent(); occluder.geometry.dispose(); (occluder.material as THREE.Material).dispose();
    expect(s.story.interact(new THREE.Vector3(-.2, 3.7, -4.6), left, true)).toBe(false);
    expect(s.story.interact(new THREE.Vector3(1.6, .865, -4.6), left, true)).toBe(false);
    s.story.update(.03, player, left, false); expect(s.ui.setInteraction).not.toHaveBeenCalledWith('Récupérer le courrier');
    s.story.update(.03, player, left, true); expect(s.voice).not.toHaveBeenCalled();
    expect(s.caption.say).toHaveBeenCalledOnce();
    s.story.dispose();
    for(const state of ['done','home'] as const) {
      const restored = setup(state); restored.story.update(.03, player, left, true);
      expect(restored.voice).not.toHaveBeenCalled(); expect(restored.story.interact(player,left,true)).toBe(false);
      expect(restored.mailbox.getObjectByName('mail-recipient-highlight')!.visible).toBe(false);
      restored.story.dispose();
    }
  });
});
