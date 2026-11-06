import {expect,it,vi}from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d',async()=>{const rapier=await import('@dimforge/rapier3d-compat');await rapier.init();return rapier;});
import {PhysicsWorld}from '../physics/PhysicsWorld';
import {createStairwellPlan}from '../stairwell/createStairwellPlan';
import {CharacterEnvironment}from './CharacterEnvironment';
import {EnvironmentStrikeContact}from './EnvironmentStrikeContact';
it('finds a hand impact on the real Rapier wall inside the strike window, with no idle, tangent or free-air hit',async()=>{
  const physics=await PhysicsWorld.create(createStairwellPlan());
  try{
    physics.addChunk('strike-wall',[{id:'wall',kind:'wall',center:{x:0,y:1.4,z:-3},halfExtents:{x:1,y:1.4,z:.06}}],{x:0,y:0,z:0});
    const environment=new CharacterEnvironment(physics),probe=new EnvironmentStrikeContact(),from=new THREE.Vector3(0,1.4,-2.7),to=new THREE.Vector3(0,1.4,-3.2);
    const hit=probe.sample(environment,from,to,1/60,.3,.6,.3,.65);
    expect(hit).toBeDefined();expect(hit!.point.z).toBeCloseTo(-2.94,2);expect(hit!.fraction).toBeGreaterThan(0);expect(hit!.fraction).toBeLessThan(1);
    expect(probe.sample(environment,from,to,1/60,.1,.2,.3,.65)).toBeUndefined();
    expect(probe.sample(environment,from,from,1/60,.3,.6,.3,.65)).toBeUndefined();
    expect(probe.sample(environment,new THREE.Vector3(-.2,1.4,-2.87),new THREE.Vector3(.3,1.4,-2.87),1/60,.3,.6,.3,.65)).toBeUndefined();
    expect(probe.sample(environment,new THREE.Vector3(2,1.4,-2.7),new THREE.Vector3(2,1.4,-3.2),1/60,.3,.6,.3,.65)).toBeUndefined();
  }finally{physics.dispose();}
});
