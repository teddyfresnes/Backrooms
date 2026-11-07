// @vitest-environment happy-dom
import {expect,it}from 'vitest';
import * as THREE from 'three';
import {createFlashlightModel}from '../apartment/FlashlightModel';
import {InventoryState}from '../apartment/InventoryState';
import {InventoryHUD}from './InventoryHUD';
import {compassIcon,inventoryObjectIcon}from './InventoryIcons';
it('draws the actual torch and stored geometry in the rail, retains selection and exposes labels only to assistive technology',()=>{
  const torch=createFlashlightModel(),book=new THREE.Mesh(new THREE.BoxGeometry(.12,.02,.18),new THREE.MeshStandardMaterial({color:0x704e31}));
  const host=document.createElement('div'),hud=new InventoryHUD(host),state=new InventoryState();
  try{
    hud.setObjectSources([{id:'prop:book',parts:[book]}],torch);state.acquireLamp();state.store({id:'prop:book',label:'Livre'});
    hud.update(state,.016,true,true,'G','F');
    expect(host.querySelectorAll('.inventory-slot img')).toHaveLength(2);
    expect(host.querySelector('.inventory-caption')).toBeNull();expect(host.textContent).toBe('');
    const slots=host.querySelectorAll('.inventory-slot');expect(slots[0]!.getAttribute('aria-label')).toBe('Lampe torche');expect(slots[1]!.classList.contains('is-selected')).toBe(true);expect(slots).toHaveLength(3);expect(slots[2]!.getAttribute('aria-label')).toBe('Mains vides');
    const original=slots[0]!.innerHTML,svg=decodeURIComponent((slots[0]!.querySelector('img') as HTMLImageElement).src.split(',').slice(1).join(','));
    expect(svg).toBe(inventoryObjectIcon([torch],true));expect(svg.split('<polygon').length).toBeGreaterThan(12);
    state.select(1);hud.update(state,.016,true,true,'G','F');expect(slots[2]!.classList.contains('is-selected')).toBe(true);
    hud.setQuestIcon('quest:compass',compassIcon());state.acquireCompass();hud.update(state,.016,true,true,'G','F');
    expect(host.querySelectorAll('.inventory-slot')).toHaveLength(4);expect(host.querySelectorAll('.inventory-slot')[2]!.getAttribute('aria-label')).toBe('Boussole de Chloé');expect(slots[0]!.innerHTML).toBe(original);
  }finally{hud.dispose();torch.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh){m.geometry.dispose();for(const material of Array.isArray(m.material)?m.material:[m.material])material.dispose();}});book.geometry.dispose();(book.material as THREE.Material).dispose();}
});
