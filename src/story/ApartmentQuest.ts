import { copyJourney, freshJourney, GasJourneyTrigger, validJourney, type PostComputerJourney } from './PostComputerJourney';
import type { Vec3Data } from '../world/types';
import type { HallArrivalState } from '../core/SaveHistory';

export const RENT_MAIL_ID = 'regie-prelevement';
/** Recorded with the read mails once the bank balance page has really been shown. */
export const BANK_PAGE_ID = 'web-banque-solde';
export const GAS_THOUGHT = 'Je devrais éteindre le gaz.';
/** Use the imported doorway, not the older procedural apartment rectangle. */
export function hasEnteredApartment(position: Readonly<{ x: number; y: number; z: number }>,
  doorway: Readonly<{ x: number; z: number }>, floorY: number): boolean {
  return Math.abs(position.y - floorY - .865) < 1.4 && position.x < doorway.x - .15
    && position.x > doorway.x - 20 && Math.abs(position.z - doorway.z) < 20;
}
export type ComputerStage = 'inbox' | 'account' | 'game' | 'done';
export type ThoughtId = 'home' | 'light' | 'gas' | 'devices' | 'mail' | 'bank' | 'mines';
export interface ApartmentProgress {
  readonly version: 1;
  lightOn: boolean; lightSeen: boolean; gasOn: boolean; gasSeen: boolean;
  tvOn: boolean; tvSeen: boolean; radioOn: boolean; radioSeen: boolean;
  pcUsed: boolean; firstGameFinished: boolean; outageTriggered: boolean;
  /** Legacy-compatible played narration seconds; never a blackout timer. */
  outageLeadSeconds: number;
  journey?: PostComputerJourney;
  radioTrack: number; whiskyBroken: boolean; spoken: ThoughtId[];
}
export interface ComputerProgress {
  readonly homeReached: boolean;
  readonly stage: ComputerStage;
  readonly readMailIds: readonly string[];
  readonly apartment?: ApartmentProgress;
}
const THOUGHT_IDS: ThoughtId[] = ['home', 'light', 'gas', 'devices', 'mail', 'bank', 'mines'];
const BOOLS = ['lightOn', 'lightSeen', 'gasOn', 'gasSeen', 'tvOn', 'tvSeen', 'radioOn', 'radioSeen',
  'pcUsed', 'firstGameFinished', 'outageTriggered', 'whiskyBroken'] as const;
const freshState = (): ApartmentProgress => ({ version: 1, lightOn: false, lightSeen: false, gasOn: false,
  gasSeen: false, tvOn: false, tvSeen: false, radioOn: false, radioSeen: false, pcUsed: false,
  firstGameFinished: false, outageTriggered: false, outageLeadSeconds: -1, radioTrack: 0, whiskyBroken: false, spoken: [] });

export function sanitizeComputerProgress(value: unknown): ComputerProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !['homeReached', 'stage', 'readMailIds', 'apartment'].includes(key))
    || typeof v.homeReached !== 'boolean' || !['inbox', 'account', 'game', 'done'].includes(v.stage as string)
    || !Array.isArray(v.readMailIds) || v.readMailIds.length > 64
    || v.readMailIds.some(id => typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id))) return null;
  if (v.stage !== 'inbox' && (!v.homeReached || !v.readMailIds.includes(RENT_MAIL_ID))) return null;
  let apartment: ApartmentProgress | undefined;
  if (v.apartment !== undefined) {
    const a = v.apartment as ApartmentProgress;
    if (!a || typeof a !== 'object' || Array.isArray(a) || a.version !== 1
      || Object.keys(a).some(key => !['version', ...BOOLS, 'outageLeadSeconds', 'radioTrack', 'spoken', 'journey'].includes(key))
      || (a.journey!==undefined&&!validJourney(a.journey))
      || BOOLS.some(key => typeof a[key] !== 'boolean')
      || !Number.isFinite(a.outageLeadSeconds) || a.outageLeadSeconds < -1 || a.outageLeadSeconds > 30
      || (a.outageLeadSeconds < 0 && a.outageLeadSeconds !== -1)
      || !Number.isInteger(a.radioTrack) || a.radioTrack < 0 || a.radioTrack > 3
      || !Array.isArray(a.spoken) || a.spoken.length > THOUGHT_IDS.length || a.spoken.some(id => !THOUGHT_IDS.includes(id))
      || (a.outageTriggered && !a.firstGameFinished)
      || (a.firstGameFinished && (v.stage !== 'done' || !v.readMailIds.includes(RENT_MAIL_ID)))
      || (a.firstGameFinished && (!v.homeReached || !a.lightSeen || !a.gasSeen || !a.tvSeen || !a.radioSeen))
      || (a.spoken.includes('mines') !== (a.outageLeadSeconds >= 0))
      || (a.outageTriggered && a.outageLeadSeconds <= 0)
      || (!a.firstGameFinished && a.outageLeadSeconds !== -1)) return null;
    apartment = { ...a, spoken: [...new Set(a.spoken)],...(a.journey?{journey:copyJourney(a.journey)}:{}) };
  }
  return { homeReached: v.homeReached, stage: v.stage as ComputerStage, readMailIds: [...new Set(v.readMailIds)],
    ...(apartment ? { apartment } : {}) };
}

/** Monotonic completed actions, separate from each device's current physical
 * state. No objective requires cycling an appliance that is already switched on. */
export class ApartmentQuest {
  private progress: Omit<ComputerProgress, 'apartment'>;
  private readonly state: ApartmentProgress;
  private readonly gasTrigger=new GasJourneyTrigger();
  constructor(progress?: ComputerProgress, private readonly changed = () => {}, initialLight = false) {
    this.progress = progress ? { homeReached: progress.homeReached, stage: progress.stage, readMailIds: [...progress.readMailIds] }
      : { homeReached: false, stage: 'inbox', readMailIds: [] };
    this.state = progress?.apartment ? { ...progress.apartment, spoken: [...progress.apartment.spoken] } : freshState();
    // Saves from before the bank step had already reached the game: keep them there.
    if (progress && (progress.stage === 'game' || progress.stage === 'done') && !this.progress.readMailIds.includes(BANK_PAGE_ID)) {
      this.progress = { ...this.progress, readMailIds: [...this.progress.readMailIds, BANK_PAGE_ID] };
      if (!this.state.spoken.includes('bank') && this.state.spoken.includes('mail')) this.state.spoken.push('bank');
    }
    if (!progress?.apartment) {
      this.state.lightOn = initialLight; this.state.lightSeen = initialLight;
      this.state.pcUsed = !!progress?.readMailIds.length;
      // Old "done" only meant opening Minesweeper. It never proves a finished
      // game and must not trigger a blackout on loading a version-39 save.
      if (progress?.homeReached) this.state.spoken.push('home');
      if (progress?.stage !== undefined && progress.stage !== 'inbox') this.state.spoken.push('mail');
    }
    this.state.journey=progress?.apartment?.journey?copyJourney(progress.apartment.journey):freshJourney();
    // Consumed dialogue never starts again after loading, including old v47 saves.
    if(progress?.apartment?.spoken.includes('mines'))this.state.journey.thoughtFinished=true;
    this.reconcile();
  }
  get devices(): Readonly<ApartmentProgress> { return this.state; }
  get homeReached(): boolean { return this.progress.homeReached; }
  get isComputerBlocked(): boolean { return this.state.outageTriggered; }
  /** Stove first, then the TV and the radio: only then does the PC become usable. */
  get isComputerAvailable(): boolean { return this.state.gasSeen && this.state.tvSeen && this.state.radioSeen; }
  /** The TV and the radio wait for the meal to be on the stove. */
  get canUseMediaDevices(): boolean { return this.state.gasSeen || this.state.outageTriggered; }
  get bankChecked(): boolean { return this.progress.readMailIds.includes(BANK_PAGE_ID); }
  snapshot(): ComputerProgress {
    return { ...this.progress, readMailIds: [...this.progress.readMailIds], apartment: { ...this.state, spoken: [...this.state.spoken],journey:copyJourney(this.state.journey!) } };
  }
  private prerequisites(): boolean {
    return this.progress.homeReached && this.state.lightSeen && this.state.gasSeen && this.state.tvSeen && this.state.radioSeen;
  }
  private reconcile(): void {
    this.progress = { ...this.progress, stage: this.state.firstGameFinished ? 'done'
      : this.prerequisites() && this.progress.readMailIds.includes(RENT_MAIL_ID) ? this.bankChecked ? 'game' : 'account' : 'inbox' };
  }
  private commit(): void { this.reconcile(); this.changed(); }
  reachHome(): void {
    if (this.progress.homeReached) return;
    this.progress = { ...this.progress, homeReached: true }; this.commit();
  }
  setLight(on: boolean): void {
    if (this.state.outageTriggered || this.state.lightOn === on) return;
    this.state.lightOn = on; this.state.lightSeen ||= on; this.commit();
  }
  setGas(on: boolean): void {
    if (this.state.gasOn === on) return;
    this.state.gasOn = on; this.state.gasSeen ||= on; this.commit();
  }
  setTelevision(on: boolean): void {
    if (this.state.tvOn === on || (on && !this.canUseMediaDevices)) return;
    this.state.tvOn = on; this.state.tvSeen ||= on; this.commit();
  }
  setRadio(on: boolean): void {
    if (this.state.outageTriggered || this.state.radioOn === on || (on && !this.canUseMediaDevices)) return;
    this.state.radioOn = on; this.state.radioSeen ||= on; this.commit();
  }
  useComputer(): void { if (!this.state.pcUsed && this.isComputerAvailable) { this.state.pcUsed = true; this.commit(); } }
  setRadioTrack(track: number): void { this.state.radioTrack = track % 4; this.commit(); }
  breakWhisky(): void { if (!this.state.whiskyBroken) { this.state.whiskyBroken = true; this.commit(); } }
  readMail(id: string): void {
    if (this.progress.readMailIds.includes(id)) return;
    this.progress = { ...this.progress, readMailIds: [...this.progress.readMailIds, id].slice(-64) }; this.commit();
  }
  /** The tenant portal stays available; it is not the bank. */
  checkAccount(): void {}
  /** The bank balance page was actually displayed (only after the rent mail counts). */
  checkBank(): void {
    if (this.bankChecked || !this.progress.readMailIds.includes(RENT_MAIL_ID)) return;
    this.progress = { ...this.progress, readMailIds: [...this.progress.readMailIds, BANK_PAGE_ID].slice(-64) }; this.commit();
  }
  startGame(): void {}
  get canFinishGame(): boolean { return this.progress.stage === 'game' && !this.state.firstGameFinished; }
  finishGame(result: 'won' | 'lost'): void {
    if (!this.canFinishGame || !['won', 'lost'].includes(result)) return;
    this.state.firstGameFinished = true; this.commit();
  }
  nextThought(): { id: ThoughtId; text: string } | null {
    if (this.state.outageTriggered) return null;
    if (this.state.firstGameFinished && !this.state.spoken.includes('mines')) {
      this.state.spoken.push('mines'); this.state.outageLeadSeconds = 0;
      this.changed(); return { id: 'mines', text: this.interruptedThought };
    }
    if(this.state.firstGameFinished)return null;
    const rent = this.prerequisites() && this.progress.readMailIds.includes(RENT_MAIL_ID);
    const conditions = [this.progress.homeReached, this.progress.homeReached && this.state.lightSeen,
      this.progress.homeReached && this.state.lightSeen && this.state.gasSeen, this.prerequisites(),
      rent, rent && this.bankChecked, this.state.firstGameFinished];
    const text: Record<ThoughtId, string> = {
      home: this.state.lightOn ? 'Enfin chez moi…' : 'Enfin chez moi… Je vais allumer.',
      light: this.state.gasOn ? 'Le repas chauffe déjà.' : 'Je vais faire chauffer ça.',
      gas: this.state.tvOn && this.state.radioOn ? 'Un peu de bruit en attendant le repas.' : 'La télé et la radio, en attendant que ça chauffe.',
      devices: this.progress.readMailIds.includes(RENT_MAIL_ID) ? 'Le PC est encore allumé.' : 'Il faudrait que je vérifie mes mails.',
      mail: 'Encore ce loyer… Il faut que je regarde ce qu’il reste sur mon compte.',
      bank: 'Moins quarante-huit euros… Une partie de Démineur pour penser à autre chose.',
      mines: this.state.gasOn ? GAS_THOUGHT : 'Je vais vérifier le gaz.',
    };
    for (let i = 0; i < THOUGHT_IDS.length; i++) {
      const id = THOUGHT_IDS[i]!;
      if (!conditions[i] || this.state.spoken.includes(id)) continue;
      this.state.spoken.push(id);
      if (id === 'mines') this.state.outageLeadSeconds = 0;
      this.changed(); return { id, text: text[id] };
    }
    return null;
  }
  get interruptedThought(): string { return this.state.gasOn ? GAS_THOUGHT : 'Je vais vérifier le gaz.'; }
  advanceNarration(delta:number,finished:boolean):void {
    if(this.state.outageLeadSeconds<0||this.state.journey!.thoughtFinished)return;
    this.state.outageLeadSeconds=Math.min(30,this.state.outageLeadSeconds+Math.max(0,delta));
    if(finished){this.state.journey!.thoughtFinished=true;this.commit();}
  }
  requestQuickRise():boolean {
    const j=this.state.journey!;
    if(!j.thoughtFinished||j.riseRequested||this.state.outageTriggered)return false;
    j.riseRequested=true;this.commit();return true;
  }
  advanceOutage(position:Vec3Data,gas:Vec3Data,free:boolean):boolean {
    if(!this.state.firstGameFinished||this.state.outageTriggered||!this.gasTrigger.observe(this.state.journey!,position,gas,free))return false;
    this.state.outageTriggered = true;
    this.state.journey!.outageReactionConsumed=true;
    this.state.tvOn = true; this.state.radioOn = true; this.state.lightOn = true;
    this.commit(); return true;
  }
  objective(hall: HallArrivalState): string | null {
    if (hall === 'approach' || hall === 'mail') return 'Récupérer mon courrier dans le hall.';
    if (!this.progress.homeReached) return 'Rentrer dans mon appartement, au dernier étage.';
    if (!this.state.lightSeen) return 'Allumer la lumière de l’appartement.';
    if (!this.state.gasSeen) return 'Allumer le gaz sous la poêle.';
    if (!this.state.tvSeen || !this.state.radioSeen) return 'Allumer la TV et la radio en attendant le repas.';
    if (!this.progress.readMailIds.includes(RENT_MAIL_ID)) return 'Sur le PC, retrouver le mail de la régie.';
    if (!this.bankChecked) return 'Consulter le solde de mon compte bancaire sur Internet.';
    return this.state.firstGameFinished ? null : 'Terminer une première partie de Démineur.';
  }
}
