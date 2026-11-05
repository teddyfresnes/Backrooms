import { SeededRandom } from '../world/SeededRandom';
import type { CharacterVoiceId } from '../audio/VoiceCatalog';
import type { NeighborCue } from '../audio/NeighborVoice';
import { PLAYER_APARTMENT_DOOR_ID } from '../apartment/DoorIdentity';

export const SPECIAL_NEIGHBOR_DOOR = 'east-neighbor-door-0-leaf';
export type NeighborProfile = 'silent' | 'refusal' | 'nonverbal' | 'varied' | 'special';
const PROFILES: Readonly<Record<string, NeighborProfile>> = {
  'west-neighbor-door-0-leaf': 'silent', 'east-neighbor-door-0-leaf': 'special',
  'west-neighbor-door-1-leaf': 'refusal', 'east-neighbor-door-1-leaf': 'nonverbal',
  'west-neighbor-door-2-leaf': 'varied', 'east-neighbor-door-2-leaf': 'silent',
  'east-neighbor-door-3-leaf': 'varied', 'north-neighbor-door-0-leaf': 'nonverbal',
  'north-neighbor-door-1-leaf': 'silent', 'north-neighbor-door-2-leaf': 'refusal',
};
// Short French adaptations of each recorded intention. A cough stays a cough,
// a soft apology never becomes a threat, emphatic refusals carry the hostility.
const LINES: readonly {text:string; cue:NeighborCue; level:number; bellOnly?:boolean; nonverbal?:boolean}[] = [
  {text:'Hmm ? Oui ?',cue:'hmm',level:0},
  {text:'Hmm… C’est pour quoi ?',cue:'hmm',level:0},
  {text:'Désolé. Pas maintenant.',cue:'refusal-3',level:0},
  {text:'Je peux pas, là.',cue:'refusal-5',level:0},
  {text:'Non, merci.',cue:'refusal-7',level:0},
  {text:'Nan…',cue:'refusal-8',level:0},
  {text:'Non. Pas ce soir.',cue:'refusal-1',level:1},
  {text:'Ça m’intéresse pas.',cue:'refusal-7',level:1},
  {text:'Pas question.',cue:'refusal-2',level:1},
  {text:'Non. Laissez-moi dormir.',cue:'refusal-6',level:1},
  {text:'Nan. Laisse tomber.',cue:'refusal-8',level:1},
  {text:'Ça va pas être possible.',cue:'refusal-9',level:1},
  {text:'Non, putain !',cue:'refusal-1',level:2},
  {text:'Même pas en rêve, merde.',cue:'refusal-2',level:2},
  {text:'Non. Fous-moi la paix.',cue:'refusal-6',level:2},
  {text:'Nan. Va te faire foutre.',cue:'refusal-8',level:2},
  {text:'Pas moyen. Dégage.',cue:'refusal-4',level:2},
  {text:'Jamais. Va chier.',cue:'refusal-10',level:2},
  {text:'Non ! Je vais sortir, putain !',cue:'refusal-1',level:3},
  {text:'Hors de question. Fous le camp !',cue:'refusal-2',level:3},
  {text:'Non ! Tu vas le regretter.',cue:'refusal-6',level:3},
  {text:'Nan, putain… casse-toi.',cue:'refusal-8',level:3},
  {text:'Jamais, putain. Jamais !',cue:'refusal-10',level:3},
  {text:'Pas moyen. Va te faire foutre.',cue:'refusal-4',level:3},
  {text:'Non. Lâche cette sonnette !',cue:'refusal-1',level:2,bellOnly:true},
  {text:'Nan. Va sonner ailleurs, putain.',cue:'refusal-8',level:3,bellOnly:true},
  {text:'[Raclement de gorge derrière la porte]',cue:'miscellaneous-13',level:0,nonverbal:true},
  {text:'[Toux étouffée]',cue:'miscellaneous-15',level:0,nonverbal:true},
];
export const NEIGHBOR_LINES = LINES.map(line=>line.text);
export function neighborProfile(id:string):NeighborProfile { return id===PLAYER_APARTMENT_DOOR_ID?'silent':PROFILES[id] ?? 'silent'; }
export function neighborActor(id:string, player:CharacterVoiceId):CharacterVoiceId {
  const actors = (['karen','ian','sean','meghan','alex'] as const).filter(actor=>actor!==player);
  return actors[new SeededRandom(`neighbor-actor:${id}`).int(0, actors.length-1)]!;
}
export function neighborReply(id:string, cursor:number, kind:'knock'|'bell'='knock', annoyance=0, previous=-1) {
  const profile = neighborProfile(id);
  if (profile==='silent') return null;
  const temperament=profile==='refusal'||profile==='special'?1:0;
  const level=Math.min(3,Math.floor(annoyance/3.2)+temperament);
  const random=new SeededRandom(`neighbor-response:${id}:${cursor}:${level}`);
  const nonverbal=profile==='nonverbal'&&level<2;
  if(profile==='nonverbal'&&annoyance<2&&cursor%3===2)return null;
  const candidates=LINES.map((line,index)=>({...line,index})).filter(line=>
    !!line.nonverbal===nonverbal && (nonverbal||line.level===level) && (!line.bellOnly||kind==='bell') && line.index!==previous);
  const priorCue=LINES[previous]?.cue;
  const distinct=candidates.filter(line=>line.cue!==priorCue);
  const pool=distinct.length?distinct:candidates;
  const line=pool[random.int(0,pool.length-1)]!;
  const delay=annoyance>5 ? random.float(.3,1.25) : random.float(.65,2.65);
  return {...line,nonverbal:!!line.nonverbal,delay,delivery:!line.nonverbal&&level>=2&&cursor%3===0?'mutter' as const:'normal' as const};
}
