import { actionKeyCodes, formatKeyLabel, type ControlBindings } from '../input/ControlBindings';

export const sprintHintText=(bindings:ControlBindings):string=>{
  const keys=actionKeyCodes(bindings,'sprint');
  return keys.includes('ShiftLeft')&&keys.includes('ShiftRight')?'Maj pour courir':`${formatKeyLabel(bindings.sprint)} ou Maj droite pour courir`;
};
export class SprintHint {
  private readonly element=document.createElement('div');
  private remaining=0;
  constructor(container:HTMLElement){this.element.className='carry-hint sprint-hint';this.element.style.bottom='clamp(11rem,25vh,15rem)';this.element.setAttribute('role','status');this.element.hidden=true;container.append(this.element);}
  show(bindings:ControlBindings):void{this.element.textContent=sprintHintText(bindings);this.remaining=5;}
  update(delta:number,playing:boolean):void{if(playing)this.remaining=Math.max(0,this.remaining-delta);this.element.hidden=!playing||this.remaining<=0;}
  dispose():void{this.element.remove();}
}
