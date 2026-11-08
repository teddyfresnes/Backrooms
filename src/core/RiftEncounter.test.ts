import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RiftEncounter, type RiftEncounterHost } from './RiftEncounter';
import { PLANK_THICKNESS, RIFT_CENTER_Z, riftLaneX, type RiftProgress } from '../story/RiftJourney';

const EYE = 0.865;
const DT = 1 / 60;

/** Just enough of the runtime for the rift's state machine: positions are driven by the test. */
const createHarness = (saved?: RiftProgress, arrivedByFall = true) => {
  const position = new THREE.Vector3(7, EYE, RIFT_CENTER_Z + 300);
  const look = new THREE.Quaternion();
  const intent = { forward: 0, right: 0 };
  const state = {
    inputEnabled: true, lookLocked: false, grounded: true, verticalSpeed: 0,
    constraint: undefined as undefined | ((p: THREE.Vector3, m: THREE.Vector3) => void),
    chunks: new Set<string>(), teleports: [] as THREE.Vector3[], saves: [] as RiftProgress[],
    lines: [] as string[], hints: 0, deaths: [] as string[], presentation: 0, external: false, blockedSaves: 0,
  };
  const player = {
    position,
    isLocked: true,
    setInputEnabled: (enabled: boolean) => { state.inputEnabled = enabled; },
    setLookLocked: (locked: boolean) => { state.lookLocked = locked; },
    getLookQuaternion: (target = new THREE.Quaternion()) => target.copy(look),
    setLookQuaternion: (q: THREE.QuaternionLike) => { look.set(q.x, q.y, q.z, q.w); return true; },
    getViewDirection: (target = new THREE.Vector3()) => target.set(0, 0, -1).applyQuaternion(look),
    getInputIntent: () => ({ ...intent }),
    getDebugState: () => ({ grounded: state.grounded, velocity: { x: 0, y: state.verticalSpeed, z: 0 } }),
    setMovementConstraint: (constraint?: (p: THREE.Vector3, m: THREE.Vector3) => void) => { state.constraint = constraint; },
    setMovementCapabilities: () => undefined,
    setSprintSuppressed: () => undefined,
    prepareScriptedStanding: () => undefined,
    setScriptedPose: (p: THREE.Vector3Like) => { position.set(p.x, p.y, p.z); },
    teleport: (p: THREE.Vector3Like) => { position.set(p.x, p.y, p.z); state.teleports.push(position.clone()); },
  };
  const creatureRoot = new THREE.Group();
  let creatureVisible = false;
  const creature = {
    root: creatureRoot,
    get isVisible() { return creatureVisible; },
    setVisible: (visible: boolean) => { creatureVisible = visible; },
    setLookTarget: () => undefined, setMotion: () => undefined, snapHead: () => undefined, update: () => undefined,
    setPlacement: (p: THREE.Vector3Like, yaw: number) => { creatureRoot.position.set(p.x, p.y, p.z); creatureRoot.rotation.y = yaw; },
    getFacePosition: (out: THREE.Vector3) => out.copy(creatureRoot.position).add({ x: 0, y: 2, z: 0 }),
  };
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.04, 180);
  const silent = new Proxy({}, { get: () => () => undefined });
  const host = {
    scene: new THREE.Scene(),
    renderCamera: camera,
    player,
    physics: {
      addChunk: (key: string) => { state.chunks.add(key); },
      removeChunk: (key: string) => state.chunks.delete(key),
      castEnvironmentRay: () => null,
    },
    character: {
      isDown: false,
      setActive: () => undefined,
      beginComputerPresentation: () => { state.presentation += 1; },
      endComputerPresentation: () => { state.presentation -= 1; },
      sampleCorridorPresentation: (p: THREE.Vector3) => ({ eye: p.clone().add({ x: 0, y: 0.8, z: 0 }), head: p.clone().add({ x: 0, y: 0.75, z: 0 }) }),
      setExternalCameraPresentation: (active: boolean) => { state.external = active; },
    },
    hud: {
      setFade: () => undefined, hideHint: () => undefined, pulseFlash: () => undefined,
      showHint: () => { state.hints += 1; },
      showDeath: (visible: boolean, _detail?: string, title?: string) => { if (visible) state.deaths.push(title ?? ''); },
    },
    balanceMeter: { update: () => undefined },
    sound: silent,
    creatureSound: silent,
    seed: 'RIFT-ENCOUNTER-AUDIT',
    creature: () => creature,
    baseFieldOfView: () => 72,
    reducedMotion: () => false,
    keyLabel: (action: string) => action.toUpperCase(),
    say: (text: string) => { state.lines.push(text); },
    captionBusy: () => false,
    onProgress: (progress: RiftProgress) => {
      state.saves.push(progress);
      // The host saves right away: the encounter must already allow it.
      if (encounter.blocksSaving) state.blockedSaves += 1;
    },
  } as unknown as RiftEncounterHost;
  const encounter = new RiftEncounter(host, saved, arrivedByFall);
  const internals = encounter as unknown as { phase: string; balance?: { lean: number }; plank?: { lane: number } };
  /** Runs frames; `move` lets the test walk the capsule (through the plank constraint when set). */
  const run = (seconds: number, move?: (dt: number) => THREE.Vector3 | void) => {
    for (let t = 0; t < seconds; t += DT) {
      encounter.update(DT);
      const step = move?.(DT);
      if (step) {
        const movement = step.clone();
        state.constraint?.(position, movement);
        position.add(movement);
      }
    }
  };
  return { encounter, internals, state, position, intent, run, creature };
};

const walkOn = (harness: ReturnType<typeof createHarness>) => {
  harness.run(1.5);
  // Into the south approach hall, then to the brink of the portal of lane 0.
  harness.position.set(riftLaneX(0), EYE, RIFT_CENTER_Z + 24);
  harness.run(0.2);
  harness.position.set(riftLaneX(0), EYE, RIFT_CENTER_Z + 6.4);
  harness.run(0.1);
};

describe('rift encounter', () => {
  it('speaks after the fall, lays the plank out of sight, then shows it from the brink', () => {
    const harness = createHarness();
    harness.run(1.5);
    expect(harness.internals.phase).toBe('north');
    expect(harness.state.lines[0]).toContain('C’est quoi ce bordel');
    expect(harness.encounter.questText?.text).toBe('Suivre la boussole vers le nord');
    harness.position.set(riftLaneX(0), EYE, RIFT_CENTER_Z + 24);
    harness.run(0.2);
    // Laid while the player is still behind the gallery wall, two portals away.
    expect(harness.state.chunks.has('rift-plank')).toBe(true);
    expect(Math.abs(harness.internals.plank!.lane)).toBe(2);
    harness.position.set(riftLaneX(0), EYE, RIFT_CENTER_Z + 6.4);
    harness.run(0.1);
    expect(harness.internals.phase).toBe('edge');
    expect(harness.state.inputEnabled).toBe(false);
    expect(harness.state.lookLocked).toBe(true);
    harness.run(9);
    expect(harness.internals.phase).toBe('plank');
    expect(harness.state.inputEnabled).toBe(true);
    expect(harness.state.saves.at(-1)?.stage).toBe('plank');
    expect(harness.state.lines.some((line) => line.includes('planche'))).toBe(true);
  });

  it('loses its balance without help, falls into the rift and resumes at the plank', () => {
    const harness = createHarness();
    walkOn(harness);
    harness.run(9);
    const lane = harness.internals.plank!.lane, plankY = PLANK_THICKNESS + EYE;
    harness.position.set(riftLaneX(lane), plankY, RIFT_CENTER_Z + 6.4);
    harness.intent.forward = 1;
    harness.run(0.05);
    expect(harness.internals.phase).toBe('crossing');
    expect(harness.encounter.blocksSaving).toBe(true);
    // Unattended: it tips, the body leaves the board and drops.
    harness.run(6, (dt) => {
      const phase = harness.internals.phase;
      if (phase !== 'crossing') return;
      const off = Math.abs(harness.position.x - riftLaneX(lane)) > 0.3;
      if (off) harness.position.y -= dt * 6;
      return new THREE.Vector3(0, 0, -3 * dt);
    });
    expect(['falling', 'dead']).toContain(harness.internals.phase);
    expect(harness.state.external).toBe(true);
    harness.run(7);
    expect(harness.internals.phase).toBe('plank');
    expect(harness.state.deaths).toContain('Tu es tombé.');
    const respawn = harness.state.teleports.at(-1)!;
    expect(respawn.x).toBeCloseTo(riftLaneX(lane), 5);
    expect(respawn.z).toBeGreaterThan(RIFT_CENTER_Z + 6);
    expect(harness.state.external).toBe(false);
  });

  const crossOver = (harness: ReturnType<typeof createHarness>) => {
    walkOn(harness);
    harness.run(9);
    const lane = harness.internals.plank!.lane;
    harness.position.set(riftLaneX(lane), PLANK_THICKNESS + EYE, RIFT_CENTER_Z + 6.4);
    harness.intent.forward = 1;
    let held = 0;
    harness.run(16, (dt) => {
      const balance = harness.internals.balance;
      if (balance) {
        if (Math.abs(balance.lean) > 0.16) held = -Math.sign(balance.lean);
        else if (Math.abs(balance.lean) < 0.05) held = 0;
        harness.intent.right = held;
      }
      return harness.internals.phase === 'crossing' ? new THREE.Vector3(0, 0, -3 * dt) : undefined;
    });
    harness.intent.right = 0;
    expect(harness.internals.phase).toBe('crossed');
    harness.position.set(riftLaneX(lane) + 0.5, EYE, RIFT_CENTER_Z - 9.5);
    harness.run(0.05);
    expect(harness.internals.phase).toBe('turn');
    expect(harness.encounter.ownsCharacter).toBe(true);
    harness.run(5.3);
    expect(harness.internals.phase).toBe('standoff');
    expect(harness.state.presentation).toBe(0);
    expect(harness.encounter.ownsCharacter).toBe(false);
    expect(harness.encounter.questText?.urgent).toBe(true);
    return lane;
  };

  it('crosses with a steady hand, turns round on what followed, and drops it into the void', () => {
    const harness = createHarness();
    const lane = crossOver(harness);
    // Waits at the far brink, then steps onto the board.
    harness.position.set(riftLaneX(lane), EYE, RIFT_CENTER_Z - 7.2);
    harness.run(3);
    expect(harness.creature.isVisible).toBe(true);
    expect(harness.state.hints).toBeGreaterThan(0);
    expect(harness.encounter.handleInteract()).toBe(true);
    expect(harness.state.chunks.has('rift-plank')).toBe(false);
    harness.run(5);
    expect(harness.internals.phase).toBe('done');
    expect(harness.state.saves.at(-1)).toMatchObject({ stage: 'done', resolution: 'dropped' });
    expect(harness.state.saves.at(-1)?.plank).toBeUndefined();
    expect(harness.creature.isVisible).toBe(false);
    expect(harness.encounter.questText?.text).toBe('Continuer vers le nord');
    expect(harness.state.blockedSaves).toBe(0);
  });

  it('lets a runner outpace the creature once it is across, and catches one who stays', () => {
    const runner = createHarness();
    const lane = crossOver(runner);
    runner.position.set(riftLaneX(lane), EYE, RIFT_CENTER_Z - 7.5);
    runner.run(14, (dt) => (runner.internals.phase === 'standoff' || runner.internals.phase === 'chase'
      ? new THREE.Vector3(0, 0, -6.6 * dt) : undefined));
    runner.run(12, (dt) => (runner.internals.phase === 'chase' ? new THREE.Vector3(0, 0, -6.6 * dt) : undefined));
    expect(runner.internals.phase).toBe('done');
    expect(runner.state.saves.at(-1)).toMatchObject({ stage: 'done', resolution: 'fled' });
    expect(runner.state.blockedSaves).toBe(0);

    const stayer = createHarness();
    const stayLane = crossOver(stayer);
    stayer.position.set(riftLaneX(stayLane) + 2, EYE, RIFT_CENTER_Z - 8);
    stayer.run(16);
    expect(stayer.state.deaths).toContain('Elle t’a eu.');
    expect(['dead', 'standoff']).toContain(stayer.internals.phase);
  });

  it('restores a laid plank from a save and never replays spoken lines', () => {
    const harness = createHarness({ version: 1, stage: 'plank', plank: { lane: 3, story: 0, bank: 1 }, spoken: ['wake', 'where', 'items', 'north', 'edge', 'plank'] }, false);
    expect(harness.state.chunks.has('rift-plank')).toBe(true);
    harness.run(1);
    expect(harness.internals.phase).toBe('plank');
    expect(harness.state.lines).toHaveLength(0);
  });
});
