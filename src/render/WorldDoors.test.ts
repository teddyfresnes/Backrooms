import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { InteractiveDoorFeature, WorldPlan } from '../world/types';
import { WorldDoorLayer } from './WorldDoors';

const feature: InteractiveDoorFeature = {
  kind: 'interactive-door',
  id: 'door-a',
  sourceRoomId: 'room-a',
  targetRoomId: 'room-b',
  position: { x: 0, y: 0, z: 0 },
  orientation: 'x',
  width: 0.96,
  height: 2.1,
  openingDirection: 1,
  style: 'office-windowed',
  content: 'empty',
  colliderId: 'door-a-collider',
  bounds: { minX: -0.48, maxX: 0.48, minZ: -0.11, maxZ: 0.11 },
};

const plan = {
  features: [feature],
} as WorldPlan;

describe('WorldDoorLayer', () => {
  it('offers the English E prompt only while a closed door is targeted', () => {
    const layer = new WorldDoorLayer(plan, null);
    const interaction = layer.getInteraction(
      new THREE.Vector3(0, 0.9, 2),
      new THREE.Vector3(0, 0, -1),
    );

    expect(interaction).toEqual({
      doorId: feature.id,
      colliderId: feature.colliderId,
      label: 'PRESS E TO OPEN  /  HOLD E TO OPEN SLOWLY',
    });
    expect(layer.getInteraction(
      new THREE.Vector3(0, 0.9, 2),
      new THREE.Vector3(0, 0, 1),
    )).toBeNull();
    layer.dispose();
  });

  it('animates a tap much faster than a held interaction', () => {
    const fast = new WorldDoorLayer(plan, null);
    const slow = new WorldDoorLayer(plan, null);

    expect(fast.open(feature.id, 'fast')).toBe(feature.colliderId);
    expect(slow.open(feature.id, 'slow')).toBe(feature.colliderId);
    fast.update(0.52);
    slow.update(0.52);

    expect(fast.getOpenProgress(feature.id)).toBe(1);
    expect(slow.getOpenProgress(feature.id)).toBeGreaterThan(0);
    expect(slow.getOpenProgress(feature.id)).toBeLessThan(0.5);
    expect(fast.consumePassableColliderIds()).toEqual([feature.colliderId]);
    expect(slow.consumePassableColliderIds()).toEqual([]);
    expect(fast.open(feature.id, 'fast')).toBeNull();

    slow.update(1.48);
    expect(slow.getOpenProgress(feature.id)).toBe(1);
    expect(slow.consumePassableColliderIds()).toEqual([feature.colliderId]);
    fast.dispose();
    slow.dispose();
  });

  it('restores an in-flight door without desynchronizing its collider release', () => {
    const source = new WorldDoorLayer(plan, null);
    source.open(feature.id, 'slow');
    source.update(0.2);
    const progress = source.getOpenProgress(feature.id)!;
    const states = source.getDoorStates();
    expect(states).toHaveLength(1);
    expect(states[0]?.colliderReleased).toBe(false);

    const restored = new WorldDoorLayer(plan, null);
    restored.restoreDoorStates(states);
    expect(restored.getOpenProgress(feature.id)).toBeCloseTo(progress, 6);
    expect(restored.consumePassableColliderIds()).toEqual([]);
    restored.update(states[0]!.remainingDuration);
    expect(restored.getOpenProgress(feature.id)).toBe(1);
    expect(restored.consumePassableColliderIds()).toEqual([feature.colliderId]);

    source.dispose();
    restored.dispose();
  });
});
