import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Compass, CompassInterference, CompassNeedle } from './Compass';
import { COMPASS_NEEDLE } from './CompassModel';

describe('intermittent compass interference', () => {
  it.each([30,60,120])('shakes for five seconds and locks for two, repeatedly, at %i fps', fps => {
    const cycle=new CompassInterference();
    for(let frame=1;frame<fps*14;frame++) {
      const strength=cycle.step(1/fps,1), phase=(frame/fps)%7;
      const stable=phase>=5 && phase<7;
      expect(cycle.locked,`frame ${frame}`).toBe(stable);
      expect(strength).toBe(stable?0:1);
    }
    cycle.step(0,0); expect(cycle.locked).toBe(false);
    expect(cycle.step(.1,1)).toBe(1);
  });
  it('snaps the real needle to the bearing with no residual velocity during every lock',()=>{
    const needle=new CompassNeedle();
    for(let i=0;i<300;i++)needle.step(1/60,1.2,1);
    expect(needle.step(1/60,1.2,0,true)).toBe(1.2);expect(needle.velocity).toBe(0);
    expect(needle.step(1/60,-2.1,0,true)).toBe(-2.1);expect(needle.velocity).toBe(0);
    needle.step(1/60,-2.1,1);expect(needle.velocity).not.toBe(0);
  });
  it('keeps the case and needle steady on the actual destination, pauses hidden time, then shakes again',()=>{
    const compass=new Compass(new THREE.Scene()),camera=new THREE.PerspectiveCamera();
    const palm={position:new THREE.Vector3(),quaternion:new THREE.Quaternion()},direction=new THREE.Vector3(1,0,0);
    const step=(delta=1/60,visible=true)=>compass.update(camera,palm,visible,1,delta,direction);
    try {
      for(let i=0;i<300;i++)step();
      const needle=compass.model.getObjectByName(COMPASS_NEEDLE)!;
      expect(needle.rotation.y).toBeCloseTo(-Math.PI/2);expect(needle.position.y).toBe(.0028);
      expect(compass.model.quaternion.equals(palm.quaternion)).toBe(true);
      for(let i=0;i<600;i++)step(1/60,false);
      step(0);expect(needle.rotation.y).toBeCloseTo(-Math.PI/2);
      for(let i=0;i<119;i++){step();expect(needle.rotation.y).toBeCloseTo(-Math.PI/2);}
      for(let i=0;i<5;i++)step();
      expect(needle.rotation.y).not.toBeCloseTo(-Math.PI/2);
    } finally {compass.dispose();}
  });
});
