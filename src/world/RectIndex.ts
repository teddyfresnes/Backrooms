import type { Rect } from './types';

/** Generation-only broad phase. Values and their insertion order stay stable. */
export class RectIndex<T> {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly values: readonly T[], bounds: (value: T) => Rect, private readonly pitch = 8) {
    values.forEach((value, i) => {
      for (const key of this.keys(bounds(value))) {
        const cell = this.cells.get(key) ?? [];
        cell.push(i); this.cells.set(key, cell);
      }
    });
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
