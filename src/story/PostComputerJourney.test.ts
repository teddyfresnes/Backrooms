import {expect,it} from 'vitest';
import {ApartmentQuest,RENT_MAIL_ID,sanitizeComputerProgress} from './ApartmentQuest';
import {gasOrigin,gasTarget} from '../../tests/support/gas-journey';
const make=()=>{const q=new ApartmentQuest();q.reachHome();q.setLight(true);q.setGas(true);q.setTelevision(true);q.setRadio(true);q.readMail(RENT_MAIL_ID);q.checkBank();q.finishGame('lost');return q;};
const at=(t:number)=>({x:gasOrigin.x+(gasTarget.x-gasOrigin.x)*t,y:gasOrigin.y,z:gasOrigin.z+(gasTarget.z-gasOrigin.z)*t});
it('round-trips before/after the rise and both sides of the midpoint, without a repeated consumed cue',()=>{
  let q=make();q.nextThought();q.advanceNarration(.4,false);
  q=new ApartmentQuest(sanitizeComputerProgress(q.snapshot())!);expect(q.nextThought()).toBeNull();expect(q.devices.journey?.thoughtFinished).toBe(true);
  expect(q.requestQuickRise()).toBe(true);q=new ApartmentQuest(q.snapshot());expect(q.requestQuickRise()).toBe(false);
  expect(q.advanceOutage(at(0),gasTarget,false)).toBe(false);expect(q.advanceOutage(at(0),gasTarget,true)).toBe(false);
  for(let i=1;i<=45;i++)expect(q.advanceOutage(at(i/100),gasTarget,true)).toBe(false);
  q=new ApartmentQuest(q.snapshot());expect(q.advanceOutage(at(.45),gasTarget,true)).toBe(false);
  expect(q.advanceOutage(at(.49),gasTarget,true)).toBe(false);expect(q.advanceOutage(at(.51),gasTarget,true)).toBe(true);
  q=new ApartmentQuest(q.snapshot());expect(q.nextThought()).toBeNull();expect(q.devices.journey?.outageReactionConsumed).toBe(true);expect(q.advanceOutage(at(.6),gasTarget,true)).toBe(false);
});
it.each([30,60,120])('fires at the same physical halfway point at %s FPS, with no waiting/teleport/other-floor shortcut',fps=>{
  const q=make();q.nextThought();q.advanceNarration(4,true);q.requestQuickRise();q.advanceOutage(at(0),gasTarget,true);
  for(let i=0;i<200;i++)expect(q.advanceOutage(at(0),gasTarget,true)).toBe(false);
  expect(q.advanceOutage(at(.9),gasTarget,true)).toBe(false);
  expect(q.advanceOutage({...at(.9),y:gasOrigin.y-3},gasTarget,true)).toBe(false);
  q.advanceOutage(at(0),gasTarget,true);let triggered=-1;
  for(let i=1;i<=fps*4;i++){const t=i/(fps*4);if(q.advanceOutage(at(t),gasTarget,true))triggered=t;}
  expect(triggered).toBeGreaterThanOrEqual(.5);expect(triggered).toBeLessThan(.51);
});
it('accepts the published legacy saves without replaying the interrupted phrase or an already-consumed outage',()=>{
  const q=make();q.nextThought();const old=q.snapshot();delete old.apartment!.journey;
  const restored=new ApartmentQuest(sanitizeComputerProgress(old)!);expect(restored.nextThought()).toBeNull();expect(restored.devices.outageTriggered).toBe(false);
  old.apartment!.outageTriggered=true;old.apartment!.outageLeadSeconds=1.12;
  const after=new ApartmentQuest(sanitizeComputerProgress(old)!);expect(after.isComputerBlocked).toBe(true);expect(after.nextThought()).toBeNull();
});
