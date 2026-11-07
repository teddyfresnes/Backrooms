import {expect,it}from 'vitest';
import {InventoryState,sanitizeInventory,FLASHLIGHT_ID,COMPASS_ID}from './InventoryState';
it('preserves the quest slot even when every small-object slot is full before or after the outage',()=>{
  for(const first of [false,true]){const bag=new InventoryState();if(first)bag.acquireLamp();for(let i=0;i<4;i++)expect(bag.store({id:`prop:${i}`,label:'Disquette'})).toBe(true);
    expect(bag.store({id:'prop:extra',label:'Verre'})).toBe(false);if(!first)expect(bag.acquireLamp()).toBe(true);expect(bag.acquireLamp()).toBe(false);expect(bag.state.slots.filter(Boolean)).toHaveLength(5);bag.state.selected=0;expect(bag.takeSelected()).toBeNull();expect(bag.hasLamp).toBe(true);}
});
it('never duplicates identities when scrolling, equipping, stowing and restoring',()=>{
  const bag=new InventoryState();const item={id:'prop:disk',label:'Disquette'};bag.store(item);expect(bag.store(item)).toBe(false);bag.acquireLamp();bag.toggleLamp();
  for(let i=0;i<30;i++)bag.select(1);expect(bag.storedIds).toEqual([item.id]);expect(sanitizeInventory(bag.snapshot())).toEqual(bag.snapshot());
  const restored=new InventoryState(bag.snapshot());restored.state.selected=1;expect(restored.takeSelected()).toEqual(item);expect(restored.storedIds).toHaveLength(0);expect(restored.state.lampOn).toBe(true);
  expect(sanitizeInventory({...bag.snapshot(),slots:[{id:FLASHLIGHT_ID,label:'Lampe'},{id:FLASHLIGHT_ID,label:'Double'},null,null,null]})).toBeNull();
});
it('keeps Chloé’s compass in an ordinary slot that can be selected but never stored or dropped',()=>{
  const bag=new InventoryState();expect(bag.acquireCompass()).toBe(true);expect(bag.acquireCompass()).toBe(false);
  expect(bag.hasCompass).toBe(true);expect(bag.equipped?.id).toBe(COMPASS_ID);expect(bag.state.selected).toBe(1);
  expect(bag.takeSelected()).toBeNull();expect(bag.storedIds).toEqual([]);expect(bag.store({id:COMPASS_ID,label:'x'})).toBe(false);
  expect(sanitizeInventory(bag.snapshot())).toEqual(bag.snapshot());
  expect(new InventoryState(bag.snapshot()).hasCompass).toBe(true);
});
