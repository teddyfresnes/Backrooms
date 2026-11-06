import { SeededRandom } from '../../world/SeededRandom';
export class MinesGame {
  readonly size = 9;
  readonly mineCount = 10;
  readonly revealed = new Set<number>();
  readonly flags = new Set<number>();
  readonly mines = new Set<number>();
  status: 'ready' | 'playing' | 'won' | 'lost' = 'ready';
  constructor(private readonly seed = 'dernier-etage-mines') {}
  neighbours(cell: number): number[] {
    const x = cell % this.size, y = Math.floor(cell / this.size), result: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < this.size && ny >= 0 && ny < this.size) result.push(ny * this.size + nx);
    }
    return result;
  }
  count(cell: number): number { return this.neighbours(cell).filter(n => this.mines.has(n)).length; }
  flag(cell: number): void {
    if (!Number.isInteger(cell) || cell < 0 || cell >= this.size ** 2 || this.revealed.has(cell) || this.status === 'won' || this.status === 'lost') return;
    if (this.flags.has(cell)) this.flags.delete(cell); else if (this.flags.size < this.mineCount) this.flags.add(cell);
  }
  reveal(cell: number): void {
    if (!Number.isInteger(cell) || cell < 0 || cell >= this.size ** 2 || this.flags.has(cell) || this.revealed.has(cell) || this.status === 'won' || this.status === 'lost') return;
    if (this.status === 'ready') {
      const safe = new Set([cell, ...this.neighbours(cell)]);
      const candidates = Array.from({ length: this.size ** 2 }, (_, i) => i).filter(i => !safe.has(i));
      for (const mine of new SeededRandom(this.seed).shuffle(candidates).slice(0, this.mineCount)) this.mines.add(mine);
      this.status = 'playing';
    }
    if (this.mines.has(cell)) { this.status = 'lost'; this.mines.forEach(m => this.revealed.add(m)); return; }
    const pending = [cell];
    while (pending.length) {
      const next = pending.pop()!; if (this.revealed.has(next) || this.flags.has(next)) continue;
      this.revealed.add(next);
      if (!this.count(next)) for (const adjacent of this.neighbours(next)) if (!this.mines.has(adjacent) && !this.revealed.has(adjacent)) pending.push(adjacent);
    }
    if (this.revealed.size === this.size ** 2 - this.mineCount) this.status = 'won';
  }
}
