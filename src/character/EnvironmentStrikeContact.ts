import * as THREE from 'three';
import type { CharacterEnvironment, EnvironmentSphereHit } from './CharacterEnvironment';

/** Contact only inside the authored strike window, against mounted Rapier
 * geometry. An idle hand, tangent pass or punch in free air stays silent. */
export class EnvironmentStrikeContact {
  private readonly from=new THREE.Vector3();
  private readonly to=new THREE.Vector3();
  private readonly motion=new THREE.Vector3();
  private readonly hit:EnvironmentSphereHit={center:new THREE.Vector3(),normal:new THREE.Vector3()};
  sample(environment:CharacterEnvironment,previous:THREE.Vector3,current:THREE.Vector3,delta:number,
    previousPhase:number,phase:number,start:number,end:number,shoulder?:THREE.Vector3):{point:THREE.Vector3;fraction:number;speed:number;direction:THREE.Vector3}|undefined {
    if(delta<=0||phase<=previousPhase||phase<start||previousPhase>end)return;
    this.motion.copy(current).sub(previous);
    const speed=this.motion.length()/delta;if(speed<.7)return;
    const span=phase-previousPhase;
    const first=THREE.MathUtils.clamp((start-previousPhase)/span,0,1),last=THREE.MathUtils.clamp((end-previousPhase)/span,0,1);
    this.from.copy(previous).addScaledVector(this.motion,first);this.to.copy(previous).addScaledVector(this.motion,last);
    // A close wall can already constrain the guard hand before the nominal
    // body-hit window. Probe from its shoulder so an occluded authored fist
    // reports the near surface, never the back face during its return.
    if(!environment.sweepSphere(shoulder??this.from,this.to,.065,this.hit)||this.motion.dot(this.hit.normal)>=-.01)return;
    const fraction=THREE.MathUtils.clamp(this.to.copy(this.hit.center).sub(previous).dot(this.motion)/this.motion.lengthSq(),first,last);
    return {point:this.hit.center.clone().addScaledVector(this.hit.normal,-.065),fraction,speed,direction:this.motion.clone().normalize()};
  }
}
