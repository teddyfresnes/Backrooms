/** Initialization work yields real browser tasks, not just microtasks, so the
 * visible prologue keeps receiving animation frames and input events. */
export const yieldToBrowser = (): Promise<void> => {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
};

/** A rAF callback runs before paint. A second frame plus a task lets the overlay
 * paint before a new renderer or any scene construction is allowed to start. */
export const afterBrowserPaint = async (): Promise<void> => {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await yieldToBrowser();
};

export async function mapWithConcurrency<T>(items: readonly T[], limit: number, action: (item: T, index: number) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await yieldToBrowser();
      await action(items[current]!, current);
    }
  }));
}

export class CooperativeWork {
  private deadline = performance.now() + 3;
  constructor(private readonly signal?: AbortSignal, private readonly pause = yieldToBrowser) {}
  async checkpoint(force = false): Promise<void> {
    this.signal?.throwIfAborted();
    if (force || performance.now() >= this.deadline) {
      await this.pause(); this.signal?.throwIfAborted(); this.deadline = performance.now() + 3;
    }
  }
}
