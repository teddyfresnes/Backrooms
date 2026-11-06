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
// Short French adaptations of each recorded intention, in five tiers of
// irritation (the last one shouted). A cough stays a cough; only the fifth
// tier is written in capitals.
const LINES: readonly {text:string; cue:NeighborCue; level:number; bellOnly?:boolean; nonverbal?:boolean; final?:boolean}[] = [
  {text:'Hmm ? Oui ?',cue:'hmm',level:0},
  {text:'Hmm… C’est pour quoi ?',cue:'refusal-3',level:0},
  {text:'Désolé. Pas maintenant.',cue:'refusal-5',level:0},
  {text:'Je peux pas, là.',cue:'refusal-7',level:0},
  {text:'Non, merci.',cue:'refusal-8',level:0},
  {text:'Nan…',cue:'hmm',level:0},
  {text:'Qui c’est ?',cue:'refusal-3',level:0},
  {text:'Il est tard, vous savez.',cue:'refusal-5',level:0},
  {text:'C’est une erreur, je crois.',cue:'refusal-7',level:0},
  {text:'Vous êtes qui ?',cue:'refusal-8',level:0},
  {text:'On n’attend personne.',cue:'hmm',level:0},
  {text:'Je dors, là.',cue:'refusal-3',level:0},
  {text:'Allez voir le gardien.',cue:'refusal-5',level:0},
  {text:'Repassez demain.',cue:'refusal-7',level:0},
  {text:'J’ouvre pas à cette heure-ci.',cue:'refusal-8',level:0},
  {text:'C’est pas le bon étage.',cue:'hmm',level:0},
  {text:'Laissez un mot dans la boîte.',cue:'refusal-3',level:0},
  {text:'Non. Pas ce soir.',cue:'refusal-1',level:1},
  {text:'Ça m’intéresse pas.',cue:'refusal-7',level:1},
  {text:'Pas question.',cue:'refusal-2',level:1},
  {text:'Non. Laissez-moi dormir.',cue:'refusal-6',level:1},
  {text:'Nan. Laisse tomber.',cue:'refusal-8',level:1},
  {text:'Ça va pas être possible.',cue:'refusal-9',level:1},
  {text:'J’ai dit non.',cue:'refusal-1',level:1},
  {text:'Vous comprenez pas, ou quoi ?',cue:'refusal-7',level:1},
  {text:'Arrêtez de frapper.',cue:'refusal-2',level:1},
  {text:'C’est bon, là. Partez.',cue:'refusal-6',level:1},
  {text:'Vous savez l’heure qu’il est ?',cue:'refusal-8',level:1},
  {text:'Allez, circulez.',cue:'refusal-9',level:1},
  {text:'Ça commence à bien faire.',cue:'refusal-1',level:1},
  {text:'Encore vous ?',cue:'refusal-7',level:1},
  {text:'Non, et c’est tout.',cue:'refusal-2',level:1},
  {text:'Je vais pas ouvrir.',cue:'refusal-6',level:1},
  {text:'Faites pas ça à cette heure-là.',cue:'refusal-8',level:1},
  {text:'Non, putain !',cue:'refusal-1',level:2},
  {text:'Même pas en rêve, merde.',cue:'refusal-2',level:2},
  {text:'Non. Fous-moi la paix.',cue:'refusal-6',level:2},
  {text:'Nan. Va te faire foutre.',cue:'refusal-8',level:2},
  {text:'Pas moyen. Dégage.',cue:'refusal-4',level:2},
  {text:'Jamais. Va chier.',cue:'refusal-10',level:2},
  {text:'Tu fais chier, là.',cue:'refusal-1',level:2},
  {text:'Putain, mais dégage !',cue:'refusal-2',level:2},
  {text:'T’es sourd ou quoi ?',cue:'refusal-6',level:2},
  {text:'Arrête de cogner, connard.',cue:'refusal-8',level:2},
  {text:'Je vais m’énerver, là.',cue:'refusal-4',level:2},
  {text:'Barre-toi de ma porte.',cue:'refusal-10',level:2},
  {text:'Mais c’est pas vrai, ce mec…',cue:'refusal-1',level:2},
  {text:'Lâche cette porte, abruti.',cue:'refusal-2',level:2},
  {text:'T’as rien de mieux à foutre ?',cue:'refusal-6',level:2},
  {text:'J’appelle les flics, je te préviens.',cue:'refusal-8',level:2},
  {text:'Encore un coup et je sors.',cue:'refusal-4',level:2},
  {text:'Non ! Je vais sortir, putain !',cue:'refusal-1',level:3},
  {text:'Hors de question. Fous le camp !',cue:'refusal-2',level:3},
  {text:'Non ! Tu vas le regretter.',cue:'refusal-6',level:3},
  {text:'Nan, putain… casse-toi.',cue:'refusal-8',level:3},
  {text:'Jamais, putain. Jamais !',cue:'refusal-10',level:3},
  {text:'Pas moyen. Va te faire foutre.',cue:'refusal-4',level:3},
  {text:'Je vais te défoncer la gueule !',cue:'refusal-1',level:3},
  {text:'Fils de pute, je sais où t’habites.',cue:'refusal-2',level:3},
  {text:'Je te jure que je vais t’éclater.',cue:'refusal-6',level:3},
  {text:'Continue, pour voir. Continue !',cue:'refusal-8',level:3},
  {text:'T’es un homme mort, toi.',cue:'refusal-10',level:3},
  {text:'Je sors et je te casse les dents !',cue:'refusal-4',level:3},
  {text:'Tu vas pleurer ta mère, enfoiré !',cue:'refusal-1',level:3},
  {text:'Encore une fois et t’es fini.',cue:'refusal-2',level:3},
  {text:'Je vais t’arracher la tête, connard !',cue:'refusal-6',level:3},
  {text:'Dernier avertissement, sale merde.',cue:'refusal-8',level:3},
  {text:'Tu cherches la mort, toi ?',cue:'refusal-10',level:3},
  {text:'DÉGAGE DE MA PORTE !',cue:'refusal-1',level:4},
  {text:'MAIS TU VAS ARRÊTER, PUTAIN ?!',cue:'refusal-2',level:4},
  {text:'VA TE FAIRE FOUTRE, ENFOIRÉ !',cue:'refusal-4',level:4},
  {text:'JE VAIS TE TUER !',cue:'refusal-6',level:4},
  {text:'CASSE-TOI, FILS DE PUTE !',cue:'refusal-8',level:4},
  {text:'ARRÊTE ! ARRÊTE ! ARRÊTE !',cue:'refusal-10',level:4},
  {text:'T’ES MORT, T’ENTENDS ? MORT !',cue:'refusal-1',level:4},
  {text:'JE VAIS SORTIR ET TU VAS CREVER !',cue:'refusal-2',level:4},
  {text:'PUTAIN DE MERDE, DÉGAGE !',cue:'refusal-4',level:4},
  {text:'UN COUP DE PLUS ET JE TE BUTE !',cue:'refusal-6',level:4},
  {text:'TU L’AURAS VOULU, CONNARD !',cue:'refusal-8',level:4},
  {text:'J’EN PEUX PLUS DE TOI !',cue:'refusal-10',level:4},
  {text:'LAISSE-MOI TRANQUILLE, MALADE !',cue:'refusal-1',level:4},
  {text:'JE VAIS TE DÉMOLIR !',cue:'refusal-2',level:4},
  {text:'FOUS LE CAMP OU JE TE CREVE !',cue:'refusal-4',level:4},
  {text:'VA CREVER AILLEURS !',cue:'refusal-6',level:4},
  {text:'Non. Lâche cette sonnette !',cue:'refusal-1',level:2,bellOnly:true},
  {text:'Arrête de sonner, bordel.',cue:'refusal-2',level:2,bellOnly:true},
  {text:'Nan. Va sonner ailleurs, putain.',cue:'refusal-1',level:3,bellOnly:true},
  {text:'Touche encore à cette sonnette et je te la fais bouffer.',cue:'refusal-2',level:3,bellOnly:true},
  {text:'LÂCHE CETTE PUTAIN DE SONNETTE !',cue:'refusal-1',level:4,bellOnly:true},
  {text:'[Raclement de gorge derrière la porte]',cue:'miscellaneous-13',level:0,nonverbal:true},
  {text:'[Toux étouffée]',cue:'miscellaneous-15',level:0,nonverbal:true},
  {text:'[Quelqu’un s’approche du judas, puis plus rien]',cue:'miscellaneous-13',level:0,nonverbal:true},
  {text:'Je vais lui montrer, à ce fils de pute.',cue:'refusal-6',level:5,final:true},
  {text:'Henry, va chercher le flingue !',cue:'refusal-10',level:5,final:true},
  {text:'Bouge pas. J’arrive.',cue:'refusal-1',level:5,final:true},
  {text:'Ok. Tu l’auras voulu.',cue:'refusal-4',level:5,final:true},
  {text:'Chérie, passe-moi le calibre.',cue:'refusal-6',level:5,final:true},
  {text:'Attends un peu, toi…',cue:'refusal-10',level:5,final:true},
  {text:'Tu vas voir ce que ça fait.',cue:'refusal-1',level:5,final:true},
  {text:'Reste là. Reste juste là.',cue:'refusal-4',level:5,final:true},
];
export const NEIGHBOR_LINES = LINES.map(line=>line.text);
export function neighborProfile(id:string):NeighborProfile { return id===PLAYER_APARTMENT_DOOR_ID?'silent':PROFILES[id] ?? 'silent'; }
export function neighborActor(id:string, player:CharacterVoiceId):CharacterVoiceId {
  const actors = (['karen','ian','sean','meghan','alex'] as const).filter(actor=>actor!==player);
  return actors[new SeededRandom(`neighbor-actor:${id}`).int(0, actors.length-1)]!;
}
/** The exchange (1-based) at which a resident stops talking and comes to the door armed. */
export function neighborBreakingPoint(id:string):number {
  return new SeededRandom(`neighbor-breaking-point:${id}`).int(10,15);
}
/** Irritation tier 0..4 from the exchanges actually answered, raised by a spam burst. */
export function neighborTier(id:string,cursor:number,annoyance=0):number {
  const profile=neighborProfile(id),temperament=profile==='refusal'||profile==='special'?1:0;
  const fromExchanges=Math.floor(Math.max(0,cursor-1)*5/Math.max(1,neighborBreakingPoint(id)-1));
  return Math.min(4,Math.max(fromExchanges,Math.floor(annoyance/4))+temperament);
}
export function neighborReply(id:string, cursor:number, kind:'knock'|'bell'='knock', annoyance=0, previous=-1, recent:readonly number[]=[]) {
  const profile = neighborProfile(id);
  if (profile==='silent') return null;
  const breaking=neighborBreakingPoint(id);
  // Past the threat, nobody answers any more.
  if(cursor>breaking)return null;
  const random=new SeededRandom(`neighbor-response:${id}:${cursor}:${annoyance.toFixed(1)}`);
  if(cursor===breaking&&profile!=='special'){
    const finals=LINES.map((line,index)=>({...line,index})).filter(line=>line.final);
    const fresh=finals.filter(line=>line.cue!==LINES[previous]?.cue),options=fresh.length?fresh:finals;
    const line=options[new SeededRandom(`neighbor-threat:${id}`).int(0,options.length-1)]!;
    return {...line,nonverbal:false,final:true,delay:random.float(.35,.8),delivery:'normal' as const};
  }
  const level=neighborTier(id,cursor,annoyance);
  const nonverbal=profile==='nonverbal'&&level<1;
  if(profile==='nonverbal'&&level<1&&cursor%3===2)return null;
  const candidates=LINES.map((line,index)=>({...line,index})).filter(line=>!line.final&&
    !!line.nonverbal===nonverbal && (nonverbal||line.level===level) && (!line.bellOnly||kind==='bell') && line.index!==previous);
  const priorCue=LINES[previous]?.cue;
  const fresh=candidates.filter(line=>!recent.includes(line.index)&&line.cue!==priorCue);
  const pool=fresh.length?fresh:candidates.filter(line=>line.cue!==priorCue).length?candidates.filter(line=>line.cue!==priorCue):candidates;
  const line=pool[random.int(0,pool.length-1)]!;
  const delay=level>=3||annoyance>5 ? random.float(.3,1.1) : random.float(.65,2.4);
  return {...line,nonverbal:!!line.nonverbal,final:false,delay,delivery:!line.nonverbal&&level>=2&&level<4&&cursor%3===0?'mutter' as const:'normal' as const};
}
