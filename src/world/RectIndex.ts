import type { Rect } from './types';

/** Generation-only broad phase. Values and their insertion order stay stable. */
export class RectIndex<T> {
  private readonly cells = new Map<string, number[]>();
  private readonly values: T[] = [];
  private readonly positions = new Map<T, number>();
  constructor(values: readonly T[], private readonly bounds: (value: T) => Rect, private readonly pitch = 8) {
    values.forEach(value => this.insert(value));
  }
  insert(value: T): void {
    const i = this.values.push(value) - 1;
    this.positions.set(value, i);
    for (const key of this.keys(this.bounds(value))) {
      const cell = this.cells.get(key) ?? [];
      cell.push(i); this.cells.set(key, cell);
    }
  }
  /** Keep insertion order while moving an existing value's indexed envelope. */
  relocate(value: T, previousBounds: Rect): void {
    const i = this.positions.get(value);
    if (i === undefined) throw new Error('Cannot relocate an unindexed value');
    for (const key of this.keys(previousBounds)) {
      const cell = this.cells.get(key);
      const at = cell?.indexOf(i) ?? -1;
      if (at >= 0) cell!.splice(at, 1);
      if (cell?.length === 0) this.cells.delete(key);
    }
    for (const key of this.keys(this.bounds(value))) {
      const cell = this.cells.get(key) ?? [];
      cell.push(i); this.cells.set(key, cell);
    }
  }
  query(bounds: Rect): T[] {
    const ids = new Set<number>();
    for (const key of this.keys(bounds)) for (const i of this.cells.get(key) ?? []) ids.add(i);
    return [...ids].sort((a, b) => a - b).map(i => this.values[i]!);
  }
  private *keys(b: Rect): Generator<string> {
    for (let z = Math.floor(b.minZ / this.pitch); z <= Math.floor(b.maxZ / this.pitch); z++)
      for (let x = Math.floor(b.minX / this.pitch); x <= Math.floor(b.maxX / this.pitch); x++) yield `${x}/${z}`;
  }
}
