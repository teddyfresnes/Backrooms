export type PairAction = 'rps' | 'high-five' | 'fist-bump' | 'help-up';
export type PairActor = 'player' | 'npc';
export type RpsChoice = 'rock' | 'paper' | 'scissors';
export const PAIR_INVITATION_SECONDS = 4;
export const PAIR_REACH_METERS = 1.9;
export const RPS_REVEAL_SECONDS = 2.12;
export const PAIR_ACTIONS: ReadonlyArray<{ id: PairAction; label: string; detail: string }> = [
  { id: 'rps', label: 'Pierre · feuille · ciseaux', detail: 'Choix secret, puis révélation ensemble' },
  { id: 'high-five', label: 'Tape m’en cinq', detail: 'Paumes alignées, contact et recul' },
  { id: 'fist-bump', label: 'Check', detail: 'Poings alignés, contact léger' },
  { id: 'help-up', label: 'Aider à se relever', detail: 'Prendre la main et accompagner le relevé' },
];
export const RPS_LABELS: Record<RpsChoice, string> = { rock: 'Pierre', paper: 'Feuille', scissors: 'Ciseaux' };
export const pairActionLabel = (id: PairAction): string => PAIR_ACTIONS.find(action => action.id === id)!.label;
export function rpsWinner(a: RpsChoice, b: RpsChoice): 'a' | 'b' | 'tie' {
  if (a === b) return 'tie';
  return (a === 'rock' && b === 'scissors') || (a === 'paper' && b === 'rock') || (a === 'scissors' && b === 'paper') ? 'a' : 'b';
}
export interface PairAvailability {
  distance: number; heightDifference: number; lookDot: number; lineOfSight: boolean;
  senderStanding: boolean; targetStanding: boolean; targetDown: boolean;
  targetReady: boolean; alive: boolean; busy: boolean;
}
export function pairUnavailableReason(action: PairAction, sample: PairAvailability, requireLook = true): string | null {
  if (!Number.isFinite(sample.distance + sample.heightDifference + sample.lookDot)) return 'Cible indisponible';
  if (!sample.alive) return 'Il faut être vivant';
  if (sample.busy) return 'Attendre la fin de l’action';
  if (!sample.senderStanding) return 'Il faut être debout';
  if (sample.distance > PAIR_REACH_METERS) return 'Rapproche-toi à moins de 1,9 m';
  if (!sample.lineOfSight) return 'Un obstacle vous sépare';
  if (requireLook && sample.lookDot < .78) return 'Regarde la personne';
  if (action === 'help-up') {
    if (!sample.targetDown) return 'La personne doit être au sol';
    if (Math.abs(sample.heightDifference) > .9) return 'Placez-vous sur un appui accessible';
    if (!sample.targetReady) return 'Attendre que la chute soit stabilisée';
  } else {
    if (!sample.targetStanding) return 'Vous devez être tous les deux debout';
    if (Math.abs(sample.heightDifference) > .36) return 'Placez-vous sur le même appui';
    if (sample.distance < .62) return 'Laisse un peu de place pour les bras';
  }
  return null;
}
export interface PairInvitation { kind: PairAction; from: PairActor; to: PairActor; createdAt: number; expiresAt: number }
export interface PairSession {
  kind: PairAction; from: PairActor; to: PairActor; stage: 'choosing' | 'aligning' | 'playing';
  acceptedAt: number; elapsed: number; duration: number;
}
/** One invitation, one clock, and locked private choices. No pose starts before acceptance. */
export class PairInteractionCoordinator {
  invitation: PairInvitation | null = null;
  session: PairSession | null = null;
  private readonly choices = new Map<PairActor, RpsChoice>();
  request(kind: PairAction, from: PairActor, now: number): boolean {
    if (this.invitation || this.session || !Number.isFinite(now)) return false;
    this.choices.clear();
    this.invitation = { kind, from, to: from === 'player' ? 'npc' : 'player', createdAt: now, expiresAt: now + PAIR_INVITATION_SECONDS };
    return true;
  }
  updateInvitation(now: number, valid: boolean): 'expired' | 'separated' | null {
    if (!this.invitation) return null;
    const reason = now >= this.invitation.expiresAt ? 'expired' : !valid ? 'separated' : null;
    if (reason) this.cancel();
    return reason;
  }
  accept(actor: PairActor, now: number, valid: boolean): boolean {
    const invitation = this.invitation;
    if (!invitation || actor !== invitation.to) return false;
    if (this.updateInvitation(now, valid)) return false;
    this.session = { kind: invitation.kind, from: invitation.from, to: invitation.to,
      stage: invitation.kind === 'rps' ? 'choosing' : 'aligning', acceptedAt: now, elapsed: 0, duration: 0 };
    this.invitation = null;
    return true;
  }
  choose(actor: PairActor, choice: RpsChoice): boolean {
    if (this.session?.kind !== 'rps' || this.session.stage !== 'choosing' || this.choices.has(actor)
      || !Object.hasOwn(RPS_LABELS, choice)) return false;
    this.choices.set(actor, choice);
    if (this.choices.size === 2) this.session.stage = 'aligning';
    return true;
  }
  hasChosen(actor: PairActor): boolean { return this.choices.has(actor); }
  beginPlayback(duration?: number): boolean {
    if (!this.session || this.session.stage !== 'aligning') return false;
    this.session.stage = 'playing'; this.session.elapsed = 0;
    this.session.duration = duration ?? (this.session.kind === 'rps' ? 3.85 : this.session.kind === 'high-five' ? 2.8 : 2.5);
    return true;
  }
  advance(delta: number): void {
    if (this.session?.stage === 'playing') this.session.elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0);
  }
  visibleChoices(): { player: RpsChoice; npc: RpsChoice } | null {
    if (this.session?.kind !== 'rps' || this.session.stage !== 'playing' || this.session.elapsed < RPS_REVEAL_SECONDS) return null;
    const player = this.choices.get('player'), npc = this.choices.get('npc');
    return player && npc ? { player, npc } : null;
  }
  cancel(): void { this.invitation = null; this.session = null; this.choices.clear(); }
}
