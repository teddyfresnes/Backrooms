export interface InventoryItem { id:string; label:string }
/**
 * v2: items in pickup order, no reserved slot. `selected === items.length`
 * is the empty hand (the always-present last cell of the rail).
 */
export interface InventoryProgress {version:2;items:InventoryItem[];selected:number;lampOn:boolean}
/** v1 snapshots: five fixed slots, slot zero reserved for the torch. */
interface LegacyInventoryProgress {version:1;slots:(InventoryItem|null)[];selected:number;lampOn:boolean}
export const FLASHLIGHT_ID='quest:flashlight';
/** Chloé's compass: a quest item kept like the torch, never put down. */
export const COMPASS_ID='quest:compass';
export const isQuestItem=(id:string):boolean=>id===FLASHLIGHT_ID||id===COMPASS_ID;
export const INVENTORY_CAPACITY=5;
export const freshInventory=():InventoryProgress=>({version:2,items:[],selected:0,lampOn:false});
const validItem=(item:unknown):item is InventoryItem=>!!item&&typeof item==='object'&&typeof (item as InventoryItem).id==='string'&&typeof (item as InventoryItem).label==='string'
  &&(item as InventoryItem).label.length>0&&(item as InventoryItem).label.length<=64&&/^[a-zA-Z0-9_ .:/-]{1,219}$/.test((item as InventoryItem).id);
export function sanitizeInventory(value:unknown):InventoryProgress|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const raw=value as Partial<InventoryProgress>&Partial<LegacyInventoryProgress>;
  if(typeof raw.lampOn!=='boolean'||!Number.isInteger(raw.selected))return null;
  let items:InventoryItem[],selected:number;
  if(raw.version===1){
    const slots=raw.slots;
    if(!Array.isArray(slots)||slots.length!==5||raw.selected!<0||raw.selected!>4)return null;
    if(slots.some((item,i)=>item!==null&&(!validItem(item)||(i===0)!==(item.id===FLASHLIGHT_ID))))return null;
    items=slots.filter((item):item is InventoryItem=>item!==null).map(item=>({...item}));
    const chosen=slots[raw.selected!];selected=chosen?items.findIndex(item=>item.id===chosen.id):items.length;
  }else if(raw.version===2){
    if(!Array.isArray(raw.items)||raw.items.length>INVENTORY_CAPACITY||!raw.items.every(validItem)||raw.selected!<0||raw.selected!>raw.items.length)return null;
    items=raw.items.map(item=>({...item}));selected=raw.selected!;
  }else return null;
  if(new Set(items.map(item=>item.id)).size!==items.length)return null;
  if(raw.lampOn&&!items.some(item=>item.id===FLASHLIGHT_ID))return null;
  return {version:2,items,selected,lampOn:raw.lampOn};
}
/** Exact world identities in pickup order, plus the empty hand at the end. */
export class InventoryState {
  readonly state:InventoryProgress;
  constructor(saved?:InventoryProgress){this.state=saved?{...saved,items:saved.items.map(i=>({...i}))}:freshInventory();}
  get hasLamp():boolean{return this.has(FLASHLIGHT_ID);}
  get hasCompass():boolean{return this.has(COMPASS_ID);}
  get equipped():InventoryItem|null{return this.state.items[this.state.selected]??null;}
  get storedIds():string[]{return this.state.items.flatMap(i=>isQuestItem(i.id)?[]:[i.id]);}
  /** Cells drawn by the rail: every item and one empty hand. */
  get cellCount():number{return this.state.items.length+1;}
  private has(id:string):boolean{return this.state.items.some(i=>i.id===id);}
  private add(item:InventoryItem):boolean{
    if(this.has(item.id)||this.state.items.length>=INVENTORY_CAPACITY)return false;
    this.state.items.push({...item});this.state.selected=this.state.items.length-1;return true;
  }
  acquireLamp():boolean{return this.add({id:FLASHLIGHT_ID,label:'Lampe torche'});}
  acquireCompass():boolean{return this.add({id:COMPASS_ID,label:'Boussole de Chloé'});}
  store(item:InventoryItem):boolean{return !isQuestItem(item.id)&&this.add(item);}
  /** Wheel: through every item and the empty hand. */
  select(delta:number):void {const cells=this.cellCount;this.state.selected=(this.state.selected+Math.sign(delta)+cells)%cells;}
  /** Takes the selected ordinary item out; the selection moves to the empty hand. */
  takeSelected():InventoryItem|null{
    const item=this.equipped;if(!item||isQuestItem(item.id))return null;
    this.state.items.splice(this.state.selected,1);this.state.selected=this.state.items.length;return item;
  }
  toggleLamp():boolean{const index=this.state.items.findIndex(i=>i.id===FLASHLIGHT_ID);if(index<0)return false;this.state.selected=index;this.state.lampOn=!this.state.lampOn;return true;}
  snapshot():InventoryProgress{return {...this.state,items:this.state.items.map(i=>({...i}))};}
}
