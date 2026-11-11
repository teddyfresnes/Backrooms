import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RiftEncounter, type RiftEncounterHost } from './RiftEncounter';
import { PLANK_THICKNESS, RIFT_CENTER_Z, riftLaneX, type RiftProgress } from '../story/RiftJourney';
import type { BackroomsHunt } from '../monster/BackroomsHunt';
import { carve, racingLine } from '../monster/BackroomsMazes.test-helpers';

const EYE = 0.865;
const DT = 1 / 60;

/** Just enough of the runtime for the rift's state machine: positions are driven by the test. */
const createHarness = (saved?: RiftProgress, arrivedByFall = true, restoredPosition?: THREE.Vector3Like) => {
  const position = new THREE.Vector3(7, EYE, RIFT_CENTER_Z + 300);
  if (restoredPosition) position.copy(restoredPosition);
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
    setPace: () => undefined, setHeadTwist: () => undefined,
    setPlacement: (p: THREE.Vector3Like, yaw: number) => { creatureRoot.position.set(p.x, p.y, p.z); creatureRoot.rotation.y = yaw; },
    getFacePosition: (out: THREE.Vector3) => out.copy(creatureRoot.position).add({ x: 0, y: 2, z: 0 }),
  };
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.04, 180);
  const silent = new Proxy({}, { get: () => () => undefined });
  /** A tiny stand-in for the maze: a flat floor at y = 0, an optional corridor
   * end straight ahead of the eyes, an optional wall hiding the player, or a
   * whole grid maze ('#' walls, 0.5 m cells) for the far-bank hunt. */
  const world = { corridor: 0, wallBetween: false, maze: undefined as undefined | { rows: string[]; originX: number; originZ: number } };
  const mazeOpen = (x: number, z: number): boolean => {
    const maze = world.maze!;
    return maze.rows[Math.floor((z - maze.originZ) / 0.5)]?.[Math.floor((x - maze.originX) / 0.5)] === '.';
  };
  const host = {
    scene: new THREE.Scene(),
    renderCamera: camera,
    player,
    physics: {
      addChunk: (key: string) => { state.chunks.add(key); },
      removeChunk: (key: string) => state.chunks.delete(key),
      probeWalkableCell: (x: number, z: number, floorY: number) => (!world.maze || mazeOpen(x, z) ? floorY : Number.NaN),
      castEnvironmentRay: (origin: THREE.Vector3Like, direction: THREE.Vector3Like, max: number) => {
        if (direction.y < -0.5) return origin.y > 0 && origin.y < max ? { distance: origin.y, normal: { x: 0, y: 1, z: 0 } } : null;
        if (world.maze) {
          for (let travelled = 0; travelled <= max; travelled += 0.1) {
            if (!mazeOpen(origin.x + direction.x * travelled, origin.z + direction.z * travelled)) return { distance: travelled, normal: { x: 0, y: 0, z: 1 } };
          }
          return null;
        }
        const fromEyes = Math.hypot(origin.x - camera.position.x, origin.y - camera.position.y, origin.z - camera.position.z) < 1e-6;
        if (fromEyes) return world.corridor > 0 && world.corridor <= max ? { distance: world.corridor, normal: { x: 0, y: 0, z: 1 } } : null;
        return world.wallBetween ? { distance: 1, normal: { x: 1, y: 0, z: 0 } } : null;
      },
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
      // Like the rig: the presented camera sits in the player's eyes unless a shot owns it.
      if (!encounter.ownsCharacter) { camera.position.copy(position).add({ x: 0, y: 0.8, z: 0 }); camera.quaternion.copy(look); }
      encounter.update(DT);
      const step = move?.(DT);
      if (step) {
        const movement = step.clone();
        state.constraint?.(position, movement);
        position.add(movement);
      }
    }
  };
  return { encounter, internals, state, position, intent, run, creature, world, look };
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
    // Laid while the player is still behind the gallery wall, across the next portal pair.
    expect(harness.state.chunks.has('rift-plank')).toBe(true);
    expect(Math.abs(harness.internals.plank!.lane)).toBe(1);
    harness.position.set(riftLaneX(0), EYE, RIFT_CENTER_Z + 6.4);
    harness.run(0.1);
    expect(harness.internals.phase).toBe('edge');
    expect(harness.state.inputEnabled).toBe(false);
    expect(harness.state.lookLocked).toBe(true);
    // First person over the void, then the exterior shot from the void (third person).
    harness.run(1);
    expect(harness.encounter.ownsCharacter).toBe(false);
    harness.run(1.5);
    expect(harness.encounter.ownsCharacter).toBe(true);
    expect(harness.state.presentation).toBe(1);
    harness.run(6.5);
    expect(harness.state.presentation).toBe(0);
    expect(harness.internals.phase).toBe('plank');
    expect(harness.state.inputEnabled).toBe(true);
    expect(harness.state.saves.at(-1)?.stage).toBe('plank');
    expect(harness.state.lines.some((line) => line.includes('planche'))).toBe(true);
  });

  it('falls when an uncorrected imbalance tips it off the plank and resumes at the near bank', () => {
    const harness = createHarness();
    walkOn(harness);
    harness.run(9);
    const lane = harness.internals.plank!.lane, plankY = PLANK_THICKNESS + EYE;
    harness.position.set(riftLaneX(lane), plankY, RIFT_CENTER_Z + 6.4);
    harness.intent.forward = 1;
    harness.run(0.05);
    expect(harness.internals.phase).toBe('crossing');
    expect(harness.encounter.blocksSaving).toBe(true);
    harness.internals.balance!.lean = .45;
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
    harness.run(11, (dt) => {
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
    // Still charging down its corridor toward the far edge: the board goes first.
    harness.position.set(riftLaneX(lane), EYE, RIFT_CENTER_Z - 7.2);
    harness.run(0.5);
    expect(harness.creature.isVisible).toBe(true);
    expect(Math.abs(harness.creature.root.position.z - RIFT_CENTER_Z)).toBeGreaterThan(12);
    expect(harness.state.hints).toBeGreaterThan(0);
    expect(harness.encounter.handleInteract()).toBe(true);
    expect(harness.state.chunks.has('rift-plank')).toBe(false);
    // Not a vanishing act: it bolts back down its corridor, still in sight for a while.
    const atDrop = Math.abs(harness.creature.root.position.z - RIFT_CENTER_Z);
    harness.run(2.5);
    expect(harness.creature.isVisible).toBe(true);
    expect(Math.abs(harness.creature.root.position.z - RIFT_CENTER_Z)).toBeGreaterThan(atDrop + 5);
    harness.run(7);
    expect(harness.internals.phase).toBe('done');
    expect(harness.state.saves.at(-1)).toMatchObject({ stage: 'done', resolution: 'dropped' });
    expect(harness.state.saves.at(-1)?.plank).toBeUndefined();
    expect(harness.creature.isVisible).toBe(false);
    expect(harness.encounter.questText?.text).toBe('Continuer vers le nord');
    expect(harness.state.blockedSaves).toBe(0);
  });

  it('sends the creature down the void with the board when it is already on it', () => {
    const harness = createHarness();
    const lane = crossOver(harness);
    harness.position.set(riftLaneX(lane), EYE, RIFT_CENTER_Z - 7.2);
    const mode = () => (harness.encounter as unknown as { creatureMode: string }).creatureMode;
    for (let waited = 0; waited < 12 && mode() !== 'plank'; waited += 0.1) harness.run(0.1);
    harness.run(1.5);
    expect(mode()).toBe('plank');
    expect(harness.encounter.handleInteract()).toBe(true);
    const before = harness.creature.root.position.y;
    harness.run(1.5);
    expect(mode()).toBe('falling');
    expect(harness.creature.root.position.y).toBeLessThan(before - 4);
    harness.run(4);
    expect(harness.creature.isVisible).toBe(false);
    expect(harness.internals.phase).toBe('done');
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

  /** City blocks on the far bank: 2 m streets every 8 m, the player at a crossing. */
  const farBank = (harness: ReturnType<typeof createHarness>) => {
    const originX = 0, originZ = RIFT_CENTER_Z - 130;
    const rects: [number, number, number, number][] = [];
    for (let line = 0; line < 11; line += 1) { rects.push([0, line * 8, 84, line * 8 + 2]); rects.push([line * 8, 0, line * 8 + 2, 84]); }
    harness.world.maze = { rows: carve(168, 168, rects), originX, originZ };
    harness.position.set(originX + 41, EYE, originZ + 65);
    return { originX, originZ };
  };
  const hunter = (harness: ReturnType<typeof createHarness>) => (harness.encounter as unknown as { hunt?: BackroomsHunt }).hunt;
  /** Visible to the player: inside the camera frustum with a clear line from the eyes (head or chest). */
  const onScreen = (harness: ReturnType<typeof createHarness>) => {
    const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.04, 180);
    camera.position.copy(harness.position).add({ x: 0, y: 0.8, z: 0 });
    camera.quaternion.copy(harness.look);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const body = harness.creature.root.position;
    const clear = (x: number, z: number) => {
      const length = Math.hypot(x - camera.position.x, z - camera.position.z);
      for (let t = 0; t < length; t += 0.1) {
        const px = camera.position.x + (x - camera.position.x) * t / length, pz = camera.position.z + (z - camera.position.z) * t / length;
        const rows = harness.world.maze!.rows, i = Math.floor((px - harness.world.maze!.originX) / 0.5), j = Math.floor((pz - harness.world.maze!.originZ) / 0.5);
        if (rows[j]?.[i] !== '.') return false;
      }
      return true;
    };
    return [1.2, 1.95].some((height) => frustum.containsPoint(new THREE.Vector3(body.x, body.y + height, body.z))) && clear(body.x, body.z);
  };

  it('lurks out of sight on the far bank: never on screen, never within 20 m when it appears', () => {
    const harness = createHarness({ version: 1, stage: 'done', resolution: 'dropped', spoken: [] }, false);
    farBank(harness);
    let time = 0, appeared = false;
    // Up and down the northbound street until the director places it.
    for (let waited = 0; waited < 150 && !appeared; waited += 0.25) {
      harness.run(0.25, (dt) => {
        time += dt;
        if (harness.creature.isVisible && !appeared) {
          appeared = true;
          expect(harness.creature.root.position.distanceTo(new THREE.Vector3(harness.position.x, 0, harness.position.z))).toBeGreaterThanOrEqual(20);
          expect(onScreen(harness)).toBe(false);
        }
        return new THREE.Vector3(0, 0, Math.sign(Math.sin(time / 6)) * -2.4 * dt);
      });
    }
    expect(appeared).toBe(true);
    expect(['lurk', 'notice', 'chase']).toContain(hunter(harness)!.state);
  });

  it('catches a player who freezes, then resumes where it noticed him, alone', () => {
    const harness = createHarness({ version: 1, stage: 'done', resolution: 'dropped', spoken: [] }, false);
    farBank(harness);
    harness.run(0.2);
    const hunt = hunter(harness)!;
    const standing = harness.position.clone();
    // Straight down his street, 7 m off: close enough to wake.
    hunt.hunter.place({ x: standing.x, y: 0, z: standing.z - 7, yaw: 0, style: 'still' });
    let saved = false;
    harness.run(4, () => { if (harness.internals.phase === 'stalk') saved ||= harness.encounter.blocksSaving; });
    expect(saved).toBe(true);
    expect(harness.state.deaths).toContain('Elle t’a eu.');
    harness.run(5);
    expect(harness.internals.phase).toBe('done');
    const respawn = harness.state.teleports.at(-1)!;
    expect(Math.hypot(respawn.x - standing.x, respawn.z - standing.z)).toBeLessThan(0.5);
    expect(harness.creature.isVisible).toBe(false);
    expect(hunt.director.phase).toBe('relief');
    expect(harness.encounter.blocksSaving).toBe(false);
  });

  it('is shaken off by a sprint chaining corners, then searches without vanishing in sight', () => {
    const harness = createHarness({ version: 1, stage: 'done', resolution: 'dropped', spoken: [] }, false);
    const { originX, originZ } = farBank(harness);
    harness.run(0.2);
    const hunt = hunter(harness)!;
    // A staircase of streets toward the north-east, corners every 8 m.
    const route: { x: number; z: number }[] = [{ x: originX + 41, z: originZ + 65 }];
    for (let step = 0; step < 4; step += 1) {
      const last = route[route.length - 1]!;
      route.push({ x: last.x, z: last.z - 8 }, { x: last.x + 8, z: last.z - 8 });
    }
    const line = racingLine(route, 1.4);
    hunt.hunter.place({ x: originX + 41, y: 0, z: originZ + 72, yaw: Math.PI, style: 'still' });
    let travelled = 0, segment = 1, lost = false, vanishedInSight = false, wasVisible = false;
    harness.run(30, (dt) => {
      if (hunt.state === 'search' || hunt.state === 'shadow') lost = true;
      if (wasVisible && !harness.creature.isVisible && onScreen(harness)) vanishedInSight = true;
      wasVisible = harness.creature.isVisible;
      // Runs once it has seen him and screamed.
      if (!['chase', 'search', 'shadow', 'withdraw', 'dormant'].includes(hunt.state) || segment >= line.length) return undefined;
      const target = line[segment]!, dx = target.x - harness.position.x, dz = target.z - harness.position.z, distance = Math.hypot(dx, dz);
      const step = Math.min(distance, 6.6 * dt);
      travelled += step;
      if (distance - step < 0.05) segment += 1;
      return distance > 1e-6 ? new THREE.Vector3(dx / distance * step, 0, dz / distance * step) : undefined;
    });
    expect(travelled).toBeGreaterThan(40);
    expect(harness.state.deaths).toHaveLength(0);
    expect(lost).toBe(true);
    expect(vanishedInSight).toBe(false);
    expect(harness.internals.phase).toBe('done');
  });

  it('keeps the creature at the far end of its corridor during the turn shot', () => {
    const harness = createHarness();
    walkOn(harness);
    harness.run(9);
    const lane = harness.internals.plank!.lane;
    harness.position.set(riftLaneX(lane), PLANK_THICKNESS + EYE, RIFT_CENTER_Z + 6.4);
    harness.intent.forward = 1;
    let held = 0;
    harness.run(11, (dt) => {
      const balance = harness.internals.balance;
      if (balance) { if (Math.abs(balance.lean) > 0.16) held = -Math.sign(balance.lean); else if (Math.abs(balance.lean) < 0.05) held = 0; harness.intent.right = held; }
      return harness.internals.phase === 'crossing' ? new THREE.Vector3(0, 0, -3 * dt) : undefined;
    });
    harness.intent.right = 0;
    harness.position.set(riftLaneX(lane) + 0.5, EYE, RIFT_CENTER_Z - 9.5);
    harness.run(0.05);
    expect(harness.internals.phase).toBe('turn');
    let nearest = Infinity;
    harness.run(5.3, () => {
      if (harness.internals.phase === 'turn' && harness.creature.isVisible) {
        nearest = Math.min(nearest, harness.creature.root.position.distanceTo(new THREE.Vector3(harness.position.x, 0, harness.position.z)));
      }
    });
    expect(Number.isFinite(nearest)).toBe(true);
    expect(nearest).toBeGreaterThanOrEqual(21);
  });

  it('restores a laid plank from a save and never replays spoken lines', () => {
    const harness = createHarness({ version: 1, stage: 'plank', plank: { lane: 3, story: 0, bank: 1 }, spoken: ['wake', 'where', 'items', 'north', 'edge', 'plank'] }, false);
    expect(harness.state.chunks.has('rift-plank')).toBe(true);
    harness.run(1);
    expect(harness.internals.phase).toBe('plank');
    expect(harness.state.lines).toHaveLength(0);
  });

  it('saves the far bank before the reveal and restores the board, elapsed delay and next event', () => {
    const saved: RiftProgress={version:1,stage:'plank',plank:{lane:3,story:0,bank:1},spoken:['steady']};
    const h=createHarness(saved,false);
    h.position.set(riftLaneX(3),PLANK_THICKNESS+EYE,RIFT_CENTER_Z+6.4);h.run(.05);
    // Normal walking now covers the board in under six seconds, including the bearings.
    h.intent.forward=1;
    h.run(5,dt=>{
      if(h.internals.balance)h.internals.balance.lean=0;
      return h.internals.phase==='crossing'?new THREE.Vector3(0,0,-3*dt):undefined;
    });
    expect(h.internals.phase).toBe('crossed');expect(h.encounter.blocksSaving).toBe(false);
    h.run(2);
    const snapshot=h.encounter.snapshot,position=h.position.clone();
    expect(snapshot.stage).toBe('crossed');expect(snapshot.crossedSeconds).toBeGreaterThan(2);
    expect(h.state.saves.at(-1)?.stage).toBe('crossed');expect(h.state.blockedSaves).toBe(0);
    h.encounter.dispose();
    const restored=createHarness(snapshot,false,position);
    expect(restored.position.toArray()).toEqual(position.toArray());
    expect(restored.internals.phase).toBe('crossed');expect(restored.state.chunks.has('rift-plank')).toBe(true);
    expect(restored.encounter.snapshot.crossedSeconds).toBeCloseTo(snapshot.crossedSeconds!);
    restored.run(.1);expect(restored.state.lines).toHaveLength(0);
    restored.position.z-=2;restored.run(.1);expect(restored.internals.phase).toBe('turn');
    restored.run(5);expect(restored.creature.isVisible).toBe(true);
    restored.encounter.dispose();
  });

  it('recovers the pending reveal from a legacy plank save already on the far bank', () => {
    const h=createHarness({version:1,stage:'plank',plank:{lane:2,story:0,bank:1},spoken:[]},false,
      new THREE.Vector3(riftLaneX(2),EYE,RIFT_CENTER_Z-7.5));
    expect(h.internals.phase).toBe('crossed');expect(h.state.chunks.has('rift-plank')).toBe(true);
    h.position.z-=2;h.run(.1);expect(h.internals.phase).toBe('turn');h.encounter.dispose();
  });
});
