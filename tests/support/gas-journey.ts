import type { ApartmentQuest } from '../../src/story/ApartmentQuest';
export const gasOrigin={x:-6.36,y:9.505,z:-4.3};
export const gasTarget={x:-6.9,y:9.65,z:.1};
/** Device/save tests reach the outage through the real story contract. */
export function reachPowerCut(quest:ApartmentQuest):void{
  quest.advanceNarration(4,true);quest.requestQuickRise();
  for(let i=0;i<=60;i++)quest.advanceOutage({x:gasOrigin.x+(gasTarget.x-gasOrigin.x)*i/100,y:gasOrigin.y,z:gasOrigin.z+(gasTarget.z-gasOrigin.z)*i/100},gasTarget,true);
}
