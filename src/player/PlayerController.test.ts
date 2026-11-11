import { beforeEach, describe, expect, it, vi } from 'vitest';

const inputState = vi.hoisted(() => ({
  axes: { forward: 0, right: 0, vertical: 0, sprint: false, crouch: false },
  presses: new Set<string>(),
  releases: new Set<string>(),
  down: new Set<string>(),
  bindings: {
    forward: 'KeyZ',
    backward: 'KeyS',
    left: 'KeyQ',
    right: 'KeyD',
    sprint: 'ShiftLeft',
    jump: 'Space',
    crouch: 'ControlLeft',
    interact: 'KeyE',
  } as Record<string, string>,
}));

vi.mock('three/addons/controls/PointerLockControls.js', async () => {
  const THREE = await import('three');

  class PointerLockControls extends THREE.EventDispatcher {
    readonly object: THREE.Camera;
    isLocked = true;
    pointerSpeed = 1;
    minPolarAngle = 0;
    maxPolarAngle = Math.PI;
    enabled = true;

    constructor(camera: THREE.Camera) {
      super();
      this.object = camera;
    }

    getDirection(target: THREE.Vector3): THREE.Vector3 {
      return target.set(0, 0, -1).applyQuaternion(this.object.quaternion);
    }

    lock(): void {}
    unlock(): void { this.isLocked=false; this.dispatchEvent({type:'unlock'} as never); }
    disconnect(): void {}
  }

  return { PointerLockControls };
});

vi.mock('../input/InputManager', () => ({
  InputManager: class {
    get axes() { return inputState.axes; }
    consumePress(code: string): boolean {
      const pressed = inputState.presses.has(code);
      inputState.presses.delete(code);
      return pressed;
    }
    consumeRelease(code: string): boolean {
      const released = inputState.releases.has(code);
      inputState.releases.delete(code);
      return released;
    }
    isPressed(code: string): boolean {
      return inputState.down.has(code);
    }
    setBindings(bindings: Record<string, string>): void {
      inputState.bindings = { ...bindings };
    }
    consumeActionPress(action: string): boolean {
      return this.consumeAny(inputState.presses, action);
    }
    consumeActionRelease(action: string): boolean {
      return this.consumeAny(inputState.releases, action);
    }
    isActionPressed(action: string): boolean {
      return this.actionCodes(action).some((code) => inputState.down.has(code));
    }
    private consumeAny(source: Set<string>, action: string): boolean {
      const code = this.actionCodes(action).find((candidate) => source.has(candidate));
      if (!code) return false;
      source.delete(code);
      return true;
    }
    private actionCodes(action: string): string[] {
      const code = inputState.bindings[action]!;
      if (code === 'ShiftLeft' || code === 'ShiftRight') return ['ShiftLeft', 'ShiftRight'];
      if (code === 'ControlLeft' || code === 'ControlRight') return ['ControlLeft', 'ControlRight'];
      if (code === 'AltLeft' || code === 'AltRight') return ['AltLeft', 'AltRight'];
      return [code];
    }
    setEnabled(): void {}
    dispose(): void {}
  },
}));

import * as THREE from 'three';
import type { CharacterMotionResult, PhysicsWorld } from '../physics/PhysicsWorld';
import type { Vec3Data } from '../world/types';
import { PlayerController } from './PlayerController';
import { MOVEMENT_TUNING } from './MovementConfig';

class FakePhysics {
  readonly position = new THREE.Vector3();
  readonly queuedMoves: CharacterMotionResult[] = [];
  readonly teleports: Vec3Data[] = [];
  readonly moveDeltas: Vec3Data[] = [];
  readonly crouchRequests: boolean[] = [];
  crouched = false;
  get crouchCenterOffset() { return this.crouched ? 0.3 : 0; }
  readonly crouchedCenterDrop = 0.3;
  blockStanding = false;

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
    this.moveDeltas.push({ ...delta });
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

  setCrouched(requested: boolean): boolean {
    this.crouchRequests.push(requested);
    if (!requested && this.blockStanding) return true;
    this.crouched = requested;
    return this.crouched;
  }
}

const createController = (physics: FakePhysics) => {
  const pointerDocument = new EventTarget() as unknown as Document;
  const element = Object.assign(new EventTarget(), { ownerDocument: pointerDocument, style: { cursor: '' }, tabIndex: -1, focus: vi.fn() }) as unknown as HTMLElement;
  const callbacks = {
    onPointerCaptureChange: vi.fn(),
    onLockChange: vi.fn(),
    onFootstep: vi.fn(),
    onInteract: vi.fn(),
    onLand: vi.fn(),
    onSafePosition: vi.fn(),
    onFallReset: vi.fn(),
  };
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  const controller = new PlayerController(
    camera,
    element,
    physics as unknown as PhysicsWorld,
    callbacks,
  );
  return { callbacks, camera, controller, element, pointerDocument };
};

beforeEach(() => {
  vi.clearAllMocks();
  inputState.axes.forward = 0;
  inputState.axes.right = 0;
  inputState.axes.vertical = 0;
  inputState.axes.sprint = false;
  inputState.axes.crouch = false;
  inputState.presses.clear();
  inputState.releases.clear();
  inputState.down.clear();
  Object.assign(inputState.bindings, {
    forward: 'KeyZ',
    backward: 'KeyS',
    left: 'KeyQ',
    right: 'KeyD',
    sprint: 'ShiftLeft',
    jump: 'Space',
    crouch: 'ControlLeft',
    interact: 'KeyE',
  });
});

describe('PlayerController interaction timing', () => {
  it('can restrict stairs to walking while leaving the shared controller unrestricted elsewhere', () => {
    const physics = new FakePhysics({ x: 0, y: .865, z: 0 }), { controller } = createController(physics);
    controller.setMovementCapabilities({ sprint: false, jump: false });
    inputState.axes.sprint = true; inputState.axes.forward = 1; inputState.presses.add('Space');
    physics.queueMove({ x: 0, y: .865, z: 0 }, true); controller.fixedUpdate(1 / 60);
    expect(controller.isSprintRequested()).toBe(false); expect(controller.getMovementIntent().sprint).toBe(false);
    expect(controller.getDebugState().velocity.y).toBeLessThanOrEqual(0);
    expect(inputState.presses.has('Space')).toBe(false);
    controller.setMovementCapabilities({ sprint: true, jump: true });
    expect(controller.isSprintRequested()).toBe(true);
    controller.dispose();
  });

  it('does not lean the camera when A or the interaction key E is held', () => {
    const physics = new FakePhysics({ x: 0, y: .865, z: 0 }), { controller } = createController(physics);
    inputState.down.add('KeyA'); controller.fixedUpdate(.02); controller.renderUpdate(.02, 1);
    expect(controller.getDebugState().manualLean).toBe(0);
    inputState.down.delete('KeyA'); inputState.down.add('KeyE'); controller.fixedUpdate(.02); controller.renderUpdate(.02, 1);
    expect(controller.getDebugState().manualLean).toBe(0); controller.dispose();
  });
  it('uses the remapped interaction key immediately', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { callbacks, controller } = createController(physics);
    controller.setControlBindings({
      forward: 'KeyW',
      backward: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      sprint: 'ShiftLeft',
      jump: 'Space',
      crouch: 'ControlLeft',
      interact: 'KeyF',
    });

    inputState.presses.add('KeyF');
    inputState.down.add('KeyF');
    controller.fixedUpdate(0.1);
    inputState.down.delete('KeyF');
    inputState.releases.add('KeyF');
    controller.fixedUpdate(1 / 60);

    expect(callbacks.onInteract).toHaveBeenCalledWith('fast');
    controller.dispose();
  });

  it('uses a quick open for a short E press', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { callbacks, controller } = createController(physics);

    inputState.presses.add('KeyE');
    inputState.down.add('KeyE');
    controller.fixedUpdate(0.2);
    expect(callbacks.onInteract).not.toHaveBeenCalled();

    inputState.down.delete('KeyE');
    inputState.releases.add('KeyE');
    controller.fixedUpdate(1 / 60);

    expect(callbacks.onInteract).toHaveBeenCalledOnce();
    expect(callbacks.onInteract).toHaveBeenCalledWith('fast');
    controller.dispose();
  });

  it('uses a slow open after E is held for one second', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { callbacks, controller } = createController(physics);

    inputState.presses.add('KeyE');
    inputState.down.add('KeyE');
    controller.fixedUpdate(0.5);
    controller.fixedUpdate(0.5);
    controller.fixedUpdate(0.5);

    expect(callbacks.onInteract).toHaveBeenCalledOnce();
    expect(callbacks.onInteract).toHaveBeenCalledWith('slow');

    inputState.down.delete('KeyE');
    inputState.releases.add('KeyE');
    controller.fixedUpdate(1 / 60);
    expect(callbacks.onInteract).toHaveBeenCalledOnce();
    controller.dispose();
  });
});

describe('embedded mouse controls', () => {
  function mouse(document: Document, target: HTMLElement, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
    const event = new Event(type);
    for (const [key, value] of Object.entries({ target, clientX: x, clientY: y, movementX: 0, movementY: 0, buttons: 0, ...extra })) {
      Object.defineProperty(event, key, { value });
    }
    document.dispatchEvent(event);
  }

  it('keeps camera and aim fixed while capture is absent or denied, including nonzero movement deltas', async () => {
    const { controller, element, pointerDocument, callbacks } = createController(new FakePhysics({ x: 0, y: .865, z: 0 }));
    controller.controls.isLocked = false;
    element.requestPointerLock = vi.fn(() => Promise.reject(new Error('sandbox')));
    controller.lock();
    await Promise.resolve();
    mouse(pointerDocument, element, 'mousemove', 200, 100);
    mouse(pointerDocument, element, 'mousemove', 250, 125,{movementX:50,movementY:25});
    const euler = new THREE.Euler().setFromQuaternion(controller.getLookQuaternion(), 'YXZ');
    expect(euler.y).toBe(0);
    expect(euler.x).toBeCloseTo(0);
    expect(controller.getContinuousAimYawRadians()).toBe(0);
    expect(controller.isLocked).toBe(true);
    expect(element.style.cursor).toBe('crosshair');
    expect(callbacks.onLockChange).toHaveBeenLastCalledWith(true);
    expect(callbacks.onPointerCaptureChange).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });

  it('retries capture on a real canvas click after asynchronous startup', async () => {
    const { controller, element, pointerDocument } = createController(new FakePhysics({ x: 0, y: .865, z: 0 }));
    controller.controls.isLocked = false;
    const request = vi.fn(() => Promise.reject(new Error('no activation')));
    element.requestPointerLock = request;
    controller.lock();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    mouse(pointerDocument, element, 'mousedown', 40, 60);
    expect(request).not.toHaveBeenCalled();
    mouse(pointerDocument, element, 'mousedown', 40, 60, { isTrusted: true });
    expect(request).toHaveBeenCalledOnce();
    expect(element.focus).toHaveBeenCalled();
    controller.dispose();
  });

  it('keeps playing without mouse look when the window loses focus, and pauses only on Escape-like capture loss', () => {
    vi.useFakeTimers();
    try {
      const { controller, callbacks, pointerDocument } = createController(new FakePhysics({ x: 0, y: .865, z: 0 }));
      controller.lock();
      controller.controls.isLocked = true; controller.controls.dispatchEvent({ type: 'lock' });
      // Another application took focus: the browser drops capture.
      Object.assign(pointerDocument, { hasFocus: () => false });
      controller.controls.isLocked = false; controller.controls.dispatchEvent({ type: 'unlock' });
      vi.advanceTimersByTime(500);
      expect(callbacks.onLockChange).toHaveBeenLastCalledWith(true);
      expect(callbacks.onPointerCaptureChange).toHaveBeenLastCalledWith(false);
      expect(controller.isLocked).toBe(true); expect(controller.isPointerCaptured).toBe(false);
      // Back in the window, recaptured, then Escape releases capture: pause.
      Object.assign(pointerDocument, { hasFocus: () => true });
      controller.controls.isLocked = true; controller.controls.dispatchEvent({ type: 'lock' });
      vi.advanceTimersByTime(1000);
      controller.controls.isLocked = false; controller.controls.dispatchEvent({ type: 'unlock' });
      expect(callbacks.onLockChange).toHaveBeenLastCalledWith(true);
      vi.advanceTimersByTime(200);
      expect(callbacks.onLockChange).toHaveBeenLastCalledWith(false);
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('drops a lock the browser kept after a focus loss and ignores mouse motion meanwhile', () => {
    const { controller, element, pointerDocument } = createController(new FakePhysics({ x: 0, y: .865, z: 0 }));
    controller.lock();
    const exitPointerLock = vi.fn();
    Object.assign(pointerDocument, { exitPointerLock, hasFocus: () => true });
    Object.defineProperty(pointerDocument, 'pointerLockElement', { configurable: true, value: element });
    controller.controls.isLocked = true; controller.controls.dispatchEvent({ type: 'lock' });
    mouse(pointerDocument, element, 'mousemove', 10, 10, { movementX: 1 });
    const before = controller.getContinuousAimYawRadians();
    // Another screen has focus but the lock is still reported as held.
    Object.assign(pointerDocument, { hasFocus: () => false });
    mouse(pointerDocument, element, 'mousemove', 30, 10, { movementX: 40 });
    expect(controller.getContinuousAimYawRadians()).toBe(before);
    Object.defineProperty(pointerDocument, 'hidden', { configurable: true, value: true });
    pointerDocument.dispatchEvent(new Event('visibilitychange'));
    expect(exitPointerLock).toHaveBeenCalled();
    expect(controller.isLocked).toBe(true);
    controller.dispose();
  });

  it('removes the recapture request after the browser captures the mouse', () => {
    vi.useFakeTimers();
    const { controller, callbacks } = createController(new FakePhysics({ x: 0, y: .865, z: 0 }));
    controller.controls.isLocked = false;
    controller.lock();
    expect(callbacks.onPointerCaptureChange).toHaveBeenLastCalledWith(false);
    controller.controls.isLocked = true;
    controller.controls.dispatchEvent({ type: 'lock' });
    expect(callbacks.onPointerCaptureChange).toHaveBeenLastCalledWith(true);
    expect(callbacks.onLockChange).toHaveBeenLastCalledWith(true);
    controller.controls.isLocked = false;
    controller.controls.dispatchEvent({ type: 'unlock' });
    vi.advanceTimersByTime(200); vi.useRealTimers();
    expect(callbacks.onLockChange).toHaveBeenLastCalledWith(false);
    expect(callbacks.onPointerCaptureChange).toHaveBeenLastCalledWith(false);
    controller.unlock();
    expect(callbacks.onLockChange).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });

  it('waits for actual capture, discards the recapture warp and does not aim after pause', () => {
    const { controller, element, pointerDocument } = createController(new FakePhysics({ x: 0, y: .865, z: 0 }));
    controller.controls.isLocked = false;
    controller.lock();
    mouse(pointerDocument, element, 'mousemove', 100, 100);
    mouse(pointerDocument, {} as HTMLElement, 'mousemove', 900, 600);
    mouse(pointerDocument, element, 'mousemove', 900, 600);
    expect(controller.getContinuousAimYawRadians()).toBe(0);
    mouse(pointerDocument, element, 'mousemove', 920, 600);
    expect(controller.getContinuousAimYawRadians()).toBe(0);
    controller.controls.isLocked=true;
    // A stale controls flag alone is insufficient.
    mouse(pointerDocument,element,'mousemove',950,600,{movementX:30});
    expect(controller.getContinuousAimYawRadians()).toBe(0);
    Object.defineProperty(pointerDocument,'pointerLockElement',{configurable:true,value:element});
    controller.controls.dispatchEvent({type:'lock'});
    mouse(pointerDocument,element,'mousemove',1500,900,{movementX:550,movementY:300});
    expect(controller.getContinuousAimYawRadians()).toBe(0);
    mouse(pointerDocument,element,'mousemove',1520,900,{movementX:20});
    expect(controller.getContinuousAimYawRadians()).toBeCloseTo(-.04);
    controller.unlock();
    mouse(pointerDocument, element, 'mousemove', 1100, 600);
    expect(controller.getContinuousAimYawRadians()).toBeCloseTo(-0.04);
    expect(element.style.cursor).toBe('');
    expect(controller.isLocked).toBe(false);
    controller.dispose();
    expect(element.tabIndex).toBe(-1);
  });
});

describe('PlayerController locomotion', () => {
  it('applies persisted camera comfort settings', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { camera, controller } = createController(physics);

    controller.setFieldOfView(88);
    controller.setLookSensitivity(1.45);
    controller.setCameraMotionEnabled(false);
    controller.renderUpdate(1 / 60, 1);

    expect(camera.fov).toBeCloseTo(88);
    expect(controller.controls.pointerSpeed).toBeCloseTo(1.45);
    expect(camera.rotation.z).toBeCloseTo(0);
    controller.dispose();
  });

  it('jumps from the ground when Space is pressed', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { controller } = createController(physics);

    inputState.presses.add('Space');
    controller.fixedUpdate(1 / 60);

    expect(physics.moveDeltas.at(-1)!.y).toBeGreaterThan(0.08);
    expect(controller.position.y).toBeGreaterThan(0.865);
    controller.dispose();
  });

  it('reports the physical impact speed for a small landing', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { callbacks, controller } = createController(physics);

    controller.fixedUpdate(0.1);
    physics.queueMove({ x: 0, y: 0.6, z: 0 }, true);
    controller.fixedUpdate(0.02);

    expect(callbacks.onLand).toHaveBeenCalledOnce();
    expect(callbacks.onLand.mock.calls[0]![0]).toBeCloseTo(0.5 + MOVEMENT_TUNING.locomotion.gravity * 0.12, 2);
    controller.dispose();
  });

  it('does not buffer an airborne jump until the next landing', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { controller } = createController(physics);

    controller.fixedUpdate(1 / 60);
    inputState.presses.add('Space');
    physics.queueMove({ x: 0, y: 0.8, z: 0 }, true);
    controller.fixedUpdate(1 / 60);
    controller.fixedUpdate(1 / 60);

    expect(physics.moveDeltas.at(-1)!.y).toBeLessThan(0);
    controller.dispose();
  });

  it('toggles crouch and waits for head clearance before standing', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { controller } = createController(physics);

    inputState.presses.add('ControlLeft');
    controller.fixedUpdate(1 / 60);
    expect(physics.crouched).toBe(true);

    physics.blockStanding = true;
    inputState.presses.add('ControlLeft');
    controller.fixedUpdate(1 / 60);
    expect(physics.crouched).toBe(true);

    physics.blockStanding = false;
    controller.fixedUpdate(1 / 60);
    expect(physics.crouched).toBe(false);
    expect(physics.crouchRequests).toContain(true);
    expect(physics.crouchRequests.at(-1)).toBe(false);
    controller.dispose();
  });
});

describe('PlayerController running contact', () => {
  /** Flat ground; an optional wall at z = wallZ stops all forward progress. */
  class GroundPhysics extends FakePhysics {
    wallZ = Number.NEGATIVE_INFINITY;
    override move(delta: Vec3Data): CharacterMotionResult {
      this.moveDeltas.push({ ...delta });
      const z = Math.max(this.wallZ, this.position.z + delta.z);
      const moved = new THREE.Vector3(delta.x, 0, z - this.position.z);
      this.position.add(moved);
      return { position: this.position, grounded: true, moved };
    }
  }
  const run = (controller: PlayerController, ticks: number) => { for (let tick = 0; tick < ticks; tick += 1) controller.fixedUpdate(1 / 60); };

  it('slides when crouch is pressed during a sprint', () => {
    const physics = new GroundPhysics({ x: 0, y: 0.865, z: 0 });
    const { controller } = createController(physics);
    inputState.axes.forward = 1; inputState.axes.sprint = true; inputState.down.add('ShiftLeft');
    run(controller, 60);
    inputState.presses.add('ControlLeft');
    run(controller, 1);
    expect(controller.getDebugState().sliding).toBe(true);
    controller.dispose();
  });

  it('stands against a wall instead of running in place, without restarting the sprint loop', () => {
    const physics = new GroundPhysics({ x: 0, y: 0.865, z: 0 });
    const states: string[] = [];
    const { controller } = createController(physics);
    (controller as unknown as { callbacks: { onMovementAudioState(state: string): void } }).callbacks.onMovementAudioState = state => states.push(state);
    inputState.axes.forward = 1; inputState.axes.sprint = true; inputState.down.add('ShiftLeft');
    run(controller, 50);
    physics.wallZ = physics.position.z - 0.02;
    states.length = 0;
    run(controller, 120);
    expect(controller.getMovementIntent().forward).toBe(0);
    expect(controller.getInputIntent().forward).toBe(1);
    expect(controller.getDebugState().horizontalSpeed).toBe(0);
    expect(controller.getDebugState().sprinting).toBe(false);
    const changes = states.filter((state, index) => index > 0 && state !== states[index - 1]).length;
    expect(changes).toBeLessThanOrEqual(1);
    expect(states.at(-1)).toBe('idle');
    physics.wallZ = Number.NEGATIVE_INFINITY;
    run(controller, 30);
    expect(controller.getMovementIntent().forward).toBe(1);
    controller.dispose();
  });
});

describe('PlayerController look state', () => {
  it('keeps interaction look inside a stable cone across the yaw seam and releases it without a queued turn', () => {
    const { controller, pointerDocument } = createController(new FakePhysics({ x: 0, y: .865, z: 0 }));
    vi.spyOn(controller, 'isPointerCaptured', 'get').mockReturnValue(true);
    controller.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, Math.PI - .05, 0, 'YXZ')));
    const start = controller.getContinuousAimYawRadians();
    const move = (x: number, y: number) => {
      const event = new Event('mousemove'); Object.defineProperties(event, { movementX: { value: x }, movementY: { value: y } });
      pointerDocument.dispatchEvent(event);
    };
    for (let i = 0; i < 50; i++) { controller.setLookCone(.9, .6); move(-140, 140); }
    expect(controller.getContinuousAimYawRadians() - start).toBeCloseTo(.9);
    expect(new THREE.Euler().setFromQuaternion(controller.getLookQuaternion(), 'YXZ').x).toBeCloseTo(-.4);
    controller.setLookCone(undefined);const released=controller.getContinuousAimYawRadians();
    controller.renderUpdate(1/60,1);expect(controller.getContinuousAimYawRadians()).toBeCloseTo(released);
    move(-140,0);expect(controller.getContinuousAimYawRadians()-released).toBeGreaterThan(.25);
    controller.dispose();
  });

  it('briefly limits strike look across the yaw seam and discards rejected mouse motion', () => {
    const physics = new FakePhysics({ x: 0, y: .865, z: 0 });
    const { controller, pointerDocument } = createController(physics);
    vi.spyOn(controller, 'isPointerCaptured', 'get').mockReturnValue(true);
    controller.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, Math.PI - .05, 0, 'YXZ')));
    const start = controller.getContinuousAimYawRadians();
    const move = (x: number, y = 0) => {
      const event = new Event('mousemove'); Object.defineProperties(event, { movementX: { value: x }, movementY: { value: y } });
      pointerDocument.dispatchEvent(event);
    };
    controller.limitStrikeLook(.22);
    for (let i = 0; i < 20; i++) move(-1000, 1000);
    const limited = controller.getContinuousAimYawRadians();
    expect(limited - start).toBeGreaterThan(.1); expect(limited - start).toBeLessThan(.25);
    const pitch = new THREE.Euler().setFromQuaternion(controller.getLookQuaternion(), 'YXZ').x;
    expect(pitch).toBeGreaterThan(.02); expect(pitch).toBeLessThan(.2);
    for (let i = 0; i < 30; i++) controller.renderUpdate(1 / 60, 1);
    expect(controller.getContinuousAimYawRadians()).toBeCloseTo(limited);
    move(-1000);
    expect(controller.getContinuousAimYawRadians() - limited).toBeGreaterThan(.25);
    controller.limitStrikeLook(.22); controller.limitStrikeLook(0);
    const cleared = controller.getContinuousAimYawRadians(); move(-1000);
    expect(controller.getContinuousAimYawRadians() - cleared).toBeGreaterThan(.25);
    controller.dispose();
  });

  it('round-trips the internal normalized look quaternion independently from camera roll', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { camera, controller } = createController(physics);
    const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.34, -1.17, 0, 'YXZ'));

    expect(controller.setLookQuaternion({
      x: expected.x * 4,
      y: expected.y * 4,
      z: expected.z * 4,
      w: expected.w * 4,
    })).toBe(true);

    const target = new THREE.Quaternion();
    expect(controller.getLookQuaternion(target)).toBe(target);
    expect(target.length()).toBeCloseTo(1);
    expect(target.angleTo(expected)).toBeCloseTo(0);
    expect(camera.quaternion.angleTo(expected)).toBeCloseTo(0);

    camera.rotateZ(0.2);
    expect(controller.getLookQuaternion().angleTo(expected)).toBeCloseTo(0);
    controller.dispose();
  });

  it('rejects non-finite and degenerate look quaternions without changing the view', () => {
    const physics = new FakePhysics({ x: 0, y: 0.865, z: 0 });
    const { controller } = createController(physics);
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.72);
    expect(controller.setLookQuaternion(expected)).toBe(true);

    for (const invalid of [
      { x: Number.NaN, y: 0, z: 0, w: 1 },
      { x: 0, y: Number.POSITIVE_INFINITY, z: 0, w: 1 },
      { x: 0, y: 0, z: 0, w: 0 },
      { x: 1e-12, y: 0, z: 0, w: 0 },
    ]) {
      expect(controller.setLookQuaternion(invalid)).toBe(false);
      expect(controller.getLookQuaternion().angleTo(expected)).toBeCloseTo(0);
    }
    controller.dispose();
  });
});

describe('PlayerController infinite vertical recovery', () => {
  it('does not treat a valid deep story as an absolute world bottom', () => {
    const physics = new FakePhysics({ x: 3, y: -100, z: -4 });
    const { callbacks, controller } = createController(physics);

    controller.fixedUpdate(1);
    controller.fixedUpdate(1);

    expect(controller.position.y).toBeCloseTo(-100 - (0.5 + MOVEMENT_TUNING.locomotion.gravity) - MOVEMENT_TUNING.locomotion.terminalFallSpeed);
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
    expect(callbacks.onSafePosition).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 8, y: -20, z: 5 }),
    );
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
    expect(callbacks.onSafePosition).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: -6, y: -250, z: 11 }),
    );
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

describe('PlayerController diagnostics', () => {
  it('exposes reproducible movement and view state without mutable Three.js objects', () => {
    const physics = new FakePhysics({ x: 12.5, y: 6.265, z: -18.75 });
    const { controller } = createController(physics);

    const state = controller.getDebugState();

    expect(state.position).toEqual({ x: 12.5, y: 6.265, z: -18.75 });
    expect(state).toMatchObject({
      x: 12.5,
      y: 6.265,
      z: -18.75,
      grounded: true,
      noclip: false,
      traversing: false,
      pointerLocked: true,
      view: { yaw: 0, pitch: 0, cardinal: 'N' },
    });
    expect(state.view.direction).toEqual({ x: 0, y: 0, z: -1 });
    expect(state.position).not.toBe(controller.position);
    controller.dispose();
  });
});
