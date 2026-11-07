import {expect,it}from 'vitest';
import {InventoryState,sanitizeInventory,FLASHLIGHT_ID,COMPASS_ID,INVENTORY_CAPACITY}from './InventoryState';
it('grows in pickup order, keeps an empty hand at the end and never stores past capacity',()=>{
  const bag=new InventoryState();expect(bag.cellCount).toBe(1);expect(bag.equipped).toBeNull();
  expect(bag.acquireCompass()).toBe(true);expect(bag.state.items[0]!.id).toBe(COMPASS_ID);expect(bag.equipped?.id).toBe(COMPASS_ID);expect(bag.cellCount).toBe(2);
  expect(bag.acquireLamp()).toBe(true);expect(bag.state.items[1]!.id).toBe(FLASHLIGHT_ID);expect(bag.equipped?.id).toBe(FLASHLIGHT_ID);
  bag.select(1);expect(bag.equipped).toBeNull();bag.select(1);expect(bag.equipped?.id).toBe(COMPASS_ID);bag.select(-1);expect(bag.equipped).toBeNull();
  for(let i=0;i<INVENTORY_CAPACITY;i++)bag.store({id:`prop:${i}`,label:'Disquette'});
  expect(bag.state.items).toHaveLength(INVENTORY_CAPACITY);expect(bag.cellCount).toBe(INVENTORY_CAPACITY+1);
  expect(bag.storedIds).toEqual(['prop:0','prop:1','prop:2']);
});
it('never drops quest items, puts an ordinary item back in hand and round-trips',()=>{
  const bag=new InventoryState();bag.acquireCompass();expect(bag.takeSelected()).toBeNull();expect(bag.store({id:COMPASS_ID,label:'x'})).toBe(false);
  const disk={id:'prop:disk',label:'Disquette'};bag.store(disk);expect(bag.store(disk)).toBe(false);expect(bag.takeSelected()).toEqual(disk);
  expect(bag.equipped).toBeNull();expect(bag.storedIds).toEqual([]);
  bag.acquireLamp();bag.toggleLamp();expect(bag.state.lampOn).toBe(true);
  expect(sanitizeInventory(bag.snapshot())).toEqual(bag.snapshot());expect(new InventoryState(bag.snapshot()).hasCompass).toBe(true);
  expect(sanitizeInventory({...bag.snapshot(),items:[...bag.snapshot().items,{id:COMPASS_ID,label:'Double'}]})).toBeNull();
  expect(sanitizeInventory({...bag.snapshot(),selected:9})).toBeNull();
});
it('migrates the five fixed slots of v1 saves, keeping the selection',()=>{
  const legacy={version:1,slots:[{id:FLASHLIGHT_ID,label:'Lampe torche'},null,{id:'prop:book',label:'Livre'},null,null],selected:2,lampOn:true};
  expect(sanitizeInventory(legacy)).toEqual({version:2,items:[{id:FLASHLIGHT_ID,label:'Lampe torche'},{id:'prop:book',label:'Livre'}],selected:1,lampOn:true});
  expect(sanitizeInventory({...legacy,selected:1})!.selected).toBe(2);
  expect(sanitizeInventory({...legacy,slots:[null,{id:FLASHLIGHT_ID,label:'x'},null,null,null]})).toBeNull();
});
