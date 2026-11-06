const xmur3 = (value: string): (() => number) => {
  let hash = 1779033703 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
};

const mulberry32 = (seed: number): (() => number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

export class SeededRandom {
  readonly seed: string;
  private readonly nextValue: () => number;

  constructor(seed: string) {
    this.seed = seed;
    this.nextValue = mulberry32(xmur3(seed)());
  }

  fork(label: string): SeededRandom {
    return new SeededRandom(`${this.seed}::${label}`);
  }

  float(min = 0, max = 1): number {
    return min + (max - min) * this.nextValue();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.float(min, maxInclusive + 1));
  }

  chance(probability: number): boolean {
    return this.nextValue() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Cannot pick from an empty collection.');
    return items[this.int(0, items.length - 1)]!;
  }

  weighted<T>(items: ReadonlyArray<{ value: T; weight: number }>): T {
    const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    let cursor = this.float(0, total);
    for (const item of items) {
      cursor -= Math.max(0, item.weight);
      if (cursor <= 0) return item.value;
    }
    return items[items.length - 1]!.value;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
    }
    return result;
  }
}

export const createReadableSeed = (): string => {
  const adjectives = ['AMBER', 'DAMP', 'HOLLOW', 'PALE', 'STATIC', 'SILENT', 'LATE', 'LOST'];
  const nouns = ['CARPET', 'OFFICE', 'THRESHOLD', 'HUM', 'TILE', 'HALL', 'WALL', 'LIGHT'];
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${adjectives[random[0]! % adjectives.length]}-${nouns[random[1]! % nouns.length]}-${String(random[0]! % 10000).padStart(4, '0')}`;
};
