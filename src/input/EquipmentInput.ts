import type { ControlBindings } from './ControlBindings';
import { controlCodeFromKeyboardEvent } from './ControlBindings';
/** F remains a defensive combat modifier. Only an isolated short key release toggles the light. */
export class EquipmentInput {
  private pending=-1;private cancelled=false;private pointer=false;
  constructor(private readonly bindings:()=>ControlBindings,private readonly available:()=>boolean,private readonly toggle:()=>void,private readonly store:()=>void){
    window.addEventListener('keydown',this.down,true);window.addEventListener('keyup',this.up,true);window.addEventListener('mousedown',this.mouse,true);window.addEventListener('mouseup',this.mouseUp,true);window.addEventListener('blur',this.reset);document.addEventListener('visibilitychange',this.reset);
  }
  private free(preferred:string,alternate:string,exclude=''):string {
    const occupied=new Set(Object.values(this.bindings()));
    return [preferred,alternate,'KeyT','KeyO','KeyK','KeyU','KeyY','KeyJ','KeyN','KeyB','KeyM'].find(key=>!occupied.has(key)&&key!==exclude)??'';
  }
  get torchKey():string{return this.free('KeyF','KeyL');}
  get storeKey():string{return this.free('KeyG','KeyI',this.torchKey);}
  private editable(target:EventTarget|null):boolean{return target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');}
  private down=(e:KeyboardEvent):void=>{
    if(this.pending>=0&&e.code!==this.torchKey)this.cancelled=true;
    if(e.repeat){if(e.code===this.torchKey)this.cancelled=true;return;}
    if(!this.available()||this.editable(e.target)||e.defaultPrevented)return;
    const code=controlCodeFromKeyboardEvent(e);
    if(code===this.torchKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey){this.pending=performance.now();this.cancelled=this.pointer;}
    if(code===this.storeKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();e.stopImmediatePropagation();this.store();}
  };
  private up=(e:KeyboardEvent):void=>{
    if(controlCodeFromKeyboardEvent(e)!==this.torchKey)return;
    if(this.pending>=0&&!this.cancelled&&!this.pointer&&performance.now()-this.pending<280&&this.available()&&!this.editable(e.target))this.toggle();this.pending=-1;
  };
  private mouse=():void=>{this.pointer=true;if(this.pending>=0)this.cancelled=true;};
  private mouseUp=(event:MouseEvent):void=>{this.pointer=event.buttons!==0;};
  private reset=():void=>{this.pending=-1;this.pointer=false;};
  dispose():void{window.removeEventListener('keydown',this.down,true);window.removeEventListener('keyup',this.up,true);window.removeEventListener('mousedown',this.mouse,true);window.removeEventListener('mouseup',this.mouseUp,true);window.removeEventListener('blur',this.reset);document.removeEventListener('visibilitychange',this.reset);}
}
