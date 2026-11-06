import type { RagdollImpactSurface } from './DamageSystem';

export interface BloodContact {
  readonly bodyId: string;
  readonly surface: RagdollImpactSurface;
  readonly position: Readonly<{x:number;y:number;z:number}>;
  readonly speed: number;
  readonly time: number;
}

/** Removes numerical duplicates, never a whole sequence of separate impacts. */
export class BloodImpactGate {
  private readonly contacts = new Map<string, BloodContact>();

  accept(contact: BloodContact): boolean {
    const key = `${contact.bodyId}:${contact.surface}`;
    const previous = this.contacts.get(key);
    if (previous) {
      const dt = contact.time - previous.time;
      const p = contact.position;
      const q = previous.position;
      const distanceSq = (p.x-q.x)**2+(p.y-q.y)**2+(p.z-q.z)**2;
      if (dt >= 0 && dt < 0.12 && distanceSq < 0.16**2
        && contact.speed <= previous.speed * 1.35 + 0.5) return false;
    }
    this.contacts.set(key, { ...contact, position: { ...contact.position } });
    if (this.contacts.size > 48) {
      const oldest = this.contacts.keys().next().value;
      if (oldest !== undefined) this.contacts.delete(oldest);
    }
    return true;
  }

  reset(): void { this.contacts.clear(); }
}
