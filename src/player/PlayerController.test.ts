import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three/addons/controls/PointerLockControls.js', async () => {
  const THREE = await import('three');

  class PointerLockControls extends THREE.EventDispatcher {
    readonly object: THREE.Camera;
    isLocked = true;

    constructor(camera: THREE.Camera) {
      super();
      this.object = camera;
    }

    getDirection(target: THREE.Vector3): THREE.Vector3 {
      return target.set(0, 0, -1).applyQuaternion(this.object.quaternion);
    }

    lock(): void {}
    disconnect(): void {}
  }

  return { PointerLockControls };
});

vi.mock('../input/InputManager', () => ({
  InputManager: class {
    readonly axes = { forward: 0, right: 0, sprint: false, crouch: false };
    consumePress(): boolean { return false; }
    setEnabled(): void {}
    dispose(): void {}
  },
}));

import * as THREE from 'three';
import type { CharacterMotionResult, PhysicsWorld } from '../physics/PhysicsWorld';
import type { Vec3Data } from '../world/types';
import { PlayerController } from './PlayerController';

class FakePhysics {
  readonly position = new THREE.Vector3();
  readonly queuedMoves: CharacterMotionResult[] = [];
  readonly teleports: Vec3Data[] = [];

  constructor(position: Vec3Data) {
    this.position.set(position.x, position.y, position.z);
  }

  queueMove(position: Vec3Data, grounded: boolean): void {
    this.queuedMoves.push({
      position: new THREE.Vector3(position.x, position.y, position.z),
      grounded,
      moved: new THREE.Vector3(),
    });
  }

  getPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.position);
  }

  move(delta: Vec3Data): CharacterMotionResult {
    const queued = this.queuedMoves.shift();
    if (queued) {
      this.position.copy(queued.position);
      return {
        position: this.position,
        grounded: queued.grounded,
        moved: queued.moved,
      };
    }
    this.position.add(new THREE.Vector3(delta.x, delta.y, delta.z));
    return {
      position: this.position,
      grounded: false,
      moved: new THREE.Vector3(delta.x, delta.y, delta.z),
    };
  }

  teleport(position: Vec3Data): void {
    this.position.set(position.x, position.y, position.z);
    this.teleports.push({ ...position });
  }
}

const createController = (physics: FakePhysics) => {
  const pointerDocument = new EventTarget() as unknown as Document;
  const element = { ownerDocument: pointerDocument } as HTMLElement;
  const callbacks = {
    onLockChange: vi.fn(),
    onFootstep: vi.fn(),
    onInteract: vi.fn(),
    onLand: vi.fn(),
    onFallReset: vi.fn(),
  };
  const controller = new PlayerController(
    new THREE.PerspectiveCamera(70, 1, 0.1, 100),
    element,
    physics as unknown as PhysicsWorld,
    callbacks,
  );
  return { callbacks, controller };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlayerController infinite vertical recovery', () => {
  it('does not treat a valid deep story as an absolute world bottom', () => {
    const physics = new FakePhysics({ x: 3, y: -100, z: -4 });
    const { callbacks, controller } = createController(physics);

    controller.fixedUpdate(1);
    controller.fixedUpdate(1);

    expect(controller.position.y).toBeCloseTo(-136);
    expect(callbacks.onFallReset).not.toHaveBeenCalled();

    controller.fixedUpdate(1);

    expect(callbacks.onFallReset).toHaveBeenCalledTimes(1);
    expect(controller.position.toArray()).toEqual([3, -100, -4]);
    expect(physics.teleports.at(-1)).toEqual({ x: 3, y: -100, z: -4 });
    controller.dispose();
  });

  it('anchors recovery to the most recent grounded position', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { callbacks, controller } = createController(physics);

    physics.queueMove({ x: 8, y: -20, z: 5 }, true);
    controller.fixedUpdate(1);
    physics.queueMove({ x: 8, y: -60, z: 5 }, false);
    controller.fixedUpdate(1);

    expect(callbacks.onFallReset).not.toHaveBeenCalled();

    physics.queueMove({ x: 8, y: -69, z: 5 }, false);
    controller.fixedUpdate(1);

    expect(callbacks.onFallReset).toHaveBeenCalledTimes(1);
    expect(controller.position.toArray()).toEqual([8, -20, 5]);
    expect(physics.teleports.at(-1)).toEqual({ x: 8, y: -20, z: 5 });
    controller.dispose();
  });

  it('moves the recovery anchor when gameplay teleports to another story', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { callbacks, controller } = createController(physics);

    controller.teleport({ x: -6, y: -250, z: 11 });
    physics.queueMove({ x: -6, y: -290, z: 11 }, false);
    controller.fixedUpdate(1);
    expect(callbacks.onFallReset).not.toHaveBeenCalled();

    physics.queueMove({ x: -6, y: -299, z: 11 }, false);
    controller.fixedUpdate(1);

    expect(callbacks.onFallReset).toHaveBeenCalledTimes(1);
    expect(controller.position.toArray()).toEqual([-6, -250, 11]);
    expect(physics.teleports.at(-1)).toEqual({ x: -6, y: -250, z: 11 });
    controller.dispose();
  });
});
