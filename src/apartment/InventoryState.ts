export interface InventoryItem { id:string; label:string }
export interface InventoryProgress {version:1;slots:(InventoryItem|null)[];selected:number;lampOn:boolean}
export const FLASHLIGHT_ID='quest:flashlight';
/** Chloé's compass: a quest item kept in an ordinary slot, never put down. */
export const COMPASS_ID='quest:compass';
export const isQuestItem=(id:string):boolean=>id===FLASHLIGHT_ID||id===COMPASS_ID;
export const freshInventory=():InventoryProgress=>({version:1,slots:[null,null,null,null,null],selected:0,lampOn:false});
export function sanitizeInventory(value:unknown):InventoryProgress|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;const v=value as InventoryProgress;
  if(v.version!==1||!Array.isArray(v.slots)||v.slots.length!==5||!Number.isInteger(v.selected)||v.selected<0||v.selected>4||typeof v.lampOn!=='boolean')return null;
  const ids=new Set<string>();
  for(const [i,item]of v.slots.entries())if(item!==null){if(!item||typeof item!=='object'||typeof item.id!=='string'||typeof item.label!=='string'||item.label.length>64||!item.label.length||!/^[a-zA-Z0-9_ .:/-]{1,219}$/.test(item.id)||ids.has(item.id)||(i===0)!==(item.id===FLASHLIGHT_ID))return null;ids.add(item.id);}
  if(v.lampOn&&!ids.has(FLASHLIGHT_ID))return null;
  return {...v,slots:v.slots.map(item=>item?{...item}:null)};
}
/** Slot zero protects the quest item; the other four contain exact world identities. */
export class InventoryState {
  readonly state:InventoryProgress;
  constructor(saved?:InventoryProgress){this.state=saved?{...saved,slots:saved.slots.map(i=>i?{...i}:null)}:freshInventory();}
  get hasLamp():boolean{return this.state.slots[0]?.id===FLASHLIGHT_ID;}
  get equipped():InventoryItem|null{return this.state.slots[this.state.selected]??null;}
  get storedIds():string[]{return this.state.slots.flatMap(i=>i&&!isQuestItem(i.id)?[i.id]:[]);}
  get hasCompass():boolean{return this.state.slots.some(i=>i?.id===COMPASS_ID);}
  /** Into the first free ordinary slot, selected so it is in hand at once. */
  acquireCompass():boolean{if(this.hasCompass)return false;const slot=this.state.slots.findIndex((i,n)=>n>0&&!i);if(slot<0)return false;this.state.slots[slot]={id:COMPASS_ID,label:'Boussole de Chloé'};this.state.selected=slot;return true;}
  acquireLamp():boolean{if(this.hasLamp)return false;this.state.slots[0]={id:FLASHLIGHT_ID,label:'Lampe torche'};this.state.selected=0;return true;}
  store(item:InventoryItem):boolean{if(this.state.slots.some(i=>i?.id===item.id)||isQuestItem(item.id))return false;const slot=this.state.slots.findIndex((i,n)=>n>0&&!i);if(slot<0)return false;this.state.slots[slot]={...item};this.state.selected=slot;return true;}
  select(delta:number):void {this.state.selected=(this.state.selected+Math.sign(delta)+5)%5;}
  takeSelected():InventoryItem|null{if(this.state.selected===0||isQuestItem(this.equipped?.id??''))return null;const item=this.equipped;this.state.slots[this.state.selected]=null;return item;}
  toggleLamp():boolean{if(!this.hasLamp)return false;this.state.selected=0;this.state.lampOn=!this.state.lampOn;return true;}
  snapshot():InventoryProgress{return {...this.state,slots:this.state.slots.map(i=>i?{...i}:null)};}
}
