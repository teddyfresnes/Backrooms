import { FLASHLIGHT_ID, type InventoryState } from '../apartment/InventoryState';
import './inventory-hud.css';
import type * as THREE from 'three';
import { inventoryObjectIcon } from './InventoryIcons';
export class InventoryHUD {
  readonly element=document.createElement('aside');
  private readonly slots:HTMLElement[]=[];
  private readonly icons = new Map<string,string>();
  private readonly sources = new Map<string,readonly THREE.Object3D[]>();
  private peek=0;private accent=0;private last='';private selected=-1;
  constructor(container:HTMLElement){
    this.element.className='inventory-hud';this.element.hidden=true;this.element.setAttribute('aria-label','Inventaire, cinq emplacements');
    const rail=document.createElement('div');rail.className='inventory-rail';
    for(let i=0;i<5;i++){const slot=document.createElement('div');slot.className='inventory-slot';slot.setAttribute('aria-label',`Emplacement ${i+1}, vide`);this.slots.push(slot);rail.append(slot);}
    this.element.append(rail);container.append(this.element);
  }
  setObjectSources(sources: readonly {id:string;parts:readonly THREE.Object3D[]}[], torch:THREE.Object3D):void {
    this.sources.clear(); this.icons.clear();
    for(const item of sources)this.sources.set(item.id,item.parts);
    this.icons.set(FLASHLIGHT_ID,inventoryObjectIcon([torch],true));this.last='';
  }
  reveal():void{this.peek=1.7;this.accent=.3;}
  update(inventory:InventoryState,delta:number,visible:boolean,playing:boolean,_storeKey:string,_torchKey:string,reduced=false):void{
    this.element.hidden=!visible;if(playing){this.peek=Math.max(0,this.peek-delta);this.accent=Math.max(0,this.accent-delta);}
    const signature=JSON.stringify(inventory.state.slots);
    if(signature!==this.last){this.last=signature;inventory.state.slots.forEach((item,i)=>{const slot=this.slots[i]!;slot.replaceChildren();if(item){let icon=this.icons.get(item.id);if(!icon){const parts=this.sources.get(item.id);if(parts){icon=inventoryObjectIcon(parts);this.icons.set(item.id,icon);}}if(icon){const image=document.createElement('img');image.alt='';image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(icon);slot.append(image);}}slot.setAttribute('aria-label',item?.label??`Emplacement ${i+1}, vide`);});}
    if(this.selected!==inventory.state.selected){this.selected=inventory.state.selected;this.accent=.3;this.slots.forEach((s,i)=>{s.classList.toggle('is-selected',i===this.selected);s.setAttribute('aria-current',String(i===this.selected));});}
    const any=inventory.state.slots.some(Boolean);
    this.element.classList.toggle('has-items',any);this.element.classList.toggle('is-peeking',this.peek>0);this.element.classList.toggle('is-changing',this.accent>0&&!reduced);
    this.element.classList.toggle('lamp-on',inventory.state.lampOn);
  }
  dispose():void{this.element.remove();}
}
