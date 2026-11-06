import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => { const module = await import('@dimforge/rapier3d-compat'); await module.default.init(); return { ...module, default: module.default }; });
vi.mock('three/addons/controls/PointerLockControls.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return { PointerLockControls: class extends EventDispatcher {
    isLocked = true; pointerSpeed = 1;
    constructor(readonly object: THREE.Camera) { super(); }
    getDirection(target: THREE.Vector3) { return target.copy(new Vector3(0, 0, -1)).applyQuaternion(this.object.quaternion); }
    disconnect() {} lock() {} unlock() {}
  } };
});
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from './PlayerController';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';
import { floorY, midLandingY } from '../stairwell/layout';
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals(); });
it.each([false, true])('takes the real staircase with the full controller (sprint %s)', async sprint => {
  const physics = await PhysicsWorld.create(createStairwellPlan()); cleanup.push(() => physics.dispose());
  const view = new EventTarget(), pointerDocument = Object.assign(new EventTarget(), { defaultView: view });
  vi.stubGlobal('window', view); vi.stubGlobal('HTMLElement', class extends EventTarget {});
  const camera = new THREE.PerspectiveCamera(70, 1, .1, 100);
  const canvas = Object.assign(new EventTarget(), { ownerDocument: pointerDocument, style: { cursor: '' }, tabIndex: -1, focus: vi.fn() }) as unknown as HTMLElement;
  const callbacks = { onLockChange: vi.fn(), onFootstep: vi.fn(), onInteract: vi.fn(), onLand: vi.fn(), onSafePosition: vi.fn(), onFallReset: vi.fn() };
  const player = new PlayerController(camera, canvas, physics, callbacks); cleanup.push(() => player.dispose());
  player.setInputEnabled(true); player.teleport({ x: -1.05, y: .865, z: -2.1 });
  player.setLookQuaternion(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI));
  view.dispatchEvent(Object.assign(new Event('keydown'), { key: 'z', code: 'KeyW', repeat: false }));
  if (sprint) view.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Shift', code: 'ShiftLeft', repeat: false }));
  let airborne = 0, blocked = 0;
  for (let tick = 0; tick < 240 && player.position.z < 2.1; tick++) {
    player.fixedUpdate(1 / 60); player.renderUpdate(1 / 60, 1);
    const state = player.getDebugState(); if (state.airborne) airborne++; if (state.horizontalSpeed < .2 && tick > 12) blocked++;
  }
  expect(player.position.z).toBeGreaterThan(2.05); expect(player.position.y).toBeCloseTo(midLandingY(0) + .865, 2);
  expect(airborne).toBeLessThan(4); expect(blocked).toBeLessThan(4); expect(callbacks.onFallReset).not.toHaveBeenCalled();
});

// Hugging the central railing while climbing or descending must not snag:
// the rail barrier's sloped underside used to hang over the treads.
it.each([
  ['up the left flight', { x: -.36, y: .865, z: -2.1 }, Math.PI + .18, (z: number) => z > 2.05, (): number => midLandingY(0) + .865],
  ['down the left flight', { x: -.36, y: midLandingY(0) + .865, z: 2.1 }, -.18, (z: number) => z < -2.05, (): number => .865],
  ['up the right flight', { x: .36, y: midLandingY(0) + .865, z: 2.1 }, .18, (z: number) => z < -2.05, (): number => floorY(1) + .865],
  ['down the right flight', { x: .36, y: floorY(1) + .865, z: -2.1 }, Math.PI - .18, (z: number) => z > 2.05, (): number => midLandingY(0) + .865],
] as const)('keeps moving while pressed against the railing %s', async (_label, start, yaw, done, endY) => {
  const physics = await PhysicsWorld.create(createStairwellPlan()); cleanup.push(() => physics.dispose());
  const view = new EventTarget(), pointerDocument = Object.assign(new EventTarget(), { defaultView: view });
  vi.stubGlobal('window', view); vi.stubGlobal('HTMLElement', class extends EventTarget {});
  const camera = new THREE.PerspectiveCamera(70, 1, .1, 100);
  const canvas = Object.assign(new EventTarget(), { ownerDocument: pointerDocument, style: { cursor: '' }, tabIndex: -1, focus: vi.fn() }) as unknown as HTMLElement;
  const callbacks = { onLockChange: vi.fn(), onFootstep: vi.fn(), onInteract: vi.fn(), onLand: vi.fn(), onSafePosition: vi.fn(), onFallReset: vi.fn() };
  const player = new PlayerController(camera, canvas, physics, callbacks); cleanup.push(() => player.dispose());
  player.setInputEnabled(true); player.teleport(start);
  player.setLookQuaternion(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw));
  view.dispatchEvent(Object.assign(new Event('keydown'), { key: 'z', code: 'KeyW', repeat: false }));
  let blocked = 0, minRail = Infinity, tick = 0;
  for (; tick < 360 && !done(player.position.z); tick++) {
    player.fixedUpdate(1 / 60); player.renderUpdate(1 / 60, 1);
    if (player.getDebugState().horizontalSpeed < .2 && tick > 12) blocked++;
    minRail = Math.min(minRail, Math.abs(player.position.x));
  }
  console.log(_label, 'ticks', tick, 'blocked', blocked, 'pos', player.position.x.toFixed(3), player.position.y.toFixed(3), player.position.z.toFixed(3), 'closest', minRail.toFixed(3));
  expect(minRail).toBeLessThan(.5);
  expect(done(player.position.z)).toBe(true);
  expect(blocked).toBeLessThan(4);
  expect(player.position.y).toBeCloseTo(endY(), 1);
});
