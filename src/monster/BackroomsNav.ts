/**
 * Local navigation for the Backrooms hunter: a square window of cells (0.5 m,
 * 64 m wide by default), retaining up to six walkable surfaces per column.
 * Adjacent probes use the actual supporting height, so stairs connect floors.
 * Each surface is
 * probed once (lazily, under a budget) through `NavCellProbe` — Rapier in the
 * game, a synthetic maze in tests — and cached until the window moves away or
 * the world changes. A Dijkstra field (8-neighbourhood, metres) is computed
 * toward a target; the hunter descends it and pulls the path straight with a
 * clearance-checked line test, so it cuts corners and takes shortcuts without
 * ever crossing a blocked cell. Pure data: no Three.js, no allocation per frame.
 */

/** Walkable floor height of the creature-sized cell centred on (x, z) near `floorY`, or NaN when blocked. */
export type NavCellProbe = (x: number, z: number, floorY: number) => number;

export interface NavPoint { x: number; z: number; y?: number }

export interface NavSteer {
  /** Next point to walk straight to (farthest clear point down the field). */
  x: number;
  z: number;
  /** Straight distance to that point. */
  reach: number;
  /** Heading change (rad, 0..π) expected when that point is reached. */
  turn: number;
  /** True when the point is the target itself (clear line to it). */
  direct: boolean;
}

export const NAV_CELL = 0.5;
export const NAV_SIZE = 128;
/** Neighbouring cells may differ by this much in floor height (a step). */
export const NAV_MAX_STEP = 0.36;

const UNKNOWN = 0;
const FREE = 1;
const BLOCKED = 2;
const QUEUED = 4;
const LAYERS = 6;
const DI = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DJ = [0, 0, 1, -1, 1, -1, 1, -1] as const;

export class NavGrid {
  readonly size: number;
  readonly cell: number;
  originX = 0;
  originZ = 0;
  floorY = 0;
  /** Probes performed since creation (diagnostics). */
  probes = 0;
  /** Field toward the last target, metres (Infinity = unreachable / unexplored). */
  readonly field: Float32Array;
  fieldValid = false;
  fieldVersion = 0;
  targetX = 0;
  targetZ = 0;
  targetY = 0;
  private readonly columns: number;
  private initialized = false;
  private readonly state: Uint8Array;
  private readonly heights: Float32Array;
  private readonly references: Float32Array;
  private readonly scratchState: Uint8Array;
  private readonly scratchHeights: Float32Array;
  private readonly scratchReferences: Float32Array;
  private readonly heap: Int32Array;
  private readonly heapCost: Float32Array;
  private heapLength = 0;
  /** Unknown cells to probe next (FIFO): those a field could not afford, then their free neighbours' neighbours. */
  private readonly frontier: Int32Array;
  private frontierLength = 0;
  private frontierHead = 0;
  private readonly steerScratch: NavSteer = { x: 0, z: 0, reach: 0, turn: 0, direct: false };

  constructor(private readonly probe: NavCellProbe, size = NAV_SIZE, cell = NAV_CELL) {
    this.size = size;
    this.cell = cell;
    this.columns = size * size;
    const count = this.columns * LAYERS;
    this.state = new Uint8Array(count);
    this.heights = new Float32Array(count);
    this.references = new Float32Array(count).fill(NaN);
    this.scratchState = new Uint8Array(count);
    this.scratchHeights = new Float32Array(count);
    this.scratchReferences = new Float32Array(count);
    this.field = new Float32Array(count).fill(Infinity);
    this.heap = new Int32Array(count * 4);
    this.heapCost = new Float32Array(count * 4);
    this.frontier = new Int32Array(count);
  }

  get width(): number { return this.size * this.cell; }
  get ready(): boolean { return this.initialized; }

  /**
   * Keeps the window around (x, z). A height change updates the default query
   * surface without discarding paths on other floors. Horizontal shifts retain
   * every overlapping surface. Returns true when the window changed.
   */
  follow(x: number, z: number, floorY: number, margin = 10): boolean {
    const half = this.width / 2;
    this.floorY = floorY;
    if (!this.initialized) {
      this.originX = this.snap(x - half);
      this.originZ = this.snap(z - half);
      this.floorY = floorY;
      this.initialized = true;
      this.clear();
      return true;
    }
    const centreX = this.originX + half, centreZ = this.originZ + half;
    if (Math.abs(x - centreX) < margin && Math.abs(z - centreZ) < margin) return false;
    const shiftI = Math.round((x - centreX) / this.cell), shiftJ = Math.round((z - centreZ) / this.cell);
    this.shift(shiftI, shiftJ);
    return true;
  }

  /** Forget every probed cell (the world around changed: chunks, doors). */
  invalidate(): void { this.clear(); }

  /** Forget the cells within `radius` metres of (x, z) so they are probed again. */
  invalidateAround(x: number, z: number, radius: number): void {
    const reach = Math.ceil(radius / this.cell);
    const ci = this.columnOf(x), cj = this.rowOf(z);
    for (let j = cj - reach; j <= cj + reach; j += 1) {
      for (let i = ci - reach; i <= ci + reach; i += 1) {
        if (i < 0 || j < 0 || i >= this.size || j >= this.size) continue;
        for (let layer = 0; layer < LAYERS; layer++) {
          const node = layer * this.columns + j * this.size + i;
          this.state[node] = this.state[node]! & QUEUED;
        }
      }
    }
    this.fieldValid = false;
  }

  columnOf(x: number): number { return Math.floor((x - this.originX) / this.cell); }
  rowOf(z: number): number { return Math.floor((z - this.originZ) / this.cell); }
  indexAt(x: number, z: number, y = this.floorY): number {
    const i = this.columnOf(x), j = this.rowOf(z);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return -1;
    const column = j * this.size + i;
    let known = -1, distance = Infinity, pending = -1, empty = -1, blocked = -1;
    for (let layer = 0; layer < LAYERS; layer++) {
      const node = layer * this.columns + column, state = this.state[node]! & 3;
      const reference = this.references[node]!;
      if (state === FREE) {
        const d = Math.abs(this.heights[node]! - y);
        if (d <= NAV_MAX_STEP + .07 && d < distance) { known = node; distance = d; }
      } else if (!Number.isFinite(reference)) { if (empty < 0) empty = node; }
      else if (Math.abs(reference - y) < .12) pending = node;
      else if (state === BLOCKED && !(this.state[node]! & QUEUED)) blocked = node;
    }
    if (known >= 0) return known;
    if (pending >= 0) return pending;
    const node = empty >= 0 ? empty : blocked;
    if (node >= 0) { this.references[node] = y; this.state[node] = UNKNOWN; this.field[node] = Infinity; }
    return node;
  }
  centreX(index: number): number { return this.originX + ((index % this.size) + 0.5) * this.cell; }
  centreZ(index: number): number { return this.originZ + (Math.floor((index % this.columns) / this.size) + 0.5) * this.cell; }
  heightOf(index: number): number { return this.heights[index]!; }

  /** Known free (never probes). */
  isKnownFree(index: number): boolean { return index >= 0 && (this.state[index]! & 3) === FREE; }
  isKnown(index: number): boolean { return index >= 0 && (this.state[index]! & 3) !== UNKNOWN; }

  /** Free, probing the cell now when it is still unknown. */
  isFree(index: number): boolean {
    if (index < 0) return false;
    if ((this.state[index]! & 3) === UNKNOWN) this.probeCell(index);
    return (this.state[index]! & 3) === FREE;
  }

  isFreeAt(x: number, z: number, y = this.floorY): boolean { return this.isFree(this.indexAt(x, z, y)); }
  /** Discover both ends of a route, even when they occupy different floors. */
  seed(x: number, z: number, y = this.floorY): void {
    const index = this.indexAt(x, z, y);
    if (!this.isFree(index)) return;
    for (let k = 0; k < 4; k++) this.queue(this.neighbour(index, DI[k]!, DJ[k]!));
  }

  /** Clearance in the cached body-sized cells, without extra physics probes. */
  hasClearanceAt(x: number, z: number, radius: number, y = this.floorY): boolean {
    if (!this.isKnownFree(this.indexAt(x, z, y))) return false;
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      if (!this.isKnownFree(this.indexAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, y))) return false;
    }
    return true;
  }

  /** Floor height under (x, z), or NaN outside the walkable cells. */
  floorAt(x: number, z: number, y = this.floorY): number {
    const index = this.indexAt(x, z, y);
    return this.isFree(index) ? this.heights[index]! : Number.NaN;
  }

  /**
   * Probes up to `budget` queued cells, nearest first, and floods outward
   * from every free one: the walkable area around keeps being discovered a
   * few cells per frame. Returns the number probed.
   */
  warm(budget: number): number {
    let done = 0;
    const capacity = this.frontier.length;
    while (done < budget && this.frontierLength > 0) {
      const index = this.frontier[this.frontierHead]!;
      this.frontierHead = (this.frontierHead + 1) % capacity;
      this.frontierLength -= 1;
      this.state[index] = this.state[index]! & ~QUEUED;
      if ((this.state[index]! & 3) !== UNKNOWN) continue;
      this.probeCell(index);
      done += 1;
      if ((this.state[index]! & 3) !== FREE) continue;
      for (let k = 0; k < 4; k += 1) {
        const next = this.neighbour(index, DI[k]!, DJ[k]!);
        if (next < 0) continue;
        if ((this.state[next]! & 3) === UNKNOWN) this.queue(next);
      }
    }
    return done;
  }

  get pendingProbes(): number { return this.frontierLength; }

  /**
   * Dijkstra from (x, z) over the walkable cells. Unknown cells are probed
   * while `probeBudget` lasts, otherwise queued for `warm` and treated as
   * blocked for now. `maxCost` (metres) bounds the search.
   */
  computeField(x: number, z: number, probeBudget = 64, maxCost = 192, y = this.floorY): boolean {
    this.field.fill(Infinity);
    this.heapLength = 0;
    this.targetX = x;
    this.targetZ = z;
    this.targetY = y;
    let start = this.indexAt(x, z, y);
    if (start >= 0 && !this.isFree(start)) start = this.nearestFree(start, 2);
    if (start < 0) { this.fieldValid = false; this.fieldVersion += 1; return false; }
    let budget = probeBudget;
    this.field[start] = 0;
    this.push(start, 0);
    const cell = this.cell, diagonal = cell * Math.SQRT2;
    while (this.heapLength > 0) {
      const cost = this.heapCost[0]!;
      const index = this.pop();
      if (cost > this.field[index]!) continue;
      if (cost > maxCost) break;
      const height = this.heights[index]!;
      for (let k = 0; k < 8; k += 1) {
        const next = this.neighbour(index, DI[k]!, DJ[k]!);
        if (next < 0) continue;
        const known = this.state[next]! & 3;
        if (known === UNKNOWN) {
          if (budget > 0) { this.probeCell(next); budget -= 1; }
          else { this.queue(next); continue; }
        }
        if ((this.state[next]! & 3) !== FREE) continue;
        if (Math.abs(this.heights[next]! - height) > NAV_MAX_STEP) continue;
        if (k >= 4) {
          // No diagonal squeeze between two blocked corners.
          if (!this.diagonalClear(index, DI[k]!, DJ[k]!)) continue;
        }
        const nextCost = cost + Math.hypot(k >= 4 ? diagonal : cell, this.heights[next]! - height);
        if (nextCost < this.field[next]!) {
          this.field[next] = nextCost;
          this.push(next, nextCost);
        }
      }
    }
    this.fieldValid = true;
    this.fieldVersion += 1;
    return true;
  }

  /** Path metres from (x, z) to the field's target (Infinity when unknown). */
  distanceAt(x: number, z: number, y = this.floorY): number {
    if (!this.fieldValid) return Infinity;
    const index = this.indexAt(x, z, y);
    if (index < 0) return Infinity;
    const value = this.field[index]!;
    if (Number.isFinite(value)) {
      // Sub-cell refinement toward the target cell.
      return value === 0 ? Math.hypot(x - this.targetX, z - this.targetZ) : value;
    }
    const near = this.nearestReached(index, 1);
    return near >= 0 ? this.field[near]! + this.cell : Infinity;
  }

  /**
   * Where to walk from (x, z): down the field, as far as a straight
   * clearance-checked line allows (`lookahead` cells). Null when there is no
   * route from here. `mode` -1 climbs the field instead (away from the target).
   */
  steer(x: number, z: number, lookahead = 14, mode: 1 | -1 = 1, y = this.floorY): NavSteer | null {
    if (!this.fieldValid) return null;
    let index = this.indexAt(x, z, y);
    if (index < 0) return null;
    if (!Number.isFinite(this.field[index]!)) index = this.nearestReached(index, 2);
    if (index < 0) return null;
    const out = this.steerScratch;
    if (mode === 1 && this.clearLine(x, z, this.targetX, this.targetZ, lookahead * this.cell, .18, y, this.targetY)) {
      out.x = this.targetX; out.z = this.targetZ; out.direct = true;
      out.reach = Math.hypot(out.x - x, out.z - z); out.turn = 0;
      return out;
    }
    let best = -1, cursor = index;
    for (let step = 0; step < lookahead; step += 1) {
      const next = this.descend(cursor, mode);
      if (next < 0) break;
      cursor = next;
      if (this.clearLine(x, z, this.centreX(cursor), this.centreZ(cursor), Infinity, .18, y, this.heights[cursor]!)) best = cursor;
      else if (best >= 0) break;
      if (mode === 1 && this.field[cursor] === 0) break;
    }
    if (best < 0) {
      // Hugging a corner: at least the next cell down.
      best = this.descend(index, mode);
      if (best < 0) return null;
    }
    out.x = this.centreX(best); out.z = this.centreZ(best); out.direct = false;
    out.reach = Math.hypot(out.x - x, out.z - z);
    // The corner ahead: compare this leg with the one after it.
    let after = best;
    for (let step = 0; step < 4; step += 1) { const next = this.descend(after, mode); if (next < 0) break; after = next; }
    const ax = out.x - x, az = out.z - z, bx = this.centreX(after) - out.x, bz = this.centreZ(after) - out.z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    out.turn = la > 1e-4 && lb > 1e-4 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)))) : 0;
    return out;
  }

  /** Every sample of the segment lies in a known free cell, with a body clearance either side. */
  clearLine(ax: number, az: number, bx: number, bz: number, maxLength = Infinity, clearance = 0.18, y = this.floorY, endY?: number): boolean {
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    if (length > maxLength) return false;
    if (length < 1e-4) return (endY === undefined || Math.abs(endY-y) < NAV_MAX_STEP) && this.isKnownFree(this.indexAt(ax, az, y));
    const steps = Math.ceil(length / (this.cell * 0.5));
    const nx = -dz / length * clearance, nz = dx / length * clearance;
    let previousHeight = y;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps, x = ax + dx * t, z = az + dz * t;
      const index = this.indexAt(x, z, previousHeight);
      if (!this.isKnownFree(index)) return false;
      const height = this.heights[index]!;
      if (Number.isFinite(previousHeight) && Math.abs(height - previousHeight) > NAV_MAX_STEP) return false;
      previousHeight = height;
      if (clearance > 0 && (!this.isKnownFree(this.indexAt(x + nx, z + nz, height)) || !this.isKnownFree(this.indexAt(x - nx, z - nz, height)))) return false;
    }
    return endY === undefined || Math.abs(previousHeight-endY) <= NAV_MAX_STEP;
  }

  /**
   * Moves a body by (dx, dz) without ever entering a blocked or unknown
   * cell: slides along the free axis at walls, refuses diagonal corner
   * squeezes. Returns the distance actually travelled.
   */
  move(position: NavPoint, dx: number, dz: number): number {
    // A lunge can cross several cells in one frame. Check the entire path,
    // including thin walls between the start and the destination.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.cell * 0.4)));
    const mx = dx / steps, mz = dz / steps;
    let travelled = 0;
    for (let i = 0; i < steps; i += 1) {
      const from = this.indexAt(position.x, position.z, position.y ?? this.floorY);
      if (this.tryMove(position, from, mx, mz)) travelled += Math.hypot(mx, mz);
      else if (Math.abs(mx) > 1e-5 && this.tryMove(position, from, mx, 0)) travelled += Math.abs(mx);
      else if (Math.abs(mz) > 1e-5 && this.tryMove(position, from, 0, mz)) travelled += Math.abs(mz);
      else break;
    }
    return travelled;
  }

  private tryMove(position: NavPoint, from: number, mx: number, mz: number): boolean {
    const x = position.x + mx, z = position.z + mz;
    const y = this.isKnownFree(from) ? this.heights[from]! : position.y ?? this.floorY;
    const to = this.indexAt(x, z, y);
    if (to < 0 || !this.isFree(to)) return false;
    if (from >= 0 && to !== from) {
      if (this.isKnownFree(from) && Math.abs(this.heights[to]! - this.heights[from]!) > NAV_MAX_STEP) return false;
      const fi = from % this.size, fj = Math.floor((from % this.columns)/this.size), ti = to % this.size, tj = Math.floor((to % this.columns)/this.size);
      if (fi !== ti && fj !== tj && (!this.isFree(this.neighbour(from, ti-fi, 0)) || !this.isFree(this.neighbour(from, 0, tj-fj)))) return false;
    }
    position.x = x; position.z = z;
    if (position.y !== undefined) position.y = this.heights[to]!;
    return true;
  }

  /** Free metres from (x, z) along a horizontal direction (known cells only). */
  openLength(x: number, z: number, dirX: number, dirZ: number, max = 30, y = this.floorY): number {
    const length = Math.hypot(dirX, dirZ);
    if (length < 1e-6) return 0;
    const ux = dirX / length, uz = dirZ / length, step = this.cell * 0.5;
    for (let travelled = step; travelled <= max; travelled += step) {
      const node = this.indexAt(x + ux * travelled, z + uz * travelled, y);
      if (!this.isKnownFree(node) || Math.abs(this.heights[node]!-y)>NAV_MAX_STEP) return travelled-step;
      y = this.heights[node]!;
    }
    return max;
  }
  /** Height reached along a known continuous surface, including several metres of ramp. */
  floorAlong(ax:number,az:number,bx:number,bz:number,y=this.floorY):number{
    const steps=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/(this.cell*.5)));
    for(let step=0;step<=steps;step++){
      const t=step/steps,node=this.indexAt(ax+(bx-ax)*t,az+(bz-az)*t,y);
      if(!this.isKnownFree(node)||Math.abs(this.heights[node]!-y)>NAV_MAX_STEP)return NaN;
      y=this.heights[node]!;
    }
    return y;
  }

  /** The nearest known free cell to `index` within `radius` cells (or -1). */
  nearestFree(index: number, radius: number): number {
    const size = this.size, ci = index % size, cj = Math.floor((index % this.columns) / size), y = this.references[index]!;
    let best = -1, bestDistance = Infinity;
    for (let j = cj - radius; j <= cj + radius; j += 1) {
      for (let i = ci - radius; i <= ci + radius; i += 1) {
        if (i < 0 || j < 0 || i >= size || j >= size) continue;
        const candidate = this.indexAt(this.originX+(i+.5)*this.cell, this.originZ+(j+.5)*this.cell, y);
        if (!this.isFree(candidate)) continue;
        const distance = (i - ci) * (i - ci) + (j - cj) * (j - cj);
        if (distance < bestDistance) { bestDistance = distance; best = candidate; }
      }
    }
    return best;
  }

  /** Visits known free cells every `stride` cells (for placement scoring). */
  forEachFree(stride: number, visit: (index: number, x: number, z: number) => void): void {
    const size = this.size;
    for (let layer = 0; layer < LAYERS; layer++) for (let j = 0; j < size; j += stride) {
      for (let i = 0; i < size; i += stride) {
        const index = layer * this.columns + j * size + i;
        if ((this.state[index]! & 3) === FREE) visit(index, this.centreX(index), this.centreZ(index));
      }
    }
  }

  // ------------------------------------------------------------- internals

  private snap(value: number): number { return Math.floor(value / this.cell) * this.cell; }

  private clear(): void {
    this.state.fill(UNKNOWN);
    this.references.fill(NaN);
    this.field.fill(Infinity);
    this.fieldValid = false;
    this.frontierLength = 0;
    this.frontierHead = 0;
  }

  private shift(shiftI: number, shiftJ: number): void {
    const size = this.size;
    this.scratchState.fill(UNKNOWN);
    this.scratchReferences.fill(NaN);
    for (let layer = 0; layer < LAYERS; layer++) for (let j = 0; j < size; j += 1) {
      const sj = j + shiftJ;
      if (sj < 0 || sj >= size) continue;
      for (let i = 0; i < size; i += 1) {
        const si = i + shiftI;
        if (si < 0 || si >= size) continue;
        const source = layer * this.columns + sj * size + si, target = layer * this.columns + j * size + i;
        this.scratchState[target] = this.state[source]! & 3;
        this.scratchHeights[target] = this.heights[source]!;
        this.scratchReferences[target] = this.references[source]!;
      }
    }
    this.state.set(this.scratchState);
    this.heights.set(this.scratchHeights);
    this.references.set(this.scratchReferences);
    this.originX += shiftI * this.cell;
    this.originZ += shiftJ * this.cell;
    this.field.fill(Infinity);
    this.fieldValid = false;
    this.frontierLength = 0;
    this.frontierHead = 0;
  }

  private probeCell(index: number): void {
    this.probes += 1;
    const height = this.probe(this.centreX(index), this.centreZ(index), this.references[index]!);
    const free = Number.isFinite(height);
    this.state[index] = (this.state[index]! & QUEUED) | (free ? FREE : BLOCKED);
    if (free) this.heights[index] = height;
  }

  private queue(index: number): void {
    if (index < 0 || (this.state[index]! & 3) !== UNKNOWN) return;
    if (this.state[index]! & QUEUED || this.frontierLength >= this.frontier.length) return;
    this.state[index] = this.state[index]! | QUEUED;
    this.frontier[(this.frontierHead + this.frontierLength) % this.frontier.length] = index;
    this.frontierLength += 1;
  }

  /** The reachable neighbour with the lowest (mode 1) or highest (mode -1) field value. */
  private descend(index: number, mode: 1 | -1): number {
    const here = this.field[index]!;
    let best = -1, bestValue = here;
    for (let k = 0; k < 8; k += 1) {
      const next = this.neighbour(index, DI[k]!, DJ[k]!);
      if (!this.isKnownFree(next) || Math.abs(this.heights[next]!-this.heights[index]!)>NAV_MAX_STEP) continue;
      const value = this.field[next]!;
      if (!Number.isFinite(value)) continue;
      if (k >= 4 && !this.diagonalClear(index, DI[k]!, DJ[k]!)) continue;
      if (mode === 1 ? value < bestValue : value > bestValue) { bestValue = value; best = next; }
    }
    return best;
  }

  private nearestReached(index: number, radius: number): number {
    const size = this.size, ci = index % size, cj = Math.floor((index % this.columns) / size);
    const y = this.isKnownFree(index) ? this.heights[index]! : this.references[index]!;
    let best = -1, bestValue = Infinity;
    for (let j = cj - radius; j <= cj + radius; j += 1) {
      for (let i = ci - radius; i <= ci + radius; i += 1) {
        if (i < 0 || j < 0 || i >= size || j >= size) continue;
        const node = this.indexAt(this.originX+(i+.5)*this.cell,this.originZ+(j+.5)*this.cell,y);
        if (!this.isKnownFree(node) || Math.abs(this.heights[node]!-y)>NAV_MAX_STEP) continue;
        const value = this.field[node]!;
        if (value < bestValue) { bestValue = value; best = node; }
      }
    }
    return Number.isFinite(bestValue) ? best : -1;
  }

  private neighbour(index: number, di: number, dj: number): number {
    const i=index%this.size+di, j=Math.floor((index%this.columns)/this.size)+dj;
    if(i<0||j<0||i>=this.size||j>=this.size)return -1;
    return this.indexAt(this.originX+(i+.5)*this.cell,this.originZ+(j+.5)*this.cell,this.heights[index]!);
  }
  private diagonalClear(index: number, di: number, dj: number): boolean {
    const a=this.neighbour(index,di,0), b=this.neighbour(index,0,dj), y=this.heights[index]!;
    return this.isKnownFree(a)&&this.isKnownFree(b)&&Math.abs(this.heights[a]!-y)<=NAV_MAX_STEP&&Math.abs(this.heights[b]!-y)<=NAV_MAX_STEP;
  }

  private push(index: number, cost: number): void {
    if (this.heapLength >= this.heap.length) return;
    let position = this.heapLength++;
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (this.heapCost[parent]! <= cost) break;
      this.heap[position] = this.heap[parent]!;
      this.heapCost[position] = this.heapCost[parent]!;
      position = parent;
    }
    this.heap[position] = index;
    this.heapCost[position] = cost;
  }

  private pop(): number {
    const top = this.heap[0]!;
    const length = --this.heapLength;
    if (length > 0) {
      const index = this.heap[length]!, cost = this.heapCost[length]!;
      let position = 0;
      for (;;) {
        let child = position * 2 + 1;
        if (child >= length) break;
        if (child + 1 < length && this.heapCost[child + 1]! < this.heapCost[child]!) child += 1;
        if (this.heapCost[child]! >= cost) break;
        this.heap[position] = this.heap[child]!;
        this.heapCost[position] = this.heapCost[child]!;
        position = child;
      }
      this.heap[position] = index;
      this.heapCost[position] = cost;
    }
    return top;
  }
}

/** A grid maze for tests and tools: '#' walls, '.' floor, one character per cell. */
export const mazeProbe = (rows: readonly string[], cell = NAV_CELL, originX = 0, originZ = 0, floorY = 0): NavCellProbe =>
  (x, z) => {
    const i = Math.floor((x - originX) / cell), j = Math.floor((z - originZ) / cell);
    const row = rows[j];
    if (!row || i < 0 || i >= row.length) return Number.NaN;
    return row[i] === '#' || row[i] === ' ' ? Number.NaN : floorY;
  };
