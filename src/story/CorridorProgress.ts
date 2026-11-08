import type { Vec3Data } from '../world/types';

export const CORRIDOR_LENGTH = 168;
export const CORRIDOR_SPACING = 4;
export const CORRIDOR_LAMPS = CORRIDOR_LENGTH / CORRIDOR_SPACING;
/** Lamp index i hangs at this distance from the apartment threshold. */
export const corridorLampDistance = (index: number): number => 2 + index * CORRIDOR_SPACING;
export const CORRIDOR_TRIGGER = 20;
/** Far enough to be a silhouette: ~94 m beyond the trigger point. */
export const BACTERIA_REVEAL_LAMP = 28;
export const CORRIDOR_REACTION_SECONDS = 4.4;
/** Played-time schedule. The wave is anchored to the apartment: lamp 0, by
 * the door, always lights first whatever the player's position. Intervals
 * shrink from ~.68 s to ~.07 s as it races down the corridor. */
export const corridorLampTime=(index:number,start=0):number=>{
  const n=Math.max(0,index-start);
  return CORRIDOR_REACTION_SECONDS+.06*n+.7*(1-Math.pow(.88,n))/.12;
};
/** After a death, the lamps around the checkpoint are already lit. */
export const CORRIDOR_RETRY_LAMP = 8;
export interface CorridorProgress {
  version: 1; active: boolean; distance: number; triggered: boolean;
  elapsed: number; returned: boolean; apartmentRelit: boolean;
  reactionPosition?: Vec3Data; reactionYaw?: number;
  entryConsumed?: boolean; waveStart?: number;
  bacteriaSurvived?: boolean;
  /** The breakers were thrown back on, in vain (after the lamp). */
  fuseTried?: boolean;
  /** The knocks at the closed entrance are over. */
  knockDone?: boolean;
}
export const freshCorridor = (): CorridorProgress => ({version:1,active:false,distance:0,triggered:false,elapsed:0,returned:false,apartmentRelit:false,entryConsumed:false});
export function sanitizeCorridor(value: unknown): CorridorProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v=value as CorridorProgress;
  if(v.bacteriaSurvived!==undefined&&(typeof v.bacteriaSurvived!=='boolean'||(v.bacteriaSurvived&&!v.returned)))return null;
  if(v.fuseTried!==undefined&&typeof v.fuseTried!=='boolean'||v.knockDone!==undefined&&(typeof v.knockDone!=='boolean'||(v.knockDone&&!v.fuseTried)))return null;
  if(v.entryConsumed!==undefined&&typeof v.entryConsumed!=='boolean'||v.waveStart!==undefined&&(!Number.isInteger(v.waveStart)||v.waveStart<0||v.waveStart>=CORRIDOR_LAMPS))return null;
  if(v.version!==1 || !['active','triggered','returned','apartmentRelit'].every(k=>typeof (v as unknown as Record<string,unknown>)[k]==='boolean')
    || !Number.isFinite(v.distance)||v.distance<0||v.distance>CORRIDOR_LENGTH+1
    || !Number.isFinite(v.elapsed)||v.elapsed<0||v.elapsed>90
    || (v.triggered&&(!v.active||v.distance<CORRIDOR_TRIGGER||!v.apartmentRelit)) || (v.returned&&!v.triggered)
    || (!v.triggered&&(v.elapsed!==0||v.apartmentRelit)))return null;
  if(v.triggered&&(!v.reactionPosition||!['x','y','z'].every(k=>Number.isFinite(v.reactionPosition![k as keyof Vec3Data])&&Math.abs(v.reactionPosition![k as keyof Vec3Data])<2000)||!Number.isFinite(v.reactionYaw)))return null;
  return {...v,...(v.reactionPosition?{reactionPosition:{...v.reactionPosition}}:{})};
}
/** One played-time clock. A restored triggered state never emits the sound event. */
export class CorridorStory {
  readonly state: CorridorProgress;
  private previousPosition?:Vec3Data;
  constructor(saved?: CorridorProgress){this.state=saved?{...saved,entryConsumed:saved.entryConsumed??saved.distance>.7,...(saved.reactionPosition?{reactionPosition:{...saved.reactionPosition}}:{})}:freshCorridor();}
  /** Saves from before the breaker scene, already out in the corridor: it happened. */
  private get legacyPastFuse():boolean{return this.state.fuseTried===undefined&&(!!this.state.entryConsumed||this.state.triggered);}
  get fuseDone():boolean{return this.state.fuseTried===true||this.legacyPastFuse;}
  get knockDone():boolean{return this.state.knockDone===true||this.legacyPastFuse;}
  /** First failed re-arm: returns true once. */
  tryFuse():boolean{if(this.fuseDone)return false;this.state.fuseTried=true;return true;}
  finishKnock():void{if(this.state.fuseTried)this.state.knockDone=true;}
  /** Lamp taken but the breaker scene (and the knocks) not over: the door stays a hesitation. */
  get beforeExploring():boolean{return this.state.active&&!this.state.triggered&&!(this.fuseDone&&this.knockDone);}
  activate(): boolean {if(this.state.active)return false;this.state.active=true;return true;}
  observe(position:Vec3Data,door:Vec3Data,hasLamp:boolean,yaw:number):boolean {
    const s=this.state;if(!s.active||!hasLamp)return false;
    if(s.triggered){if(s.returned&&Math.abs(position.z-door.z)<2.28&&Math.abs(position.y-door.y-.865)<.55)s.distance=Math.max(s.distance,Math.min(CORRIDOR_LENGTH,position.x-door.x));return false;}
    const previous=this.previousPosition;this.previousPosition={...position};
    const axial=position.x-door.x;
    if(Math.abs(position.y-door.y-.865)>.55||Math.abs(position.z-door.z)>2.28||axial<0||axial>CORRIDOR_LENGTH)return false;
    if(!previous)return false;const step=Math.hypot(position.x-previous.x,position.z-previous.z);
    if(step>.7)return false;
    s.distance=Math.max(s.distance,Math.min(axial,s.distance+Math.max(0,position.x-previous.x)));
    if(axial<CORRIDOR_TRIGGER||s.distance<CORRIDOR_TRIGGER-.12)return false;
    s.triggered=true;s.apartmentRelit=true;s.waveStart=0;s.reactionPosition={...position,y:door.y+.865};s.reactionYaw=yaw;return true;
  }
  consumeEntry():boolean{if(this.state.entryConsumed||this.state.distance<.7)return false;this.state.entryConsumed=true;return true;}
  /** Older saves stored the player's lamp here; the wave now always starts at the apartment. */
  get firstLamp():number{return 0;}
  get bacteriaPending(): boolean { return this.state.returned && !this.state.bacteriaSurvived; }
  /** Anywhere in the corridor once the wave has passed the player (or after a retry). */
  canStartBacteria(position: Vec3Data, threshold: Vec3Data): boolean {
    const distance = position.x - threshold.x;
    return this.bacteriaPending && Math.abs(position.y - threshold.y - .865) < .55
      && Math.abs(position.z - threshold.z) < 2.28 && distance >= 4 && distance <= corridorLampDistance(BACTERIA_REVEAL_LAMP) - 30;
  }
  rewindBacteria(): void {
    this.state.elapsed = Math.min(this.state.elapsed, corridorLampTime(CORRIDOR_RETRY_LAMP));
  }
  completeBacteria(): void { this.state.bacteriaSurvived = true; }
  update(delta:number,playing:boolean):boolean {
    const s=this.state;if(!playing||!s.triggered)return false;
    s.elapsed=Math.min(90,s.elapsed+Math.max(0,delta));
    if(!s.returned&&this.litCount>Math.floor(s.distance/CORRIDOR_SPACING)) {s.returned=true;return true;}return false;
  }
  get litCount():number {
    if(!this.state.triggered||this.state.elapsed<CORRIDOR_REACTION_SECONDS)return 0;
    let end=this.firstLamp;
    while(end<CORRIDOR_LAMPS&&this.state.elapsed>=corridorLampTime(end,this.firstLamp))end++;
    return end;
  }
  get modal():boolean{return this.state.triggered&&!this.state.returned;}
  get finished():boolean{return this.litCount===CORRIDOR_LAMPS;}
  objective(hasLamp:boolean):string|null {
    if(!this.state.active)return null;
    if(!hasLamp)return 'Récupérer la lampe torche sur le bureau';
    if(this.state.bacteriaSurvived)return 'Descendre jusqu’à la porte du hall.';
    if(!this.state.triggered){
      if(!this.fuseDone)return 'Trouver le tableau électrique et réarmer les disjoncteurs.';
      return this.knockDone?'Sortir chercher les voisins.':null;
    }
    return this.finished?null:this.state.returned?'Observer les lumières au fond du couloir':'… D’où vient cette lumière ?';
  }
  snapshot():CorridorProgress{return {...this.state,...(this.state.reactionPosition?{reactionPosition:{...this.state.reactionPosition}}:{})};}
}
