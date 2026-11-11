/** Synthetic mazes for the hunter tests: carved rectangles in solid rock, 0.5 m cells. */
export interface Maze {
  readonly rows: string[];
  /** The player's route (world metres), corner by corner. */
  readonly route: readonly { x: number; z: number }[];
}

export const CELL = 0.5;

export const carve = (width: number, height: number, rects: readonly [number, number, number, number][]): string[] => {
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => '#'));
  for (const [x0, z0, x1, z1] of rects) {
    for (let j = Math.floor(z0 / CELL); j < Math.ceil(z1 / CELL); j += 1) {
      for (let i = Math.floor(x0 / CELL); i < Math.ceil(x1 / CELL); i += 1) {
        if (grid[j]?.[i] !== undefined) grid[j]![i] = '.';
      }
    }
  }
  return grid.map((row) => row.join(''));
};

/** A staircase going east and north by `step` metres, corridors 2 m wide. */
export const staircase = (steps: number, step = 6): Maze => {
  const rects: [number, number, number, number][] = [];
  const route: { x: number; z: number }[] = [];
  let x = 2, z = 2 + steps * step;
  route.push({ x: x + 1, z: z + 1 });
  for (let index = 0; index < steps; index += 1) {
    rects.push([x, z, x + step + 2, z + 2]);
    route.push({ x: x + step + 1, z: z + 1 });
    rects.push([x + step, z - step, x + step + 2, z + 2]);
    route.push({ x: x + step + 1, z: z - step + 1 });
    x += step; z -= step;
  }
  return { rows: carve(Math.ceil((x + 6) / CELL), Math.ceil((2 + steps * step + 6) / CELL), rects), route };
};

/** A square wave: east, north, east, south… corridors 2 m wide. */
export const squareWave = (teeth: number, run = 5, rise = 7): Maze => {
  const rects: [number, number, number, number][] = [];
  const route: { x: number; z: number }[] = [];
  let x = 2;
  const low = 2 + rise, high = 2;
  let z = low;
  route.push({ x: x + 1, z: z + 1 });
  for (let index = 0; index < teeth; index += 1) {
    rects.push([x, z, x + run + 2, z + 2]);
    x += run;
    route.push({ x: x + 1, z: z + 1 });
    const next = z === low ? high : low;
    rects.push([x, Math.min(z, next), x + 2, Math.max(z, next) + 2]);
    z = next;
    route.push({ x: x + 1, z: z + 1 });
  }
  rects.push([x, z, x + run + 2, z + 2]);
  route.push({ x: x + run + 1, z: z + 1 });
  return { rows: carve(Math.ceil((x + run + 6) / CELL), Math.ceil((low + 6) / CELL), rects), route };
};

/** Rooms of 6 × 6 m joined by 1 m doors, entered and left on different walls. */
export const rooms = (count: number): Maze => {
  const rects: [number, number, number, number][] = [];
  const route: { x: number; z: number }[] = [];
  const size = 6, wall = 0.5;
  const top = 4 + Math.ceil(count / 2) * (size + wall);
  let x = 2, z = top;
  route.push({ x: x + 1, z: z + 1 });
  for (let index = 0; index < count; index += 1) {
    rects.push([x, z, x + size, z + size]);
    // Leave east on even rooms, north on odd ones, through a 1 m door near a corner.
    if (index % 2 === 0) {
      rects.push([x + size, z + 4, x + size + wall, z + 5]);
      route.push({ x: x + size - 0.75, z: z + 4.5 });
      route.push({ x: x + size + wall + 0.75, z: z + 4.5 });
      x += size + wall;
    } else {
      rects.push([x + 1, z - wall, x + 2, z]);
      route.push({ x: x + 1.5, z: z + 0.75 });
      route.push({ x: x + 1.5, z: z - wall - 0.75 });
      z -= size + wall;
    }
  }
  rects.push([x, z, x + size, z + size]);
  route.push({ x: x + size - 1, z: z + 1 });
  return { rows: carve(Math.ceil((x + size + 4) / CELL), Math.ceil((top + size + 4) / CELL), rects), route };
};

/** Straight line of sight on the maze cells (walls are '#'). */
export const mazeSight = (rows: readonly string[], ax: number, az: number, bx: number, bz: number): boolean => {
  const length = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(length / (CELL * 0.25)));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps, i = Math.floor((ax + (bx - ax) * t) / CELL), j = Math.floor((az + (bz - az) * t) / CELL);
    if (rows[j]?.[i] !== '.') return false;
  }
  return true;
};

/** A runner's line: every inner corner cut `cut` metres before and after it. */
export const racingLine = (route: readonly { x: number; z: number }[], cut = 1): { x: number; z: number }[] => {
  const line = [route[0]!];
  for (let index = 1; index < route.length - 1; index += 1) {
    const a = route[index - 1]!, b = route[index]!, c = route[index + 1]!;
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z);
    const before = Math.min(cut, ab / 2), after = Math.min(cut, bc / 2);
    line.push({ x: b.x - (b.x - a.x) / ab * before, z: b.z - (b.z - a.z) / ab * before });
    line.push({ x: b.x + (c.x - b.x) / bc * after, z: b.z + (c.z - b.z) / bc * after });
  }
  line.push(route[route.length - 1]!);
  return line;
};

/** Walks a polyline: position after `distance` metres along it. */
export const alongRoute = (route: readonly { x: number; z: number }[], distance: number, out: { x: number; z: number; corner: number }): boolean => {
  let left = distance;
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1]!, b = route[index]!, length = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= length) {
      out.x = a.x + (b.x - a.x) * (left / length); out.z = a.z + (b.z - a.z) * (left / length);
      out.corner = Math.min(left, length - left);
      return true;
    }
    left -= length;
  }
  const last = route[route.length - 1]!;
  out.x = last.x; out.z = last.z; out.corner = 0;
  return false;
};

export const routeLength = (route: readonly { x: number; z: number }[]): number => {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) total += Math.hypot(route[index]!.x - route[index - 1]!.x, route[index]!.z - route[index - 1]!.z);
  return total;
};
