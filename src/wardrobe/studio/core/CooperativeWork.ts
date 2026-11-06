/** Let input/painting run between bounded chunks; a superseded selection must
 * never finish its expensive work or commit into the current character.
 */
export class CooperativeWork {
  private deadline = performance.now() + 4
  constructor(private readonly isCurrent: () => boolean = () => true) {}
  assertCurrent(): void {
    if (!this.isCurrent()) throw new DOMException('Character selection superseded', 'AbortError')
  }
  checkpoint(): Promise<void> | undefined {
    this.assertCurrent()
    if (performance.now() < this.deadline) return
    const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler
    const pause = scheduler?.yield ? scheduler.yield() : new Promise<void>(resolve => setTimeout(resolve, 0))
    return pause.then(() => { this.assertCurrent(); this.deadline = performance.now() + 4 })
  }
}

export function finishWork<T>(steps: Generator<void, T>): T {
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

export async function runWork<T>(steps: Generator<void, T>, work = new CooperativeWork()): Promise<T> {
  work.assertCurrent()
  let next = steps.next()
  while (!next.done) {
    const pause = work.checkpoint()
    if (pause) await pause
    next = steps.next()
  }
  work.assertCurrent()
  return next.value
}

export function* textLines(text: string): Generator<string> {
  let start = 0
  while (start < text.length) {
    const end = text.indexOf('\n', start)
    if (end < 0) { yield text.slice(start); return }
    yield text.slice(start, end); start = end + 1
  }
}
