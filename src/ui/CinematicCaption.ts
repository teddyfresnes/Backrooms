/** Keep the whole sentence laid out. Native opacity animations reveal letters
 * without rebuilding lines or depending on the scene loader's JS frames. */
export class CinematicCaption {
  private nodes: HTMLElement[] = [];
  private animations: Animation[] = [];
  private paused = new Set<Animation>();
  private schedule: readonly number[] = [];
  private elapsed = 0;
  private count = 0;
  private completedAt?: number;
  private reduced = false;
  constructor(private readonly element: HTMLElement) {}

  show(text: string, schedule: readonly number[], duration: number, reduced: boolean): void {
    this.stop(); this.nodes = []; this.schedule = schedule; this.elapsed = 0; this.count = 0;
    this.completedAt = undefined; this.reduced = reduced;
    const fragment = document.createDocumentFragment();
    let word: HTMLSpanElement | undefined;
    for (const [index, character] of Array.from(text).entries()) {
      const node = document.createElement('span');
      node.dataset.filmLetter = ''; node.textContent = character; node.style.opacity = '0';
      if (character === ' ') { fragment.append(node); word = undefined; }
      else {
        if (!word) { word = document.createElement('span'); word.className = 'film-caption-word'; fragment.append(word); }
        word.append(node);
      }
      this.nodes.push(node);
      if (!reduced && typeof node.animate === 'function') {
        const delay = schedule[index]!, remaining = Math.max(2, duration + 1 - delay);
        const animation = node.animate([
          { opacity: 0, offset: 0 }, { opacity: 1, offset: 1 / remaining }, { opacity: 1, offset: 1 },
        ], { delay, duration: remaining, fill: 'both', easing: 'linear' });
        void animation.finished?.catch(() => undefined);
        this.animations.push(animation);
      }
    }
    this.element.replaceChildren(fragment);
    if (document.hidden) this.setPaused(true);
  }

  private clock(): number {
    if (!this.animations.length) return this.elapsed;
    const time = this.animations[0]!.currentTime;
    return typeof time === 'number' ? time : 0;
  }
  update(elapsed: number): number {
    this.elapsed = elapsed;
    const time = this.clock();
    let count = this.count;
    while (count < this.schedule.length && time >= this.schedule[count]! + 1) count++;
    if (this.reduced && elapsed >= 650) count = this.nodes.length;
    if (!this.animations.length) for (let i = this.count; i < count; i++) this.nodes[i]!.style.opacity = '1';
    this.count = count;
    if (count === this.nodes.length && this.completedAt === undefined) {
      // Native animation has already been visible during a blocked JS frame.
      // The manual fallback starts its reading hold only after painting all letters.
      this.completedAt = this.animations.length ? this.schedule.at(-1)! + 1 : elapsed;
    }
    return count;
  }
  ready(holdMs: number): boolean { return this.completedAt !== undefined && this.clock() - this.completedAt >= holdMs; }
  setPaused(hidden: boolean): void {
    if (hidden) {
      for (const animation of this.animations) if (animation.playState === 'running') { animation.pause(); this.paused.add(animation); }
    } else { for (const animation of this.paused) animation.play(); this.paused.clear(); }
  }
  stop(): void {
    for (let i = 0; i < this.nodes.length; i++) this.nodes[i]!.style.opacity = i < this.count ? '1' : '0';
    for (const animation of this.animations) { void animation.finished?.catch(() => undefined); animation.cancel(); }
    this.animations = []; this.paused.clear();
  }
}
