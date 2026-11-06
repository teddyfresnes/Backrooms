/** Shared presentation clock: reveal the essential thought, leave reading time,
 * then interrupt before its last word. No wall-clock timer or DOM timeout. */
export const CAPTION_CHARACTER_SECONDS=.042;
export interface InterruptionProgress {elapsed:number;visibleCharacters:number;totalCharacters:number;readingSeconds:number;canInterrupt:boolean}
export function interruptionPlan(text:string):{holdAt:number;cutAt:number;holdSeconds:number;cutTime:number}{
  const letters=Array.from(text),last=text.trim().replace(/[….!?]+$/u,'').lastIndexOf(' '),gas=text.indexOf('gaz');
  const holdAt=gas>=0?gas+3:Math.min(letters.length-5,Math.max(10,Math.floor(letters.length*.67)));
  const cutAt=Math.max(holdAt,Math.min(letters.length-2,last>0?last:letters.length-3));
  const words=letters.slice(0,holdAt).join('').trim().split(/\s+/u).length;
  const holdSeconds=Math.max(1.35,words/3.1);
  return{holdAt,cutAt,holdSeconds,cutTime:cutAt*CAPTION_CHARACTER_SECONDS+holdSeconds};
}
export function interruptionProgress(text:string,elapsed:number,reduced=false):InterruptionProgress {
  const plan=interruptionPlan(text),time=Math.max(0,elapsed),holdStart=plan.holdAt*CAPTION_CHARACTER_SECONDS;
  const revealTime=time-Math.min(plan.holdSeconds,Math.max(0,time-holdStart));
  const visible=reduced?plan.cutAt:Math.min(plan.cutAt,Math.floor((revealTime+1e-7)/CAPTION_CHARACTER_SECONDS));
  return{elapsed:time,visibleCharacters:visible,totalCharacters:Array.from(text).length,readingSeconds:Math.max(0,Math.min(plan.holdSeconds,time-holdStart)),canInterrupt:time+1e-7>=plan.cutTime&&visible>=plan.cutAt};
}
