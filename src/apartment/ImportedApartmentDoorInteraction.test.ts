import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { StaticCollider } from '../world/types';
import { ImportedApartmentDoorInteraction } from './ImportedApartmentDoorInteraction';

class FakePhysics {
  readonly chunks = new Set<string>();
  readonly transforms: Array<{ key: string; translation: THREE.Vector3; rotation: THREE.Quaternion }> = [];

  hasChunk(key: string): boolean {
    return this.chunks.has(key);
  }

  addKinematicChunk(key: string): void {
    this.chunks.add(key);
  }

  setKinematicChunkTransform(
    key: string,
    translation: THREE.Vector3,
    rotation: THREE.Quaternion,
  ): boolean {
    this.transforms.push({
      key,
      translation: new THREE.Vector3(translation.x, translation.y, translation.z),
      rotation: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    });
    return this.chunks.has(key);
  }

  removeChunk(key: string): void {
    this.chunks.delete(key);
  }
}

const makeInteraction = (hinged = false) => {
  const pivot = new THREE.Group();
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1));
  if (hinged) leaf.position.x = 0.5;
  pivot.add(leaf);
  pivot.updateMatrixWorld(true);
  const physics = new FakePhysics();
  const ui = { setInteraction: vi.fn() };
  const lockTarget = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
  lockTarget.position.set(-2, 0, 0);
  const onLockChange = vi.fn();
  const onPush = vi.fn();
  const centerX = hinged ? 0.5 : 0;
  const collider: StaticCollider = {
    id: 'entrance-leaf',
    center: { x: centerX, y: 0, z: 0 },
    halfExtents: { x: 0.5, y: 1, z: 0.05 },
    kind: 'barrier',
  };
  const interaction = new ImportedApartmentDoorInteraction(
    pivot,
    leaf,
    new THREE.Box3(
      new THREE.Vector3(centerX - 0.5, -1, -0.05),
      new THREE.Vector3(centerX + 0.5, 1, 0.05),
    ),
    collider,
    physics as unknown as PhysicsWorld,
    ui,
    {
      chunkKey: 'entrance-door',
      openAngle: -Math.PI / 2,
      lockTarget,
      onLockChange,
      onPush,
    },
  );
  return { interaction, physics, pivot, ui, leaf, lockTarget, onLockChange, onPush };
};

describe('ImportedApartmentDoorInteraction save state', () => {
  it('opens with a smooth acceleration and settles cleanly at the target', () => {
    const { interaction, pivot } = makeInteraction();
    interaction.restoreState({ progress: 0, targetProgress: 1 });

    interaction.update(1 / 60, new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, -1), false);
    const firstStep = Math.abs(pivot.rotation.y);
    interaction.update(1 / 60, new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, -1), false);
    const secondStep = Math.abs(pivot.rotation.y) - firstStep;

    expect(firstStep).toBeGreaterThan(0);
    expect(secondStep).toBeGreaterThan(firstStep);

    for (let frame = 0; frame < 90; frame += 1) {
      interaction.update(1 / 60, new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, -1), false);
    }
    expect(pivot.rotation.y).toBeCloseTo(-Math.PI / 2, 5);
    expect(interaction.getState()).toEqual({ progress: 1, targetProgress: 1, locked: false });
    interaction.dispose();
  });

  it('restores angle, animation target and collider ownership', () => {
    const { interaction, physics, pivot } = makeInteraction();
    expect(physics.chunks.has('entrance-door')).toBe(true);

    expect(interaction.restoreState({ progress: 0.4, targetProgress: 0 })).toBe(true);
    expect(interaction.getState()).toEqual({ progress: 0.4, targetProgress: 0, locked: false });
    expect(pivot.rotation.y).toBeCloseTo(-Math.PI * 0.2);
    expect(physics.chunks.has('entrance-door')).toBe(true);

    interaction.update(
      10,
      new THREE.Vector3(4, 0, 4),
      new THREE.Vector3(0, 0, -1),
      false,
    );
    expect(interaction.getState()).toEqual({ progress: 0, targetProgress: 0, locked: false });
    expect(physics.chunks.has('entrance-door')).toBe(true);

    expect(interaction.restoreState({ progress: 0, targetProgress: 1 })).toBe(true);
    expect(physics.chunks.has('entrance-door')).toBe(true);
    interaction.dispose();
  });

  it('can reverse an opening or closing movement immediately while aimed at the leaf', () => {
    const { interaction } = makeInteraction();
    const player = new THREE.Vector3(0, -0.73, 2);
    const direction = new THREE.Vector3(0, 0, -1);

    expect(interaction.interact(player, direction, true)).toBe(true);
    interaction.update(1 / 60, player, direction, true);
    expect(interaction.getState().targetProgress).toBe(1);
    expect(interaction.interact(player, direction, true)).toBe(true);
    expect(interaction.getState().targetProgress).toBe(0);
    expect(interaction.interact(player, direction, true)).toBe(true);
    expect(interaction.getState().targetProgress).toBe(1);
    interaction.dispose();
  });

  it('keeps a moving collider and pushes a player caught in the leaf sweep', () => {
    const { interaction, physics, onPush } = makeInteraction(true);
    const opener = new THREE.Vector3(0.5, -0.73, 2);
    expect(interaction.interact(opener, new THREE.Vector3(0, 0, -1), true)).toBe(true);

    interaction.update(
      1 / 30,
      new THREE.Vector3(0.5, -0.73, 0.16),
      new THREE.Vector3(0, 0, -1),
      true,
    );

    expect(physics.chunks.has('entrance-door')).toBe(true);
    expect(physics.transforms.length).toBeGreaterThan(1);
    expect(onPush).toHaveBeenCalled();
    interaction.dispose();
  });

  it('rejects invalid snapshots without partially changing state', () => {
    const { interaction, physics, pivot } = makeInteraction();
    const initialAngle = pivot.rotation.y;

    for (const snapshot of [
      null,
      { progress: Number.NaN, targetProgress: 0 },
      { progress: -0.01, targetProgress: 0 },
      { progress: 1.01, targetProgress: 1 },
      { progress: 0.5, targetProgress: 0.5 },
      { progress: 0.5, targetProgress: 1, extra: true },
    ]) {
      expect(interaction.restoreState(snapshot as never)).toBe(false);
      expect(interaction.getState()).toEqual({ progress: 0, targetProgress: 0, locked: false });
      expect(pivot.rotation.y).toBe(initialAngle);
      expect(physics.chunks.has('entrance-door')).toBe(true);
    }
    interaction.dispose();
  });

  it('publishes concise French prompts without duplicating the interaction key', () => {
    const { interaction, ui } = makeInteraction();
    const player = new THREE.Vector3(0, -0.73, 2);
    const direction = new THREE.Vector3(0, 0, -1);

    interaction.update(0, player, direction, true);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Ouvrir la porte');

    interaction.restoreState({ progress: 1, targetProgress: 1 });
    interaction.update(0, player, direction, true);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Fermer la porte');
    expect(ui.setInteraction.mock.calls.flat().join(' ')).not.toMatch(/\bE\b/);
    interaction.dispose();
  });

  it('offers lock controls only from the apartment side and persists their state', () => {
    const { interaction, ui, lockTarget, onLockChange } = makeInteraction();
    lockTarget.position.set(0, 0, 1);
    const player = new THREE.Vector3(-0.5, -0.73, 2);
    const towardLock = new THREE.Vector3(0.5, 0, -1).normalize();

    interaction.update(0, player, towardLock, true);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Verrouiller');
    expect(interaction.interact(player, towardLock, true)).toBe(true);
    expect(interaction.getState()).toEqual({ progress: 0, targetProgress: 0, locked: true });
    expect(onLockChange).toHaveBeenLastCalledWith(true);

    interaction.update(0, player, towardLock, true);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Déverrouiller');
    expect(interaction.interact(
      new THREE.Vector3(0.5, -0.73, 2),
      new THREE.Vector3(-0.5, 0, -1).normalize(),
      true,
    )).toBe(true);
    expect(interaction.isLocked()).toBe(true);
    interaction.dispose();
  });

  it('hits the engaged lock briefly, returns closed and keeps the collider active', () => {
    const { interaction, physics, pivot } = makeInteraction();
    expect(interaction.setLocked(true)).toBe(true);
    expect(interaction.interact(
      new THREE.Vector3(0, -0.73, 2),
      new THREE.Vector3(0, 0, -1),
      true,
    )).toBe(true);

    let furthestAngle = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      interaction.update(
        1 / 60,
        new THREE.Vector3(4, 0, 4),
        new THREE.Vector3(0, 0, -1),
        false,
      );
      furthestAngle = Math.max(furthestAngle, Math.abs(pivot.rotation.y));
      expect(physics.chunks.has('entrance-door')).toBe(true);
    }

    expect(furthestAngle).toBeGreaterThan(0.16);
    expect(furthestAngle).toBeLessThan(0.21);
    expect(pivot.rotation.y).toBeCloseTo(0, 5);
    expect(interaction.getState()).toEqual({ progress: 0, targetProgress: 0, locked: true });
    interaction.dispose();
  });
});
