import { afterAll, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => { const rapier=await import('@dimforge/rapier3d-compat');await rapier.init();return rapier; });
import { BacteriaActor } from './BacteriaActor';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CharacterEnvironment } from '../character/CharacterEnvironment';
import { loadBacteriaModel } from '../../tests/support/load-bacteria-model';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';

afterAll(()=>vi.unstubAllGlobals());
it('keeps the real animated arms inside the corridor rather than exposing them through the walls', async () => {
  vi.stubGlobal('ProgressEvent', class extends Event {});
  const actor=new (BacteriaActor as unknown as {new(model:THREE.Object3D):BacteriaActor})(await loadBacteriaModel());
  const physics=await PhysicsWorld.create({...createStairwellPlan(),colliders:[
    {id:'left',kind:'wall',center:{x:-1.15,y:1.5,z:0},halfExtents:{x:.15,y:1.5,z:8}},
    {id:'right',kind:'wall',center:{x:1.15,y:1.5,z:0},halfExtents:{x:.15,y:1.5,z:8}},
  ]});
  try {
    const environment=new CharacterEnvironment(physics),point=new THREE.Vector3();
    actor.setPlacement({x:.3,y:0,z:0},0);actor.setMotion('run');
    let unconstrained=0;
    for(let i=0;i<36;i++){
      actor.update(1/30);actor.root.updateMatrixWorld(true);
      actor.root.traverse(object=>{if(/^(Middle|Pinky|Thumb)_[LR](_\d+)?$/.test(object.name)){object.getWorldPosition(point);if(Math.abs(point.x)>.95)unconstrained++;}});
      actor.constrainToEnvironment(environment,1/30);actor.root.updateMatrixWorld(true);
      actor.root.traverse(object=>{if(/^(Middle|Pinky|Thumb)_[LR](_\d+)?$/.test(object.name)){object.getWorldPosition(point);expect(Math.abs(point.x),object.name).toBeLessThan(.99);}});
      if(i%6===0)actor.root.traverse(object=>{
        const mesh=object as THREE.SkinnedMesh;if(!mesh.isSkinnedMesh||!mesh.visible)return;
        mesh.skeleton.update();const bounds=new THREE.Box3();let worst=0,max=0;
        for(let vertex=0;vertex<mesh.geometry.getAttribute('position').count;vertex++){
          mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);bounds.expandByPoint(point);
          if(Math.abs(point.x)>max){max=Math.abs(point.x);worst=vertex;}
        }
        const bones=Array.from({length:4},(_,j)=>mesh.skeleton.bones[mesh.geometry.getAttribute('skinIndex').getComponent(worst,j)]?.name);
        expect(bounds.max.x,`${mesh.name}: ${bones.join(', ')}`).toBeLessThan(1.04);expect(bounds.min.x,mesh.name).toBeGreaterThan(-1.04);
      });
    }
    expect(unconstrained).toBeGreaterThan(0);
  } finally { actor.dispose();physics.dispose(); }
});
