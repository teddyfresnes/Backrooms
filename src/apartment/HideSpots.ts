import type { HideSpotId } from '../monster/BacteriaLayout';

/** What the game, the save and the Bacteria hunt need from one hiding place. */
export interface HidingPlace {
  readonly isActive: boolean;
  readonly isTargeted: boolean;
  readonly doorProgress: number;
  exitLocked: boolean;
  interact(): boolean;
  enterNow(): void;
  requestExit(): void;
  forceFinish(): void;
  holdExit(progress: number): void;
  burstOut(): void;
  update(dt: number, playing: boolean): void;
  dispose(): void;
}

/**
 * The flat's hiding places behind one facade: the wardrobe, the entry closet
 * and the bathroom. Only one can be in use; the others keep their prompts.
 * Its surface is the wardrobe's (ClosetHide) so existing callers are unchanged.
 */
export class HideSpots {
  private last: HideSpotId = 'wardrobe';
  constructor(private readonly places: Readonly<Partial<Record<HideSpotId, HidingPlace>>> & { wardrobe: HidingPlace }) {}

  private get entries(): [HideSpotId, HidingPlace][] { return Object.entries(this.places) as [HideSpotId, HidingPlace][]; }
  private get active(): [HideSpotId, HidingPlace] | undefined { return this.entries.find(([, place]) => place.isActive); }

  get isActive(): boolean { return !!this.active; }
  get isTargeted(): boolean { return !!this.targetedId; }
  /** The spot aimed at right now, if any. */
  get targetedId(): HideSpotId | null { return this.entries.find(([, place]) => place.isTargeted)?.[0] ?? null; }
  /** The spot in use, else the last one used (checkpoint restarts). */
  get currentId(): HideSpotId { return this.active?.[0] ?? this.last; }
  /** Saved as `closetDoor`: the wardrobe leaves (the other doors always close). */
  get doorProgress(): number { return this.places.wardrobe.doorProgress; }
  get exitLocked(): boolean { return this.active?.[1].exitLocked ?? false; }
  set exitLocked(value: boolean) { for (const [, place] of this.entries) place.exitLocked = value; }

  interact(): boolean {
    const active = this.active;
    if (active) return active[1].interact();
    for (const [id, place] of this.entries) if (place.isTargeted && place.interact()) { this.last = id; return true; }
    return false;
  }
  /** Climb into `id` (default: the one aimed at, else the last one). */
  enterNow(id: HideSpotId = this.targetedId ?? this.last): void {
    if (this.active) return;
    const place = this.places[id] ?? this.places.wardrobe;
    this.last = this.places[id] ? id : 'wardrobe';
    place.enterNow();
  }
  requestExit(): void { this.active?.[1].requestExit(); }
  forceFinish(): void { this.active?.[1].forceFinish(); }
  holdExit(progress: number): void { this.active?.[1].holdExit(progress); }
  burstOut(): void { this.active?.[1].burstOut(); }
  update(dt: number, playing: boolean): void {
    const active = this.active;
    if (active) { active[1].update(dt, playing); return; }
    // Idle: only one prompt may own the interaction line.
    let prompted = false;
    for (const [, place] of this.entries) {
      if (!prompted && playing && place.isTargeted) { place.update(dt, true); prompted = true; }
      else place.update(dt, false);
    }
  }
  dispose(): void { for (const [, place] of this.entries) place.dispose(); }
}
