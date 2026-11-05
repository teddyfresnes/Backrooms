import type { Vec3Data } from '../world/types';

export const CORRIDOR_LENGTH = 168;
export const CORRIDOR_SPACING = 4;
export const CORRIDOR_LAMPS = CORRIDOR_LENGTH / CORRIDOR_SPACING;
export const CORRIDOR_TRIGGER = 20;
export const BACTERIA_REVEAL_LAMP = 10;
export const CORRIDOR_REACTION_SECONDS = 4.4;
/** Decreasing intervals, from .98 s to about .10 s; one played-time schedule. */
export const corridorLampTime=(index:number,start=0):number=>{
  const n=Math.max(0,index-start);
  return CORRIDOR_REACTION_SECONDS+.08*n+.9*(1-Math.pow(.90,n))/.1;
};
export interface CorridorProgress {
  version: 1; active: boolean; distance: number; triggered: boolean;
  elapsed: number; returned: boolean; apartmentRelit: boolean;
  reactionPosition?: Vec3Data; reactionYaw?: number;
  entryConsumed?: boolean; waveStart?: number;
  bacteriaSurvived?: boolean;
}
export const freshCorridor = (): CorridorProgress => ({version:1,active:false,distance:0,triggered:false,elapsed:0,returned:false,apartmentRelit:false,entryConsumed:false});
export function sanitizeCorridor(value: unknown): CorridorProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v=value as CorridorProgress;
  if(v.bacteriaSurvived!==undefined&&(typeof v.bacteriaSurvived!=='boolean'||(v.bacteriaSurvived&&!v.returned)))return null;
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
    s.triggered=true;s.apartmentRelit=true;s.waveStart=Math.max(0,Math.floor(axial/CORRIDOR_SPACING)-1);s.reactionPosition={...position,y:door.y+.865};s.reactionYaw=yaw;return true;
  }
  consumeEntry():boolean{if(this.state.entryConsumed||this.state.distance<.7)return false;this.state.entryConsumed=true;return true;}
  get firstLamp():number{return this.state.waveStart??0;}
  get bacteriaPending(): boolean { return this.state.returned && !this.state.bacteriaSurvived; }
  canStartBacteria(position: Vec3Data, threshold: Vec3Data): boolean {
    const distance = position.x - threshold.x;
    return this.bacteriaPending && Math.abs(position.y - threshold.y - .865) < .55
      && Math.abs(position.z - threshold.z) < 2.28 && distance >= CORRIDOR_TRIGGER - 2 && distance <= CORRIDOR_TRIGGER + 4;
  }
  rewindBacteria(): void {
    this.state.elapsed = corridorLampTime(this.firstLamp + 1, this.firstLamp);
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
    if(!this.state.triggered)return 'Sortir de l’appartement et explorer le couloir';
    return this.finished?null:this.state.returned?'Observer les lumières au fond du couloir':'… D’où vient cette lumière ?';
  }
  snapshot():CorridorProgress{return {...this.state,...(this.state.reactionPosition?{reactionPosition:{...this.state.reactionPosition}}:{})};}
}
