import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom';
import type {
  GridPitFeature,
  InteractiveDoorFeature,
  StairSocketFeature,
  WallSegment,
  WorldPlan,
} from '../world/types';
import { rectCenter } from '../world/types';

export type GraffitiKind = 'message' | 'symbol' | 'direction';
export type GraffitiSymbol =
  | 'smile'
  | 'sad'
  | 'eye'
  | 'spiral'
  | 'tallies'
  | 'cross'
  | 'door'
  | 'hand'
  | 'skull'
  | 'house'
  | 'stick-figure'
  | 'broken-heart'
  | 'eyes'
  | 'teeth'
  | 'crown'
  | 'web'
  | 'doll';

export interface WallGraffitiPlacement {
  id: string;
  wall: WallSegment;
  side: -1 | 1;
  along: number;
  centerY: number;
  width: number;
  height: number;
  kind: GraffitiKind;
  lines: string[];
  symbol?: GraffitiSymbol;
  arrowDirection?: -1 | 1;
  arrowCount?: number;
  targetKind?: 'pitfall' | 'stairs';
  targetFeatureId?: string;
  ink: string;
  opacity: number;
  seed: string;
}

const HORROR_MESSAGES = [
  'DO NOT TURN AROUND',
  'IT IS BEHIND YOU',
  'THE WALLS ARE HUNGRY',
  'THE CEILING IS BREATHING',
  "DON'T LISTEN TO THE LIGHTS",
  'THEY FOUND ME',
  'I AM STILL HERE',
  'THIS IS NOT A FLOOR',
  'YOU HAVE ALREADY BEEN DOWN HERE',
  'THERE IS NO EXIT',
  'SOMETHING WALKS HERE',
  'NEVER SLEEP',
  'IT SCRATCHES INSIDE THE WALL',
  'WE ARE HUNGRY',
  'THE CARPET IS WARM',
  'THE FOOTSTEPS ARE NOT YOURS',
  "DON'T COUNT THE DOORS",
  'THE ROOM REMEMBERS',
  'I SAW IT WITHOUT A FACE',
  'YOU ARE NOT ALONE',
  'THE EXIT LIES',
  "DON'T LOOK UP",
  'IT KNOWS YOUR NAME',
  'I HEAR YOU BREATHING',
  'HOME IS NOT HERE',
  'I DREW THE EXIT',
  'NO ONE LIVES HERE',
  'THE WINDOWS ARE WATCHING',
  'COUNT AGAIN',
  'MY HAND IS NOT MINE',
  'THE HUM HAS TEETH',
  'IT LEARNED MY VOICE',
  'YOUR SHADOW MOVED FIRST',
  'DO NOT FOLLOW THE SMILE',
  'THE LIGHTS BLINKED TWICE',
  'THEY HIDE WHEN YOU LOOK',
  'THIS HALLWAY WAS SHORTER',
  'THE DOOR IS BREATHING',
  'I CAN HEAR THE PAINT',
  'THE FLOOR KNOWS YOUR WEIGHT',
  'THERE ARE EYES IN THE CARPET',
  'THEY ARE WAITING UPSTAIRS',
  'YOU LEFT SOMETHING HERE',
  "DON'T LET IT SEE YOU",
  'IT WANTS TO BE FOUND',
] as const;

const WARNINGS = [
  'NOT THIS WAY',
  'TURN BACK',
  'FALSE EXIT',
  'LEVEL -1 ?',
  'WAIT HERE',
  'RUN',
  'NO MORE LIGHT',
  'SAFE ZONE ?',
  'DO NOT ENTER',
  'THREE MORE DOORS',
  'STAY LOW',
  'QUIET',
  'IT LOOPS',
  'I WAS HERE ALREADY',
  'WRONG WAY',
  'WE ALWAYS COME BACK',
  'DOOR 17',
  'NO END',
  'HOME ?',
  'DO NOT FOLLOW THE HANDS',
  'DAY 0',
  'THEY ARE COUNTING TOO',
  'KEEP WALKING',
  "DON'T OPEN IT",
  'NOT A WAY OUT',
  'LIGHTS OFF',
  'TOO LATE',
  'NOT SAFE',
  'HIDE',
  'LOOK DOWN',
  'LEAVE THE DOOR CLOSED',
  'NO SIGNAL',
  'STAY AWAY FROM THE CORNERS',
  "DON'T TRUST THE ARROWS",
] as const;

const SUBJECTS = [
  'THE WALL',
  'THE LIGHT',
  'THE FLOOR',
  'THE ROOM',
  'THE HALL',
  'THE DOOR',
  'THE SHADOW',
  'THE NOISE',
  'THE HUM',
  'THE SMILE',
  'THE CARPET',
  'THE CORNER',
  'SOMETHING',
] as const;

const ACTIONS = [
  'WATCHES',
  'LISTENS',
  'LIES',
  'MOVES',
  'COMES BACK',
  'WAITS',
  'KNOWS',
  'BREATHES',
  'COUNTS',
  'LEARNS',
  'FOLLOWS',
] as const;

const OBJECTS = [
  'YOUR NAME',
  'YOUR STEPS',
  'THE EXIT',
  'THIS WAY',
  'THE SILENCE',
  'BEHIND YOU',
  'UNDER THE FLOOR',
  'WHILE YOU SLEEP',
  'THE NEXT ROOM',
  'THE CORNER',
] as const;

const NAMES = [
  'MIA',
  'NOAH',
  'MILO',
  'JUNE',
  'SAM',
  'ELI',
  'ASH',
  'ADA',
  '???',
] as const;

const SYMBOLS: GraffitiSymbol[] = [
  'smile',
  'sad',
  'eye',
  'spiral',
  'tallies',
  'cross',
  'door',
  'hand',
  'skull',
  'house',
  'stick-figure',
  'broken-heart',
  'eyes',
  'teeth',
  'crown',
  'web',
  'doll',
];

const FONT_FAMILIES = [
  '"Segoe Print", cursive',
  '"Ink Free", "Segoe Print", cursive',
  '"Segoe Script", "Segoe Print", cursive',
  '"Bradley Hand ITC", "Segoe Print", cursive',
  '"Lucida Handwriting", "Segoe Print", cursive',
  '"Comic Sans MS", cursive',
  '"Courier New", monospace',
  '"Times New Roman", serif',
  'Impact, sans-serif',
  '"Trebuchet MS", sans-serif',
] as const;

const inkPalette = (plan: WorldPlan): readonly string[] =>
  plan.visualBiome === 'white'
    ? ['#211d1b', '#431814', '#172735', '#382d24', '#641f18']
    : plan.visualBiome === 'red'
      ? ['#130807', '#24100d', '#6e5545', '#8a7160', '#35130e']
      : ['#2a1a13', '#43130f', '#181714', '#503122', '#33261e'];

const wallCenterDistance = (
  wall: WallSegment,
  target: { x: number; z: number },
): number => Math.hypot(wall.x - target.x, wall.z - target.z);

const eligibleGraffitiWalls = (plan: WorldPlan): WallSegment[] =>
  plan.walls.filter((wall) =>
    wall.kind === 'wallpaper' &&
    Math.abs(wall.bottom) < 0.12 &&
    wall.height >= 1.9 &&
    wall.length >= 2.35 &&
    wall.detail !== 'upper-shell' &&
    wall.detail !== 'upper-portal-lintel' &&
    wall.detail !== 'ceiling-drop' &&
    wall.detail !== 'biome-boundary-skin' &&
    wall.detail !== 'biome-boundary-band' &&
    !wall.id.includes('shaft-') &&
    !wall.id.includes('vista-')
  );

const facingSide = (
  plan: WorldPlan,
  wall: WallSegment,
  rng: SeededRandom,
): -1 | 1 => {
  const nearestRoom = [...plan.rooms]
    .sort((left, right) => {
      const leftCenter = rectCenter(left.bounds);
      const rightCenter = rectCenter(right.bounds);
      return (
        Math.hypot(leftCenter.x - wall.x, leftCenter.z - wall.z) -
        Math.hypot(rightCenter.x - wall.x, rightCenter.z - wall.z)
      );
    })[0];
  if (!nearestRoom) return rng.chance(0.5) ? 1 : -1;
  const roomCenter = rectCenter(nearestRoom.bounds);
  const normalDelta = wall.orientation === 'x'
    ? roomCenter.z - wall.z
    : roomCenter.x - wall.x;
  if (Math.abs(normalDelta) < 0.08) return rng.chance(0.5) ? 1 : -1;
  return normalDelta > 0 ? 1 : -1;
};

const localRight = (
  wall: WallSegment,
  side: -1 | 1,
): { x: number; z: number } =>
  wall.orientation === 'x'
    ? { x: side, z: 0 }
    : { x: 0, z: -side };

const createMessage = (rng: SeededRandom): string[] => {
  const mode = rng.weighted([
    { value: 'fixed-horror' as const, weight: 0.34 },
    { value: 'generated-horror' as const, weight: 0.24 },
    { value: 'warning' as const, weight: 0.27 },
    { value: 'trace' as const, weight: 0.15 },
  ]);
  if (mode === 'fixed-horror') return [rng.pick(HORROR_MESSAGES)];
  if (mode === 'warning') return [rng.pick(WARNINGS)];
  if (mode === 'trace') {
    return rng.chance(0.5)
      ? [`${rng.pick(NAMES)} WAS HERE`, `${rng.int(2, 93)} DAYS`]
      : [`DAY ${rng.int(4, 999)}`, rng.pick(['STILL NOTHING', 'SAME HALL', 'NO WATER'])];
  }
  const subject = rng.pick(SUBJECTS);
  const action = rng.pick(ACTIONS);
  const object = rng.pick(OBJECTS);
  return rng.chance(0.48)
    ? [`${subject} ${action}`, object]
    : [`${subject} ${action} ${object}`];
};

const targetCenter = (
  feature: GridPitFeature | StairSocketFeature,
): { x: number; z: number } => {
  if (feature.kind === 'grid-pit' && feature.holes.length > 0) {
    return rectCenter(feature.holes[Math.floor(feature.holes.length * 0.5)]!);
  }
  return rectCenter(feature.bounds);
};

const makePlacement = (
  plan: WorldPlan,
  wall: WallSegment,
  rng: SeededRandom,
  index: number,
  kind: GraffitiKind,
): WallGraffitiPlacement => {
  const maxWidth = Math.max(1.05, wall.length - 0.7);
  const width = Math.min(maxWidth, rng.float(kind === 'symbol' ? 0.8 : 1.35, kind === 'direction' ? 3.5 : 4.2));
  const height = kind === 'symbol'
    ? rng.float(0.62, 1.35)
    : kind === 'direction'
      ? rng.float(0.48, 0.95)
      : rng.float(0.45, 1.15);
  const halfAvailable = Math.max(0, (wall.length - width) * 0.5 - 0.12);
  const wallAlong = wall.orientation === 'x' ? wall.x : wall.z;
  const centerY = Math.min(
    wall.bottom + wall.height - height * 0.5 - 0.22,
    rng.float(0.72 + height * 0.5, 1.48 + height * 0.5),
  );
  return {
    id: `graffiti-${index}-${wall.id}`,
    wall,
    side: facingSide(plan, wall, rng.fork('side')),
    along: wallAlong + rng.float(-halfAvailable, halfAvailable),
    centerY,
    width,
    height,
    kind,
    lines: [],
    ink: rng.pick(inkPalette(plan)),
    opacity: rng.float(0.58, 0.92),
    seed: rng.seed,
  };
};

const findDirectionWall = (
  candidates: readonly WallSegment[],
  usedWallIds: ReadonlySet<string>,
  target: { x: number; z: number },
  rng: SeededRandom,
): WallSegment | undefined => {
  const nearby = candidates
    .filter((wall) => !usedWallIds.has(wall.id))
    .map((wall) => ({ wall, distance: wallCenterDistance(wall, target) }))
    .filter(({ distance }) => distance >= 3.5 && distance <= 34)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 12);
  if (nearby.length === 0) return undefined;
  return rng.pick(nearby.slice(0, Math.min(5, nearby.length))).wall;
};

/**
 * Selects sparse wall markings without mutating the plan. The selection is
 * deterministic, so worker streaming and chunk remounts never reshuffle them.
 */
export const selectWallGraffiti = (plan: WorldPlan): WallGraffitiPlacement[] => {
  const rng = new SeededRandom(`${plan.seed}::wall-graffiti:v3`);
  const candidates = eligibleGraffitiWalls(plan);
  if (candidates.length === 0) return [];
  const placements: WallGraffitiPlacement[] = [];
  const usedWallIds = new Set<string>();
  const targets = plan.features.filter(
    (feature): feature is GridPitFeature | StairSocketFeature =>
      feature.kind === 'grid-pit' ||
      (feature.kind === 'stair-socket' && !feature.inherited && (feature.baseY ?? 0) === 0),
  );

  for (const feature of targets) {
    const targetRng = rng.fork(`target:${feature.id}`);
    const chance = feature.kind === 'stair-socket' ? 0.24 : 0.17;
    if (!targetRng.chance(chance)) continue;
    const center = targetCenter(feature);
    const seriesCount = targetRng.chance(0.28) ? 2 : 1;
    for (let series = 0; series < seriesCount; series += 1) {
      const wall = findDirectionWall(candidates, usedWallIds, center, targetRng.fork(`wall:${series}`));
      if (!wall) break;
      const placement = makePlacement(
        plan,
        wall,
        targetRng.fork(`placement:${series}`),
        placements.length,
        'direction',
      );
      const wallAlong = wall.orientation === 'x' ? wall.x : wall.z;
      const targetAlong = wall.orientation === 'x' ? center.x : center.z;
      const minimumAlong = wallAlong - wall.length * 0.5 + placement.width * 0.5 + 0.12;
      const maximumAlong = wallAlong + wall.length * 0.5 - placement.width * 0.5 - 0.12;
      if (targetAlong <= minimumAlong) {
        placement.along = minimumAlong;
      } else if (targetAlong >= maximumAlong) {
        placement.along = maximumAlong;
      } else {
        const guideOffset = targetRng.float(
          Math.min(1.2, wall.length * 0.2),
          Math.max(1.2, Math.min(8.5, wall.length * 0.34)),
        );
        const guideCandidates = [targetAlong - guideOffset, targetAlong + guideOffset]
          .filter((value) => value >= minimumAlong && value <= maximumAlong);
        placement.along = guideCandidates.length > 0
          ? targetRng.pick(guideCandidates)
          : THREE.MathUtils.clamp(placement.along, minimumAlong, maximumAlong);
      }
      const right = localRight(wall, placement.side);
      const toward = {
        x: center.x - (wall.orientation === 'x' ? placement.along : wall.x),
        z: center.z - (wall.orientation === 'z' ? placement.along : wall.z),
      };
      placement.arrowDirection = toward.x * right.x + toward.z * right.z >= 0 ? 1 : -1;
      placement.arrowCount = targetRng.int(2, 5);
      placement.targetKind = feature.kind === 'stair-socket' ? 'stairs' : 'pitfall';
      placement.targetFeatureId = feature.id;
      placement.lines = feature.kind === 'stair-socket'
        ? [targetRng.pick(['UPSTAIRS', 'STAIRS', 'NEXT FLOOR', 'THIS WAY', 'UP'])]
        : [targetRng.pick(['DOWN', 'THE HOLE', 'JUMP ?', 'LOWER LEVEL', 'THEY ARE DOWN THERE'])];
      placements.push(placement);
      usedWallIds.add(wall.id);
    }
  }

  const messageDoors = plan.features.filter(
    (feature): feature is InteractiveDoorFeature =>
      feature.kind === 'interactive-door' && feature.content === 'message',
  );
  const doorMessages = [
    'YOU OPENED THE WRONG DOOR',
    'THIS ROOM WAS WAITING',
    'LEAVE IT OPEN',
    'IT CAME THROUGH HERE',
    'NOTHING WAS INSIDE BEFORE',
    'THE DOOR REMEMBERS YOU',
  ] as const;
  for (const door of messageDoors) {
    const room = plan.rooms.find((candidate) => candidate.id === door.targetRoomId);
    if (!room) continue;
    const roomCenter = rectCenter(room.bounds);
    const roomWalls = candidates
      .filter((wall) => {
        if (usedWallIds.has(wall.id)) return false;
        if (wall.orientation === 'x') {
          return (
            Math.abs(wall.z - room.bounds.minZ) < 0.38 ||
            Math.abs(wall.z - room.bounds.maxZ) < 0.38
          );
        }
        return (
          Math.abs(wall.x - room.bounds.minX) < 0.38 ||
          Math.abs(wall.x - room.bounds.maxX) < 0.38
        );
      })
      .sort(
        (left, right) =>
          wallCenterDistance(right, door.position) -
          wallCenterDistance(left, door.position),
      )
      .slice(0, 8);
    if (roomWalls.length === 0) continue;
    const messageRng = rng.fork(`door-message:${door.id}`);
    const wall = messageRng.pick(roomWalls);
    const placement = makePlacement(
      plan,
      wall,
      messageRng.fork('placement'),
      placements.length,
      'message',
    );
    const normalDelta = wall.orientation === 'x'
      ? roomCenter.z - wall.z
      : roomCenter.x - wall.x;
    placement.side = normalDelta >= 0 ? 1 : -1;
    placement.lines = [messageRng.pick(doorMessages)];
    placements.push(placement);
    usedWallIds.add(wall.id);
  }

  const ambientCount = Math.min(
    candidates.length,
    rng.weighted([
      { value: 0, weight: 0.15 },
      { value: 1, weight: 0.27 },
      { value: 2, weight: 0.26 },
      { value: 3, weight: 0.18 },
      { value: 4, weight: 0.09 },
      { value: 5, weight: 0.04 },
      { value: 6, weight: 0.01 },
    ]),
  );
  const ambientWalls = rng.shuffle(candidates.filter((wall) => !usedWallIds.has(wall.id)));
  for (const wall of ambientWalls.slice(0, ambientCount)) {
    const markRng = rng.fork(`ambient:${wall.id}`);
    const kind = markRng.weighted([
      { value: 'message' as const, weight: 0.56 },
      { value: 'symbol' as const, weight: 0.44 },
    ]);
    const placement = makePlacement(plan, wall, markRng, placements.length, kind);
    if (kind === 'message') {
      placement.lines = createMessage(markRng.fork('message'));
    } else {
      placement.symbol = markRng.pick(SYMBOLS);
      placement.lines = placement.symbol === 'tallies'
        ? [String(markRng.int(5, 34))]
        : [];
    }
    placements.push(placement);
    usedWallIds.add(wall.id);
  }
  return placements;
};

const wobble = (rng: SeededRandom, amount: number): number =>
  rng.float(-amount, amount);

const strokePolyline = (
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  rng: SeededRandom,
  jitter: number,
): void => {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0]![0] + wobble(rng, jitter), points[0]![1] + wobble(rng, jitter));
  for (const [x, y] of points.slice(1)) {
    context.lineTo(x + wobble(rng, jitter), y + wobble(rng, jitter));
  }
  context.stroke();
};

const drawIrregularEllipse = (
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  rng: SeededRandom,
): void => {
  const points: Array<readonly [number, number]> = [];
  for (let index = 0; index <= 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    const radial = 1 + wobble(rng, 0.055);
    points.push([
      centerX + Math.cos(angle) * radiusX * radial,
      centerY + Math.sin(angle) * radiusY * radial,
    ]);
  }
  strokePolyline(context, points, rng, 1.4);
};

const drawTextLine = (
  context: CanvasRenderingContext2D,
  line: string,
  centerX: number,
  baseline: number,
  maxWidth: number,
  size: number,
  rng: SeededRandom,
): void => {
  const family = rng.pick(FONT_FAMILIES);
  const weight = rng.pick(['400', '500', '600', '700']);
  context.font = `${weight} ${size}px ${family}`;
  const characters = [...line];
  const tracking = rng.float(-2, size * 0.08);
  const widths = characters.map((character) => context.measureText(character).width);
  const naturalWidth = widths.reduce((sum, width) => sum + width, 0) +
    tracking * Math.max(0, characters.length - 1);
  const scale = Math.min(1, maxWidth / Math.max(1, naturalWidth));
  let cursor = centerX - naturalWidth * scale * 0.5;
  const globalSlant = rng.float(-0.045, 0.045);
  for (const [index, character] of characters.entries()) {
    const width = widths[index]!;
    const characterRng = rng.fork(`char:${index}:${character}`);
    context.save();
    context.translate(
      cursor + width * scale * 0.5,
      baseline + wobble(characterRng, size * 0.075),
    );
    context.rotate(globalSlant + wobble(characterRng, 0.075));
    context.scale(
      scale * characterRng.float(0.87, 1.12),
      characterRng.float(0.9, 1.1),
    );
    const passes = characterRng.chance(0.34) ? 2 : 1;
    for (let pass = 0; pass < passes; pass += 1) {
      context.fillText(
        character,
        -width * 0.5 + wobble(characterRng, 1.6),
        wobble(characterRng, 1.4),
      );
    }
    context.restore();
    cursor += (width + tracking) * scale;
  }
};

const drawMessage = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  placement: WallGraffitiPlacement,
  rng: SeededRandom,
): void => {
  const lines = placement.lines.length > 0 ? placement.lines : ['?'];
  const lineHeight = canvas.height / (lines.length + 0.45);
  const size = Math.min(
    lineHeight * rng.float(0.62, 0.84),
    canvas.width * (lines.length === 1 ? 0.22 : 0.18),
  );
  for (const [index, line] of lines.entries()) {
    drawTextLine(
      context,
      rng.chance(0.16) ? line.toLowerCase() : line,
      canvas.width * 0.5,
      lineHeight * (index + 0.86),
      canvas.width * 0.88,
      size * rng.float(0.88, 1.08),
      rng.fork(`line:${index}`),
    );
  }
  if (rng.chance(0.22)) {
    const y = canvas.height * rng.float(0.77, 0.9);
    strokePolyline(
      context,
      [
        [canvas.width * 0.12, y],
        [canvas.width * 0.42, y + wobble(rng, 8)],
        [canvas.width * 0.88, y + wobble(rng, 10)],
      ],
      rng,
      2.5,
    );
  }
  if (rng.chance(0.08)) {
    strokePolyline(
      context,
      [
        [canvas.width * 0.18, canvas.height * 0.18],
        [canvas.width * 0.82, canvas.height * 0.82],
      ],
      rng,
      3,
    );
  }
};

const drawArrow = (
  context: CanvasRenderingContext2D,
  startX: number,
  endX: number,
  y: number,
  rng: SeededRandom,
): void => {
  const direction = Math.sign(endX - startX) || 1;
  strokePolyline(
    context,
    [
      [startX, y + wobble(rng, 5)],
      [(startX + endX) * 0.55, y + wobble(rng, 9)],
      [endX, y + wobble(rng, 5)],
    ],
    rng,
    2.2,
  );
  const head = Math.abs(endX - startX) * rng.float(0.2, 0.3);
  strokePolyline(
    context,
    [
      [endX - direction * head, y - head * 0.62],
      [endX, y],
      [endX - direction * head, y + head * 0.62],
    ],
    rng,
    2,
  );
};

const drawDirection = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  placement: WallGraffitiPlacement,
  rng: SeededRandom,
): void => {
  const count = placement.arrowCount ?? 3;
  const direction = placement.arrowDirection ?? 1;
  const margin = canvas.width * 0.07;
  const segment = (canvas.width - margin * 2) / count;
  const arrowY = canvas.height * (placement.lines[0] ? 0.62 : 0.5);
  for (let index = 0; index < count; index += 1) {
    const left = margin + segment * index + segment * 0.08;
    const right = margin + segment * (index + 1) - segment * 0.08;
    drawArrow(
      context,
      direction > 0 ? left : right,
      direction > 0 ? right : left,
      arrowY + wobble(rng, canvas.height * 0.06),
      rng.fork(`arrow:${index}`),
    );
  }
  if (placement.lines[0]) {
    drawTextLine(
      context,
      placement.lines[0],
      canvas.width * 0.5,
      canvas.height * 0.31,
      canvas.width * 0.76,
      canvas.height * 0.25,
      rng.fork('label'),
    );
  }
};

const drawSymbol = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  placement: WallGraffitiPlacement,
  rng: SeededRandom,
): void => {
  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.5;
  const radius = Math.min(canvas.width, canvas.height) * 0.36;
  switch (placement.symbol) {
    case 'smile':
    case 'sad': {
      drawIrregularEllipse(context, centerX, centerY, radius, radius * 0.92, rng);
      for (const eyeOffset of [-0.36, 0.36]) {
        strokePolyline(
          context,
          [
            [centerX + radius * eyeOffset, centerY - radius * 0.3],
            [centerX + radius * eyeOffset + wobble(rng, 3), centerY - radius * 0.08],
          ],
          rng,
          1.5,
        );
      }
      context.beginPath();
      context.moveTo(centerX - radius * 0.5, centerY + radius * 0.25);
      const smile = placement.symbol === 'smile';
      context.quadraticCurveTo(
        centerX,
        centerY + radius * (smile ? 0.75 : -0.15),
        centerX + radius * 0.5,
        centerY + radius * 0.25,
      );
      context.stroke();
      break;
    }
    case 'broken-heart': {
      const left = centerX - radius * 0.78;
      const right = centerX + radius * 0.78;
      const top = centerY - radius * 0.36;
      const point = centerY + radius * 0.9;
      strokePolyline(
        context,
        [
          [centerX, point],
          [left, centerY + radius * 0.12],
          [left, top],
          [centerX - radius * 0.38, centerY - radius * 0.76],
          [centerX, centerY - radius * 0.3],
          [centerX + radius * 0.38, centerY - radius * 0.76],
          [right, top],
          [right, centerY + radius * 0.12],
          [centerX, point],
        ],
        rng,
        2,
      );
      strokePolyline(
        context,
        [
          [centerX, centerY - radius * 0.42],
          [centerX - radius * 0.14, centerY - radius * 0.08],
          [centerX + radius * 0.1, centerY + radius * 0.16],
          [centerX - radius * 0.06, centerY + radius * 0.52],
        ],
        rng.fork('heart-crack'),
        1.4,
      );
      break;
    }
    case 'eye': {
      context.beginPath();
      context.moveTo(centerX - radius, centerY);
      context.quadraticCurveTo(centerX, centerY - radius * 0.8, centerX + radius, centerY);
      context.quadraticCurveTo(centerX, centerY + radius * 0.8, centerX - radius, centerY);
      context.stroke();
      drawIrregularEllipse(context, centerX, centerY, radius * 0.28, radius * 0.32, rng);
      break;
    }
    case 'eyes': {
      for (const [index, offset] of [-0.48, 0, 0.48].entries()) {
        const eyeRng = rng.fork(`eye:${index}`);
        const x = centerX + radius * offset;
        const y = centerY + wobble(eyeRng, radius * 0.16);
        const eyeRadius = radius * (index === 1 ? 0.31 : 0.24);
        context.beginPath();
        context.moveTo(x - eyeRadius, y);
        context.quadraticCurveTo(x, y - eyeRadius * 0.72, x + eyeRadius, y);
        context.quadraticCurveTo(x, y + eyeRadius * 0.72, x - eyeRadius, y);
        context.stroke();
        drawIrregularEllipse(context, x, y, eyeRadius * 0.22, eyeRadius * 0.3, eyeRng);
      }
      break;
    }
    case 'spiral': {
      const points: Array<readonly [number, number]> = [];
      for (let index = 0; index < 70; index += 1) {
        const progress = index / 69;
        const angle = progress * Math.PI * rng.float(5.5, 8);
        points.push([
          centerX + Math.cos(angle) * radius * progress,
          centerY + Math.sin(angle) * radius * progress,
        ]);
      }
      strokePolyline(context, points, rng, 1.6);
      break;
    }
    case 'tallies': {
      const count = Number(placement.lines[0] ?? 12);
      const columns = Math.min(9, Math.ceil(count / 5));
      const spacing = (radius * 1.7) / Math.max(1, columns);
      for (let index = 0; index < count; index += 1) {
        const group = Math.floor(index / 5);
        const within = index % 5;
        const left = centerX - (columns - 1) * spacing * 0.5 + group * spacing;
        if (within < 4) {
          strokePolyline(
            context,
            [
              [left + within * spacing * 0.15, centerY - radius * 0.55],
              [left + within * spacing * 0.15 + wobble(rng, 3), centerY + radius * 0.55],
            ],
            rng,
            1.5,
          );
        } else {
          strokePolyline(
            context,
            [
              [left - spacing * 0.06, centerY + radius * 0.42],
              [left + spacing * 0.52, centerY - radius * 0.42],
            ],
            rng,
            1.5,
          );
        }
      }
      break;
    }
    case 'teeth': {
      const left = centerX - radius * 0.82;
      const right = centerX + radius * 0.82;
      const top = centerY - radius * 0.5;
      const bottom = centerY + radius * 0.58;
      strokePolyline(
        context,
        [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]],
        rng,
        1.8,
      );
      for (let tooth = 0; tooth < 7; tooth += 1) {
        const toothRng = rng.fork(`tooth:${tooth}`);
        const x = THREE.MathUtils.lerp(left + radius * 0.08, right - radius * 0.08, tooth / 6);
        const length = radius * toothRng.float(0.52, 0.92);
        strokePolyline(
          context,
          [[x, top], [x + wobble(toothRng, 3), top + length]],
          toothRng,
          1.2,
        );
      }
      break;
    }
    case 'crown': {
      strokePolyline(
        context,
        [
          [centerX - radius * 0.86, centerY + radius * 0.62],
          [centerX - radius * 0.72, centerY - radius * 0.54],
          [centerX - radius * 0.24, centerY + radius * 0.06],
          [centerX, centerY - radius * 0.8],
          [centerX + radius * 0.3, centerY + radius * 0.05],
          [centerX + radius * 0.77, centerY - radius * 0.46],
          [centerX + radius * 0.88, centerY + radius * 0.62],
          [centerX - radius * 0.86, centerY + radius * 0.62],
        ],
        rng,
        2,
      );
      break;
    }
    case 'web': {
      const rays = 8;
      for (let ray = 0; ray < rays; ray += 1) {
        const angle = (ray / rays) * Math.PI * 2 + wobble(rng, 0.08);
        strokePolyline(
          context,
          [
            [centerX, centerY],
            [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius],
          ],
          rng.fork(`web-ray:${ray}`),
          1.1,
        );
      }
      for (const scale of [0.32, 0.58, 0.84]) {
        const ring: Array<readonly [number, number]> = [];
        for (let point = 0; point <= rays; point += 1) {
          const angle = (point / rays) * Math.PI * 2;
          ring.push([
            centerX + Math.cos(angle) * radius * scale,
            centerY + Math.sin(angle) * radius * scale,
          ]);
        }
        strokePolyline(context, ring, rng.fork(`web-ring:${scale}`), 1.3);
      }
      break;
    }
    case 'hand': {
      const palmY = centerY + radius * 0.25;
      drawIrregularEllipse(
        context,
        centerX,
        palmY,
        radius * 0.46,
        radius * 0.56,
        rng,
      );
      const fingerOffsets = [-0.62, -0.31, 0, 0.31, 0.62];
      for (const [index, offset] of fingerOffsets.entries()) {
        const fingerRng = rng.fork(`finger:${index}`);
        const rootX = centerX + radius * offset * 0.58;
        const rootY = palmY - radius * 0.42;
        const tipX = centerX + radius * offset * fingerRng.float(0.78, 1.02);
        const tipY = centerY - radius * fingerRng.float(
          index === 2 ? 1.18 : 0.82,
          index === 2 ? 1.34 : 1.14,
        );
        strokePolyline(
          context,
          [
            [rootX - radius * 0.07, rootY],
            [tipX - radius * 0.055, tipY],
            [tipX + radius * 0.055, tipY + wobble(fingerRng, 3)],
            [rootX + radius * 0.07, rootY],
          ],
          fingerRng,
          1.5,
        );
      }
      strokePolyline(
        context,
        [
          [centerX - radius * 0.38, palmY - radius * 0.08],
          [centerX - radius * 0.88, centerY],
          [centerX - radius * 0.72, centerY + radius * 0.22],
          [centerX - radius * 0.35, palmY + radius * 0.18],
        ],
        rng.fork('thumb'),
        1.8,
      );
      break;
    }
    case 'skull': {
      drawIrregularEllipse(
        context,
        centerX,
        centerY - radius * 0.12,
        radius * 0.78,
        radius * 0.82,
        rng,
      );
      for (const side of [-1, 1] as const) {
        drawIrregularEllipse(
          context,
          centerX + side * radius * 0.3,
          centerY - radius * 0.25,
          radius * 0.2,
          radius * 0.24,
          rng.fork(`skull-eye:${side}`),
        );
      }
      strokePolyline(
        context,
        [
          [centerX, centerY - radius * 0.08],
          [centerX - radius * 0.11, centerY + radius * 0.16],
          [centerX + radius * 0.11, centerY + radius * 0.16],
          [centerX, centerY - radius * 0.08],
        ],
        rng.fork('skull-nose'),
        1.3,
      );
      strokePolyline(
        context,
        [
          [centerX - radius * 0.46, centerY + radius * 0.42],
          [centerX - radius * 0.34, centerY + radius * 0.78],
          [centerX + radius * 0.34, centerY + radius * 0.78],
          [centerX + radius * 0.46, centerY + radius * 0.42],
        ],
        rng.fork('skull-jaw'),
        1.8,
      );
      for (let tooth = -2; tooth <= 2; tooth += 1) {
        strokePolyline(
          context,
          [
            [centerX + tooth * radius * 0.13, centerY + radius * 0.48],
            [centerX + tooth * radius * 0.12, centerY + radius * 0.75],
          ],
          rng.fork(`tooth:${tooth}`),
          1,
        );
      }
      break;
    }
    case 'house': {
      const left = centerX - radius * 0.72;
      const right = centerX + radius * 0.72;
      const roofY = centerY - radius * 0.88;
      const eaveY = centerY - radius * 0.24;
      const groundY = centerY + radius * 0.72;
      strokePolyline(
        context,
        [
          [left - radius * 0.12, eaveY],
          [centerX, roofY],
          [right + radius * 0.12, eaveY],
          [right, eaveY],
          [right, groundY],
          [left, groundY],
          [left, eaveY],
          [centerX, roofY],
        ],
        rng,
        2.3,
      );
      for (const side of [-1, 1] as const) {
        const windowX = centerX + side * radius * 0.36;
        drawIrregularEllipse(
          context,
          windowX,
          centerY + radius * 0.08,
          radius * 0.16,
          radius * 0.2,
          rng.fork(`window:${side}`),
        );
        strokePolyline(
          context,
          [
            [windowX - radius * 0.13, centerY - radius * 0.08],
            [windowX + radius * 0.13, centerY + radius * 0.24],
          ],
          rng.fork(`window-cross:${side}`),
          1.2,
        );
      }
      strokePolyline(
        context,
        [
          [centerX - radius * 0.16, groundY],
          [centerX - radius * 0.16, centerY + radius * 0.25],
          [centerX + radius * 0.16, centerY + radius * 0.25],
          [centerX + radius * 0.16, groundY],
        ],
        rng.fork('home-door'),
        1.5,
      );
      drawTextLine(
        context,
        'HOME',
        centerX,
        Math.min(canvas.height * 0.96, groundY + radius * 0.28),
        canvas.width * 0.7,
        Math.max(20, radius * 0.36),
        rng.fork('home-label'),
      );
      break;
    }
    case 'stick-figure': {
      drawIrregularEllipse(
        context,
        centerX,
        centerY - radius * 0.66,
        radius * 0.22,
        radius * 0.25,
        rng,
      );
      strokePolyline(
        context,
        [
          [centerX, centerY - radius * 0.4],
          [centerX + wobble(rng, 4), centerY + radius * 0.3],
        ],
        rng,
        1.8,
      );
      for (const side of [-1, 1] as const) {
        strokePolyline(
          context,
          [
            [centerX, centerY - radius * 0.12],
            [centerX + side * radius * 0.68, centerY + wobble(rng, radius * 0.16)],
          ],
          rng.fork(`arm:${side}`),
          1.6,
        );
        strokePolyline(
          context,
          [
            [centerX, centerY + radius * 0.28],
            [centerX + side * radius * 0.54, centerY + radius * 0.92],
          ],
          rng.fork(`leg:${side}`),
          1.6,
        );
      }
      break;
    }
    case 'doll': {
      drawIrregularEllipse(
        context,
        centerX,
        centerY - radius * 0.52,
        radius * 0.31,
        radius * 0.34,
        rng,
      );
      strokePolyline(
        context,
        [
          [centerX, centerY - radius * 0.18],
          [centerX - radius * 0.42, centerY + radius * 0.7],
          [centerX + radius * 0.42, centerY + radius * 0.7],
          [centerX, centerY - radius * 0.18],
        ],
        rng.fork('doll-body'),
        1.8,
      );
      for (const side of [-1, 1] as const) {
        strokePolyline(
          context,
          [
            [centerX + side * radius * 0.24, centerY + radius * 0.12],
            [centerX + side * radius * 0.82, centerY + radius * 0.36],
          ],
          rng.fork(`doll-arm:${side}`),
          1.5,
        );
      }
      for (const y of [-0.54, -0.43, -0.32]) {
        strokePolyline(
          context,
          [
            [centerX - radius * 0.18, centerY + radius * y],
            [centerX + radius * 0.18, centerY + radius * (y + 0.04)],
          ],
          rng.fork(`doll-stitch:${y}`),
          1,
        );
      }
      break;
    }
    case 'door': {
      strokePolyline(
        context,
        [
          [centerX - radius * 0.62, centerY + radius],
          [centerX - radius * 0.62, centerY - radius],
          [centerX + radius * 0.62, centerY - radius],
          [centerX + radius * 0.62, centerY + radius],
        ],
        rng,
        2.2,
      );
      drawIrregularEllipse(
        context,
        centerX + radius * 0.38,
        centerY + radius * 0.08,
        radius * 0.065,
        radius * 0.065,
        rng,
      );
      break;
    }
    case 'cross':
    default:
      strokePolyline(
        context,
        [
          [centerX - radius * 0.82, centerY - radius * 0.82],
          [centerX + radius * 0.82, centerY + radius * 0.82],
        ],
        rng,
        2.5,
      );
      strokePolyline(
        context,
        [
          [centerX + radius * 0.82, centerY - radius * 0.82],
          [centerX - radius * 0.82, centerY + radius * 0.82],
        ],
        rng,
        2.5,
      );
      break;
  }
};

const drawMarginScribbles = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rng: SeededRandom,
): void => {
  const count = rng.int(1, 3);
  for (let index = 0; index < count; index += 1) {
    const doodleRng = rng.fork(`margin:${index}`);
    const x = doodleRng.chance(0.5)
      ? doodleRng.float(canvas.width * 0.06, canvas.width * 0.2)
      : doodleRng.float(canvas.width * 0.8, canvas.width * 0.94);
    const y = doodleRng.pick([
      doodleRng.float(canvas.height * 0.08, canvas.height * 0.24),
      doodleRng.float(canvas.height * 0.76, canvas.height * 0.92),
    ]);
    const radius = doodleRng.float(8, 26);
    const kind = doodleRng.pick(['cross', 'orbit', 'scratch', 'star'] as const);
    if (kind === 'cross') {
      strokePolyline(context, [[x - radius, y - radius], [x + radius, y + radius]], doodleRng, 1.3);
      strokePolyline(context, [[x + radius, y - radius], [x - radius, y + radius]], doodleRng, 1.3);
    } else if (kind === 'orbit') {
      drawIrregularEllipse(context, x, y, radius, radius * doodleRng.float(0.42, 0.78), doodleRng);
      strokePolyline(
        context,
        [[x - radius * 1.15, y + radius * 0.2], [x + radius * 1.2, y - radius * 0.16]],
        doodleRng,
        1.2,
      );
    } else if (kind === 'scratch') {
      for (let scratch = 0; scratch < 3; scratch += 1) {
        const offset = (scratch - 1) * radius * 0.33;
        strokePolyline(
          context,
          [[x - radius, y + offset - radius * 0.48], [x + radius, y + offset + radius * 0.48]],
          doodleRng.fork(`scratch:${scratch}`),
          1.1,
        );
      }
    } else {
      const points: Array<readonly [number, number]> = [];
      for (let point = 0; point <= 8; point += 1) {
        const angle = -Math.PI * 0.5 + point * Math.PI * 0.5;
        const distance = point % 2 === 0 ? radius : radius * 0.42;
        points.push([x + Math.cos(angle) * distance, y + Math.sin(angle) * distance]);
      }
      strokePolyline(context, points, doodleRng, 1.2);
    }
  }
};

export const createGraffitiCanvas = (
  placement: WallGraffitiPlacement,
): HTMLCanvasElement | null => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round(THREE.MathUtils.clamp(
    canvas.width * (placement.height / placement.width),
    180,
    420,
  ));
  const context = canvas.getContext('2d');
  if (!context) return null;
  const rng = new SeededRandom(`${placement.seed}::raster`);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = placement.ink;
  context.strokeStyle = placement.ink;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = rng.float(3.2, 9.5);
  context.globalAlpha = rng.float(0.72, 0.96);
  if (placement.kind === 'direction') {
    drawDirection(context, canvas, placement, rng);
  } else if (placement.kind === 'symbol') {
    drawSymbol(context, canvas, placement, rng);
  } else {
    drawMessage(context, canvas, placement, rng);
  }

  if (rng.chance(placement.kind === 'message' ? 0.68 : 0.52)) {
    drawMarginScribbles(context, canvas, rng.fork('margin-scribbles'));
  }
  if (rng.chance(0.23)) {
    const dripCount = rng.int(1, 4);
    for (let index = 0; index < dripCount; index += 1) {
      const x = rng.float(canvas.width * 0.16, canvas.width * 0.84);
      const startY = rng.float(canvas.height * 0.56, canvas.height * 0.82);
      strokePolyline(
        context,
        [
          [x, startY],
          [x + wobble(rng, 3), Math.min(canvas.height * 0.98, startY + rng.float(18, 74))],
        ],
        rng,
        1.2,
      );
    }
  }
  return canvas;
};

export const createGraffitiMesh = (
  placement: WallGraffitiPlacement,
): {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  texture: THREE.CanvasTexture;
} | null => {
  const canvas = createGraffitiCanvas(placement);
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `handwritten-${placement.id}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: placement.opacity,
    alphaTest: 0.025,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  material.name = `graffiti-ink-${placement.kind}`;
  const geometry = new THREE.PlaneGeometry(placement.width, placement.height);
  const mesh = new THREE.Mesh(geometry, material);
  const surfaceOffset = placement.wall.thickness * 0.5 + 0.006;
  if (placement.wall.orientation === 'x') {
    mesh.position.set(
      placement.along,
      placement.centerY,
      placement.wall.z + placement.side * surfaceOffset,
    );
    mesh.rotation.y = placement.side > 0 ? 0 : Math.PI;
  } else {
    mesh.position.set(
      placement.wall.x + placement.side * surfaceOffset,
      placement.centerY,
      placement.along,
    );
    mesh.rotation.y = placement.side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
  }
  const styleRng = new SeededRandom(`${placement.seed}::plane`);
  mesh.rotation.z = styleRng.float(-0.075, 0.075);
  mesh.name = `${placement.kind}-wall-graffiti`;
  mesh.userData.graffitiId = placement.id;
  mesh.userData.targetKind = placement.targetKind;
  mesh.userData.targetFeatureId = placement.targetFeatureId;
  mesh.renderOrder = 14;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, texture };
};
