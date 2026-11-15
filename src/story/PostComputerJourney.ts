import type { Vec3Data } from '../world/types';

export interface PostComputerJourney {
  version: 1;
  thoughtFinished: boolean;
  riseRequested: boolean;
  origin?: Vec3Data;
  walked: number;
  outageReactionConsumed: boolean;
}
export const freshJourney = (): PostComputerJourney => ({version:1,thoughtFinished:false,riseRequested:false,walked:0,outageReactionConsumed:false});
export const copyJourney = (s:PostComputerJourney):PostComputerJourney => ({...s,...(s.origin?{origin:{...s.origin}}:{})});
export function validJourney(s:PostComputerJourney):boolean {
  return !!s&&s.version===1&&['thoughtFinished','riseRequested','outageReactionConsumed'].every(k=>typeof s[k as keyof PostComputerJourney]==='boolean')
    &&Number.isFinite(s.walked)&&s.walked>=0&&s.walked<1000
    &&(!s.riseRequested||s.thoughtFinished)
    &&(!s.origin||s.riseRequested&&['x','y','z'].every(k=>Number.isFinite(s.origin![k as keyof Vec3Data])&&Math.abs(s.origin![k as keyof Vec3Data])<2000));
}

/** The midpoint is measured from the actual control handoff to the imported hob.
 * A teleport, walking in another room/floor or waiting at the PC cannot fire it. */
export class GasJourneyTrigger {
  private previous?:Vec3Data;
  observe(s:PostComputerJourney,position:Vec3Data,gas:Vec3Data,free:boolean):boolean {
    if(!free||!s.thoughtFinished||!s.riseRequested){this.previous=undefined;return false;}
    if(!s.origin){s.origin={...position};this.previous={...position};return false;}
    const before=this.previous;this.previous={...position};
    if(!before)return false;
    const step=Math.hypot(position.x-before.x,position.z-before.z);
    if(step<.001||step>.7||Math.abs(position.y-s.origin.y)>.45)return false;
    const dx=gas.x-s.origin.x,dz=gas.z-s.origin.z,length=Math.hypot(dx,dz);
    // A manual exit can finish the spoken thought only once the player has
    // already reached the hob. Do not leave that short final trip unarmed.
    if(length<.8){s.walked+=step;return s.walked>=.12;}
    const px=position.x-s.origin.x,pz=position.z-s.origin.z;
    const along=(px*dx+pz*dz)/length,lateral=Math.abs(px*dz-pz*dx)/length;
    s.walked+=step;
    // Count a real detour around furniture as walking too. Previously only
    // steps inside the narrow PC→hob corridor counted, so reaching the gas by
    // another route could leave the required distance permanently unmet.
    if(lateral>Math.max(1.1,length*.35))return false;
    return along>=length*.5&&s.walked>=length*.4;
  }
}
