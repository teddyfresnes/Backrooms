import {reachPowerCut,gasTarget,gasOrigin} from '../../tests/support/gas-journey';
import { expect, it, vi } from 'vitest';
import { ApartmentQuest, RENT_MAIL_ID, sanitizeComputerProgress, hasEnteredApartment } from './ApartmentQuest';

const readyForMail = (quest: ApartmentQuest) => {
  quest.reachHome(); quest.setLight(true); quest.setGas(true); quest.setTelevision(true); quest.setRadio(true);
};
it('recognizes the imported PC room and loaded saves there, while excluding the stairwell and lower floors', () => {
  const door = { x: -2.05, z: -2.712 };
  expect(hasEnteredApartment({ x: -7, y: 9.505, z: -5.6 }, door, 8.64)).toBe(true);
  expect(hasEnteredApartment({ x: -3, y: 9.505, z: -2.7 }, door, 8.64)).toBe(true);
  expect(hasEnteredApartment({ x: -1, y: 9.505, z: -2.7 }, door, 8.64)).toBe(false);
  expect(hasEnteredApartment({ x: -7, y: .865, z: -5.6 }, door, 8.64)).toBe(false);
});
it('follows mail, actual entry, light, gas, both devices, narrative mail and a completed game, without an account gate', () => {
  const changed = vi.fn(), quest = new ApartmentQuest(undefined, changed);
  expect(quest.objective('approach')).toContain('courrier'); expect(quest.objective('mail')).toContain('courrier');
  expect(quest.objective('home')).toContain('dernier étage');
  quest.checkAccount(); quest.startGame(); quest.finishGame('lost'); expect(changed).not.toHaveBeenCalled();
  quest.reachHome(); expect(quest.objective('home')).toContain('lumière');
  quest.setLight(true); expect(quest.objective('home')).toContain('gaz');
  quest.setGas(true); expect(quest.objective('home')).toContain('TV et la radio');
  quest.setRadio(true); expect(quest.objective('home')).toContain('TV');
  quest.setTelevision(true); expect(quest.objective('home')).toContain('mail de la régie');
  quest.useComputer(); quest.readMail('maman'); expect(quest.snapshot().stage).toBe('inbox');
  quest.readMail(RENT_MAIL_ID); expect(quest.snapshot().stage).toBe('game');
  expect(quest.objective('home')).toContain('Terminer'); quest.startGame(); expect(quest.snapshot().stage).toBe('game');
  quest.finishGame('lost'); expect(quest.snapshot().stage).toBe('done'); expect(quest.devices.outageTriggered).toBe(false);
});
it.each(['tv-first', 'radio-first'])('accepts anticipated actions and %s without cycling any device', order => {
  const quest = new ApartmentQuest(); quest.setGas(true); quest.setLight(true);
  if (order === 'tv-first') { quest.setTelevision(true); quest.setRadio(true); } else { quest.setRadio(true); quest.setTelevision(true); }
  expect(quest.objective('home')).toContain('dernier étage'); quest.reachHome();
  expect(quest.objective('home')).toContain('mail de la régie');
  const restored = new ApartmentQuest(sanitizeComputerProgress(JSON.parse(JSON.stringify(quest.snapshot())))!);
  expect(restored.objective('done')).toContain('mail de la régie'); expect(restored.devices.gasOn).toBe(true);
});
it('plays short thoughts once in order, including the reaction after reading the actual mail', () => {
  const quest = new ApartmentQuest(); expect(quest.nextThought()).toBeNull();
  quest.reachHome(); expect(quest.nextThought()?.id).toBe('home'); expect(quest.nextThought()).toBeNull();
  quest.setLight(true); expect(quest.nextThought()?.id).toBe('light');
  quest.setGas(true); expect(quest.nextThought()?.id).toBe('gas');
  quest.setTelevision(true); expect(quest.nextThought()).toBeNull();
  quest.setRadio(true); expect(quest.nextThought()?.id).toBe('devices');
  quest.readMail(RENT_MAIL_ID); expect(quest.nextThought()?.text).toMatch(/loyer.*Démineur/);
  const restored = new ApartmentQuest(sanitizeComputerProgress(quest.snapshot())!); restored.reachHome(); restored.readMail(RENT_MAIL_ID);
  expect(restored.nextThought()).toBeNull();
});
it.each(['won','lost'] as const)('finishes the phrase, rises with power and cuts once only after walking halfway (%s)',result=>{
  const quest=new ApartmentQuest();readyForMail(quest);quest.readMail(RENT_MAIL_ID);quest.finishGame(result);
  expect(quest.nextThought()?.text).toBe('Je devrais éteindre le gaz.');
  for(let i=0;i<100;i++){quest.advanceNarration(.05,false);expect(quest.advanceOutage(gasOrigin,gasTarget,false)).toBe(false);}
  expect(quest.devices.outageTriggered).toBe(false);expect(quest.requestQuickRise()).toBe(false);
  quest.advanceNarration(.05,true);expect(quest.requestQuickRise()).toBe(true);expect(quest.requestQuickRise()).toBe(false);
  expect(quest.devices.outageTriggered).toBe(false);
  const restored=new ApartmentQuest(sanitizeComputerProgress(quest.snapshot())!);expect(restored.nextThought()).toBeNull();
  reachPowerCut(restored);expect(restored.devices.outageTriggered).toBe(true);expect(restored.devices.gasOn).toBe(true);
  expect(restored.advanceOutage(gasOrigin,gasTarget,true)).toBe(false);
  const after=new ApartmentQuest(restored.snapshot());expect(after.nextThought()).toBeNull();expect(after.advanceOutage(gasOrigin,gasTarget,true)).toBe(false);
});
it('never interprets the old done stage as proof of a finished game or silently triggers an outage on load', () => {
  const old = { homeReached: true, stage: 'done' as const, readMailIds: [RENT_MAIL_ID] };
  const quest = new ApartmentQuest(sanitizeComputerProgress(old)!, undefined, true);
  expect(quest.devices).toMatchObject({ lightOn: true, firstGameFinished: false, outageTriggered: false });
  expect(quest.objective('done')).toContain('gaz');
  quest.setGas(true); quest.setRadio(true); quest.setTelevision(true);
  expect(quest.objective('done')).toContain('Terminer'); expect(quest.advanceOutage(gasOrigin,gasTarget,false)).toBe(false);
});
it('does not pretend the gas was left on if the player already turned it off', () => {
  const quest = new ApartmentQuest(); readyForMail(quest); quest.readMail(RENT_MAIL_ID); quest.setGas(false); quest.finishGame('won');
  expect(quest.nextThought()?.text).toContain('vérifier le gaz');
  for (let i = 0; i < 30; i++) quest.advanceOutage(gasOrigin,gasTarget,false);
  expect(quest.devices.gasOn).toBe(false);
});
it('rejects corrupt progress and copies nested snapshots', () => {
  expect(sanitizeComputerProgress({ homeReached: false, stage: 'done', readMailIds: [] })).toBeNull();
  expect(sanitizeComputerProgress({ homeReached: true, stage: 'game', readMailIds: [7] })).toBeNull();
  expect(sanitizeComputerProgress({ homeReached: true, stage: 'unknown', readMailIds: [] })).toBeNull();
  const quest = new ApartmentQuest(), save = quest.snapshot();
  (save.readMailIds as string[]).push(RENT_MAIL_ID); save.apartment!.spoken.push('mines'); save.apartment!.tvOn = true;
  expect(quest.snapshot().readMailIds).toEqual([]); expect(quest.devices.spoken).toEqual([]); expect(quest.devices.tvOn).toBe(false);
  expect(sanitizeComputerProgress({ ...quest.snapshot(), apartment: { ...quest.devices, outageTriggered: true } })).toBeNull();
  readyForMail(quest); quest.readMail(RENT_MAIL_ID); quest.finishGame('lost');
  expect(sanitizeComputerProgress({ ...quest.snapshot(), apartment: { ...quest.devices, outageLeadSeconds: -.5 } })).toBeNull();
  expect(sanitizeComputerProgress({ ...quest.snapshot(), apartment: { ...quest.devices, spoken: ['mines'] } })).toBeNull();
});
