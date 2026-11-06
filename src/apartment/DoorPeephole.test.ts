// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { DoorPeephole } from './DoorPeephole';
import { defaultControlBindings } from '../input/ControlBindings';
const cleanup:(()=>void)[]=[];
afterEach(()=>{cleanup.splice(0).reverse().forEach(fn=>fn());document.body.replaceChildren();});
function fixture(side:number){
 const root=new THREE.Group(),pivot=new THREE.Group();root.add(pivot);
 const leaf=new THREE.Mesh(new THREE.BoxGeometry(.04,2.2,.9),new THREE.MeshStandardMaterial());leaf.position.set(-2,1.1,0);pivot.add(leaf);root.updateMatrixWorld(true);
 const camera=new THREE.PerspectiveCamera(70,1.8,.04,160);camera.position.set(-2+side,1.55,0);camera.lookAt(-2,1.55,0);camera.updateMatrixWorld(true);
 const original=camera.clone(),changed=vi.fn(),ui={setInteraction:vi.fn()};
 const peephole=new DoorPeephole(leaf,pivot,new THREE.Box3().setFromObject(leaf),camera,document.body,ui,()=>defaultControlBindings('azerty'),changed);
 cleanup.push(()=>{peephole.dispose();leaf.geometry.dispose();leaf.material.dispose();});return{root,pivot,leaf,camera,original,changed,ui,peephole};
}
it.each([-1,1])('shows real geometry on the opposite side (%s), restores normal projection and leaves the door in place',side=>{
 const s=fixture(side),doorWorld=s.leaf.matrixWorld.clone();
 const target=new THREE.Mesh(new THREE.BoxGeometry(.2,1,.5),new THREE.MeshBasicMaterial());target.position.set(-2-side*2,1.55,0);s.root.add(target);s.root.updateMatrixWorld(true);
 s.peephole.updatePrompt(true);expect(s.ui.setInteraction).toHaveBeenLastCalledWith('Regarder par le judas');
 expect(s.peephole.interact()).toBe(true);s.peephole.updateView(.25);
 expect((s.camera.position.x+2)*side).toBeLessThan(0);expect(s.leaf.matrixWorld.equals(doorWorld)).toBe(true);
 const ray=new THREE.Raycaster();s.camera.updateMatrixWorld(true);ray.setFromCamera(new THREE.Vector2(),s.camera);
 expect(ray.intersectObject(target)).not.toHaveLength(0);expect(ray.intersectObject(s.leaf)).toHaveLength(0);
 expect(s.camera.near).toBeLessThan(.02);expect(document.querySelector('.door-peephole')?.textContent).toContain('Échap');
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',cancelable:true}));
 expect(s.peephole.isActive).toBe(false);expect(s.camera.position.distanceTo(s.original.position)).toBeLessThan(1e-8);
 expect(s.camera.quaternion.angleTo(s.original.quaternion)).toBeLessThan(1e-7);expect(s.camera.fov).toBe(70);expect(s.camera.near).toBe(.04);
 expect(s.changed.mock.calls.map(([active])=>active)).toEqual([true,false]);
 target.geometry.dispose();(target.material as THREE.Material).dispose();
});
it('requires the actual closed-door target, supports rebound interaction keys and cleans up during pause/disposal',()=>{
 const s=fixture(1);s.camera.lookAt(5,2,0);expect(s.peephole.interact()).toBe(false);
 s.camera.lookAt(-2,1.55,0);s.pivot.rotation.y=.2;expect(s.peephole.interact()).toBe(false);
 s.pivot.rotation.y=0;expect(s.peephole.interact()).toBe(true);s.peephole.close();expect(s.peephole.isActive).toBe(false);
 expect(s.peephole.interact()).toBe(true);s.peephole.dispose();expect(document.querySelector('.door-peephole')).toBeNull();
 expect(s.camera.position.distanceTo(s.original.position)).toBeLessThan(1e-8);
});
