import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BacteriaEncounter, type BacteriaEncounterHost } from './BacteriaEncounter';
import type { BacteriaActor, BacteriaMotion } from './BacteriaActor';
import type { BacteriaAudio } from './BacteriaAudio';
import {
  CALM_SECONDS,
  ChasePath,
  CLOSET,
  createEscapeWaypoints,
  DOOR_BANG_SECONDS,
  PLAYER_CENTER_HEIGHT,
  REVEAL_TIMELINE,
  SNEAK_HOLD_SECONDS,
  SPOTTED_TIMELINE,
} from './BacteriaLayout';

const threshold = { x: -2.02, y: 8.67, z: -2.71 };
const DT = 1 / 60;

function fakeActor() {
  const root = new THREE.Group();
  const state = { motion: 'idle' as BacteriaMotion, twist: 0 };
  const actor = {
    root,
    warmupRoots: [root],
    setVisible: (visible: boolean) => { root.visible = visible; },
    setPlacement: (position: THREE.Vector3Like, yaw: number) => { root.position.set(position.x, position.y, position.z); root.rotation.y = yaw; },
    setMotion: (motion: BacteriaMotion) => { state.motion = motion; },
    setLookTarget: () => undefined,
    setHeadTwist: (angle: number) => { state.twist = angle; },
    snapHead: () => undefined,
    update: () => undefined,
    setExposure: () => undefined,
    getHeadPosition: (out: THREE.Vector3) => out.copy(root.position).setY(root.position.y + 2.3),
    getFacePosition: (out: THREE.Vector3) => out.copy(root.position).setY(root.position.y + 2.2),
    getHoldPosition: (out: THREE.Vector3) => out.copy(root.position).setY(root.position.y + 1.3),
    dispose: () => undefined,
  };
  return { actor: actor as unknown as BacteriaActor, state };
}

function fakeAudio() {
  const calls: string[] = [];
  const audio = new Proxy({}, { get: (_target, key) => (...args: unknown[]) => { calls.push(`${String(key)}${args.length ? `:${args.map(String).join(',')}` : ''}`); } });
  return { audio: audio as unknown as BacteriaAudio, calls };
}

function setup(options: { tvOn?: boolean } = {}) {
  const scene = new THREE.Scene();
  const position = new THREE.Vector3(threshold.x + 20, threshold.y + PLAYER_CENTER_HEIGHT, threshold.z);
  const look = new THREE.Quaternion();
  const player = {
    position,
    isInputEnabled: true,
    lookLocked: false,
    setInputEnabled(enabled: boolean) { this.isInputEnabled = enabled; },
    setLookLocked(locked: boolean) { this.lookLocked = locked; },
    prepareScriptedStanding: () => undefined,
    getLookQuaternion: () => look,
    setLookQuaternion: (q: THREE.QuaternionLike) => { look.set(q.x, q.y, q.z, q.w); },
    teleport: (p: THREE.Vector3Like) => { position.set(p.x, p.y, p.z); },
    getViewDirection: (out: THREE.Vector3) => out.set(-1, 0, 0),
  };
  const eyeCamera = new THREE.PerspectiveCamera();
  const door = { secured: false, breached: false, isSecured() { return this.secured; }, jolt: () => undefined, breach() { this.breached = true; this.secured = false; }, repair() { this.breached = false; } };
  // The bedroom wardrobe: aimed at when the player stands in front of it.
  const wardrobe = { aimed: true, inside: false, exits: 0 };
  scene.updateMatrixWorld(true);
  const events: string[] = [];
  let lampLit = false, revealReady = true, sprint = false, tv = options.tvOn ?? true;
  const hint: { text: string | null; hold: number | null } = { text: null, hold: null };
  const host: BacteriaEncounterHost = {
    scene, renderCamera: new THREE.PerspectiveCamera(), eyeCamera,
    player: player as never,
    door: door as never,
    hideSpot: {
      canHide: () => wardrobe.aimed && !wardrobe.inside,
      hide: () => { wardrobe.inside = true; },
      release: () => { wardrobe.inside = false; wardrobe.exits += 1; player.setInputEnabled(true); },
      forceOut: () => { wardrobe.inside = false; },
    },
    audio: { impact: (kind: string) => events.push(`impact:${kind}`), door: () => undefined } as never,
    hud: {
      hideHint: () => { hint.text = null; }, showHint: (_key: string, text: string) => { hint.text = text; },
      pulseFlash: () => undefined, showDeath: (visible: boolean, detail?: string) => { if (visible) events.push(`death:${detail}`); },
      setQuest: () => undefined, setHold: (value: number | null) => { hint.hold = value; },
    } as never,
    television: new THREE.Group(),
    setPrompt: () => undefined,
    baseFieldOfView: () => 72,
    sprintKeyLabel: () => 'Maj',
    isSprintHeld: () => sprint,
    setAvatarHidden: () => undefined,
    threshold,
    canStartReveal: () => revealReady,
    isRevealLampLit: () => lampLit,
    isTelevisionOn: () => tv,
    onReveal: () => events.push('reveal'),
    onBreach: () => events.push('breach'),
    restoreStairwell: () => events.push('stairwell'),
    openEscape: () => events.push('open-escape'),
    onRetry: (checkpoint) => events.push(`retry:${checkpoint}`),
    onEscaped: () => events.push('escaped'),
  };
  host.scene.add(host.television!);
  const { actor, state } = fakeActor();
  const { audio, calls } = fakeAudio();
  const encounter = new BacteriaEncounter(host, actor, audio);
  const step = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds; t += DT) {
      eyeCamera.position.copy(position).setY(position.y + 0.73);
      eyeCamera.updateMatrixWorld(true);
      each?.();
      encounter.update(DT);
    }
  };
  const quest = () => encounter.questText?.text ?? null;
  /** Steps until `done()` holds; returns the seconds it took (fails past `max`). */
  const until = (done: () => boolean, max = 30, each?: () => void): number => {
    let elapsed = 0;
    while (!done()) {
      if (elapsed > max) throw new Error(`timeout after ${max}s; events: ${events.join(' | ')}`);
      step(DT, each); elapsed += DT;
    }
    return elapsed;
  };
  return {
    encounter, player, door, events, state, calls, hint, step, until, quest, actor, wardrobe,
    setLampLit: (value: boolean) => { lampLit = value; },
    setRevealReady: (value: boolean) => { revealReady = value; },
    setSprint: (value: boolean) => { sprint = value; },
    setTv: (value: boolean) => { tv = value; },
  };
}

/** Plays from the reveal to the player hidden in the closet, door shut. */
function playToHiding(world: ReturnType<typeof setup>): void {
  world.step(0.2);
  expect(world.encounter.isActive).toBe(true);
  // Passive: the player keeps walking while the lens frames the creature.
  expect(world.player.isInputEnabled).toBe(true);
  expect(world.player.lookLocked).toBe(true);
  const step = new THREE.Vector3(10, 0, 0);
  world.encounter.constrainMovement(world.player.position, step);
  expect(step.x).toBeLessThan(3);
  world.setLampLit(true);
  world.step(REVEAL_TIMELINE.freeze);
  // Back turned while it feeds.
  expect(world.actor.root.rotation.y).toBeCloseTo(Math.PI / 2, 1);
  world.step(REVEAL_TIMELINE.charge - REVEAL_TIMELINE.freeze + 0.4);
  expect(world.state.motion).toBe('run');
  expect(world.player.isInputEnabled).toBe(true);
  // Sprint home, shut the door, hide.
  world.player.position.set(threshold.x - 0.6, threshold.y + PLAYER_CENTER_HEIGHT, threshold.z);
  world.door.secured = true;
  world.step(0.2);
  expect(world.encounter.interact(new THREE.Vector3(-2.3, threshold.y + PLAYER_CENTER_HEIGHT, -1.8), new THREE.Vector3(-1, 0, 0))).toBe(true);
  expect(world.encounter.isHidden).toBe(true);
}

describe('BacteriaEncounter', () => {
  it('plays the whole night: reveal from behind, charge, siege, television lure, silent exit, stairs and the Backrooms', () => {
    const world = setup({ tvOn: true });
    playToHiding(world);
    const siege = world.until(() => world.events.includes('breach'), 20);
    expect(siege).toBeGreaterThan(DOOR_BANG_SECONDS);
    expect(world.door.breached).toBe(true);
    world.until(() => world.state.motion === 'carry', 20);
    expect(world.events).toContain('stairwell');
    expect(world.quest()).toMatch(/calme/);
    const scream = () => world.calls.filter(call => call.startsWith('setScreamActive')).at(-1);
    // Calm with the television: its voice only, no scream loop.
    expect(scream()).toBe('setScreamActive:false');
    world.step(CALM_SECONDS);
    expect(world.quest()).toMatch(/maintenir Maj/);
    world.setSprint(true);
    world.step(SNEAK_HOLD_SECONDS - 0.5);
    expect(world.encounter.isHidden).toBe(true);
    expect(world.hint.hold).toBeGreaterThan(0.7);
    world.step(0.6);
    expect(world.encounter.isHidden).toBe(false);
    world.setSprint(false);
    expect(world.player.isInputEnabled).toBe(true);
    expect(world.wardrobe.exits).toBe(1);
    expect(world.quest()).toMatch(/sans courir/);
    // Tiptoe to the landing.
    world.until(() => world.events.includes('open-escape'), 4, () => { world.player.position.x = Math.min(threshold.x + 0.5, world.player.position.x + DT * 1.4); world.player.position.z = THREE.MathUtils.lerp(world.player.position.z, threshold.z, 0.05); });
    expect(world.player.isInputEnabled).toBe(false);
    const glance = world.until(() => world.player.isInputEnabled, 3);
    expect(glance).toBeGreaterThan(SPOTTED_TIMELINE.release - 0.1);
    expect(world.state.motion).toBe('run');
    world.step(DT);
    expect(scream()).toBe('setScreamActive:true');
    // Sprint down every flight to the hall door.
    const path = new ChasePath(createEscapeWaypoints());
    let along = path.project({ x: threshold.x + 0.5, y: threshold.y, z: threshold.z });
    const feet = new THREE.Vector3();
    world.step(14, () => {
      along = Math.min(path.length, along + 5.6 * DT);
      path.sample(along, feet);
      world.player.position.set(feet.x, feet.y + PLAYER_CENTER_HEIGHT, feet.z);
    });
    expect(world.events.filter(event => event.startsWith('death'))).toEqual([]);
    expect(world.events).toContain('escaped');
    expect(world.encounter.isActive).toBe(false);
  });

  it('goes straight for the closet when the television was switched off', () => {
    const world = setup({ tvOn: false });
    playToHiding(world);
    world.until(() => world.events.some(event => event.startsWith('death')), 30);
    expect(world.events.some(event => event.startsWith('death:Rien d’autre'))).toBe(true);
    expect(world.events).not.toContain('stairwell');
    world.step(4);
    expect(world.events).toContain('retry:corridor');
    expect(world.encounter.isHidden).toBe(false);
    expect(world.door.breached).toBe(false);
  });

  it('hears a hold released too early, and restarts in the closet with the set in its arms', () => {
    const world = setup({ tvOn: true });
    playToHiding(world);
    world.until(() => /maintenir/.test(world.quest() ?? ''), 40);
    world.setSprint(true);
    world.step(0.8);
    world.setSprint(false);
    world.until(() => world.events.some(event => event.startsWith('death')), 3);
    expect(world.events).toContain('death:Il t’a entendu.');
    world.step(4);
    expect(world.events).toContain('retry:closet');
    expect(world.encounter.isHidden).toBe(true);
    expect(world.state.motion).toBe('carry');
    // The retry still lets a patient player out.
    world.step(2);
    world.setSprint(true);
    world.step(SNEAK_HOLD_SECONDS + 0.2);
    expect(world.encounter.isHidden).toBe(false);
  });

  it('hears a run through the flat', () => {
    const world = setup({ tvOn: true });
    playToHiding(world);
    world.until(() => /maintenir/.test(world.quest() ?? ''), 40);
    world.setSprint(true);
    world.until(() => !world.encounter.isHidden, 5);
    world.setSprint(false);
    world.until(() => world.events.some(event => event.startsWith('death')), 3, () => { world.player.position.z += DT * 6.2; });
    expect(world.events).toContain('death:Il t’a entendu.');
  });

  it('runs down a player who lingers on the stairs', () => {
    const world = setup({ tvOn: true });
    playToHiding(world);
    world.until(() => /maintenir/.test(world.quest() ?? ''), 40);
    world.setSprint(true);
    world.until(() => !world.encounter.isHidden, 5);
    world.setSprint(false);
    world.player.position.set(threshold.x + 0.5, threshold.y + PLAYER_CENTER_HEIGHT, threshold.z);
    world.step(SPOTTED_TIMELINE.release + 4);
    expect(world.events).toContain('death:Retour dans le placard…');
    world.step(4);
    expect(world.events).toContain('retry:closet');
  });

  it('catches a player who never runs from the corridor, then rearms at the corridor entrance', () => {
    const world = setup();
    world.step(0.2);
    world.setLampLit(true);
    world.until(() => world.events.some(event => event.startsWith('death')), REVEAL_TIMELINE.charge + 15);
    expect(world.events).toContain('death:Retour à l’entrée du couloir…');
    // Back at the entrance, the reveal waits for the player to walk in again.
    world.setRevealReady(false);
    world.step(4);
    expect(world.events).toContain('retry:corridor');
    expect(world.player.position.x).toBeCloseTo(threshold.x + 1.2);
    expect(world.encounter.isActive).toBe(false);
  });

  it('bursts the door after the siege', () => {
    const world = setup();
    playToHiding(world);
    const before = world.events.length;
    world.step(DOOR_BANG_SECONDS * 0.5);
    expect(world.events.slice(before)).not.toContain('breach');
  });

  it('resumes a survived save as a free walk to the hall door', () => {
    const world = setup();
    world.setRevealReady(false);
    world.encounter.resumeAftermath();
    expect(world.encounter.isActive).toBe(false);
    expect(world.events).toContain('open-escape');
    world.player.position.set(0.1, 0.865, -5.9);
    world.step(1.2);
    expect(world.events).toContain('escaped');
  });
});
