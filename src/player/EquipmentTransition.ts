/** One presentation slot: wheel input replaces the destination rather than queuing animations. */
export class EquipmentTransition {
  presented: string | undefined;
  lower = 1;
  update(wanted: string | undefined, delta: number): void {
    let remaining = Math.min(.1, Math.max(0, delta));
    if (this.presented !== wanted) {
      const time = (1 - this.lower) * .14;
      const used = Math.min(remaining, time);
      this.lower = Math.min(1, this.lower + used / .14);
      remaining -= used;
      if (this.lower >= 1 - 1e-6) { this.lower = 1; this.presented = wanted; }
    }
    if (this.presented === wanted && wanted !== undefined) this.lower = Math.max(0, this.lower - remaining / .22);
  }
  hide(): void { this.presented = undefined; this.lower = 1; }
  get amount(): number { return this.lower * this.lower * (3 - 2 * this.lower); }
}
