// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', () => ({ default: {} }));
vi.mock('../physics/PhysicsWorld', () => ({ PhysicsWorld: class {} }));
vi.mock('../apartment/ComputerChair', () => ({ ComputerChair: class {} }));
vi.mock('../apartment/Flashlight', () => ({ Flashlight: class {} }));
vi.mock('../apartment/ComputerUseSequence', () => ({ ComputerUseSequence: class {} }));
vi.mock('../apartment/ApartmentFixtures', () => ({ ApartmentFixtures: class {} }));
vi.mock('../apartment/ClosetHide', () => ({ ClosetHide: class {} }));
vi.mock('../apartment/ApartmentObjectInteraction', () => ({ ApartmentObjectInteraction: class {} }));
vi.mock('../apartment/ApartmentComputerInteraction', () => ({ ApartmentComputerInteraction: class {} }));
vi.mock('../apartment/ApartmentDevices', () => ({ ApartmentDevices: class {}, apartmentDevicePositions: () => ({}) }));
vi.mock('../character/CharacterRuntime', () => ({ CharacterRuntime: class {} }));
vi.mock('../audio/SiteAudio', () => ({ siteAudio: new Proxy({}, { get: () => () => undefined }) }));
import { RussianStairwellGame } from './RussianStairwellGame';
import * as THREE from 'three';
import {InventoryState}from '../apartment/InventoryState';
import {CorridorStory}from '../story/CorridorProgress';

function fixture() {
  const probe = Object.create(RussianStairwellGame.prototype);
  Object.assign(probe, {
    questTracker: { update: vi.fn() }, quest: { objective: () => 'Sur le PC' },
    computerDesktop: { isOpen: true }, player: { setInputEnabled: vi.fn(), unlock: vi.fn() },
    character: { setActive: vi.fn() }, ui: { setLocked: vi.fn(), isConsoleOpen: false },
    audio: { setSuspended: vi.fn() }, storyHud: { setPlaying: vi.fn() }, neighbours: undefined,
  });
  return probe as {
    onPlayerLockChange(locked: boolean): void;
    computerDesktop: { isOpen: boolean }; player: { setInputEnabled: ReturnType<typeof vi.fn>; unlock: ReturnType<typeof vi.fn> };
    ui: { setLocked: ReturnType<typeof vi.fn> }; character: { setActive: ReturnType<typeof vi.fn> };
  };
}
it('keeps pause hidden while a desktop owns input, releases a late capture, and restores gameplay afterward', async () => {
  const game = fixture(); game.onPlayerLockChange(false);
  expect(game.ui.setLocked).not.toHaveBeenCalled(); expect(game.player.setInputEnabled).toHaveBeenLastCalledWith(false);
  game.onPlayerLockChange(true); await Promise.resolve(); expect(game.player.unlock).toHaveBeenCalledOnce();
  game.computerDesktop.isOpen = false; game.onPlayerLockChange(true);
  expect(game.ui.setLocked).toHaveBeenLastCalledWith(true); expect(game.player.setInputEnabled).toHaveBeenLastCalledWith(true);
  expect(game.character.setActive).toHaveBeenLastCalledWith(true,true);
});
it('does not release a new gameplay capture if the desktop closed before the queued release', async () => {
  const game = fixture(); game.onPlayerLockChange(true); game.computerDesktop.isOpen = false;
  await Promise.resolve(); expect(game.player.unlock).not.toHaveBeenCalled();
});

it('finishes spoken gas dialogue, rises while powered, waits for actual midpoint and never replays on reload',async()=>{
  const {ApartmentQuest,RENT_MAIL_ID}=await import('../story/ApartmentQuest');
  const {NarrativeCaption}=await import('../ui/NarrativeCaption');
  const {gasOrigin,gasTarget}=await import('../../tests/support/gas-journey');
  const quest=new ApartmentQuest();quest.reachHome();quest.setLight(true);quest.setGas(true);quest.setRadio(true);quest.setTelevision(true);quest.readMail(RENT_MAIL_ID);
  const container=document.createElement('div');document.body.append(container);
  const caption=new NarrativeCaption(container),power=vi.fn(),cut=vi.fn(),rise=vi.fn();
  const speech={busy:true,say:vi.fn(),update:vi.fn(),setVolume:vi.fn()},player={position:new THREE.Vector3().copy(gasOrigin)},pcUse={isActive:true,riseQuickly:rise};
  const game=Object.create(RussianStairwellGame.prototype);
  Object.assign(game,{quest,storyCaption:caption,storySpeech:speech,settings:{masterVolume:1},computerDesktop:{isOpen:true},pcUse,player,gasPosition:gasTarget,applyApartmentPower:power,deviceAudio:{powerCut:cut},saveNow:vi.fn()});
  try{
    quest.finishGame('lost');game.updateApartmentStory(.05,true);
    expect(speech.say).toHaveBeenCalledWith('Je devrais éteindre le gaz.');
    for(let i=0;i<150;i++)game.updateApartmentStory(.05,true);
    expect(rise).not.toHaveBeenCalled();expect(cut).not.toHaveBeenCalled();
    const before=quest.snapshot();for(let i=0;i<60;i++)game.updateApartmentStory(.05,false);expect(quest.snapshot()).toEqual(before);
    speech.busy=false;game.updateApartmentStory(.05,true);expect(rise).toHaveBeenCalledOnce();expect(cut).not.toHaveBeenCalled();
    game.computerDesktop.isOpen=false;pcUse.isActive=false;
    for(let i=0;i<50;i++){player.position.set(gasOrigin.x+(gasTarget.x-gasOrigin.x)*i/100,gasOrigin.y,gasOrigin.z+(gasTarget.z-gasOrigin.z)*i/100);game.updateApartmentStory(.05,true);}
    expect(cut).not.toHaveBeenCalled();
    player.position.set(gasOrigin.x+(gasTarget.x-gasOrigin.x)*.51,gasOrigin.y,gasOrigin.z+(gasTarget.z-gasOrigin.z)*.51);game.updateApartmentStory(.05,true);
    expect(cut).toHaveBeenCalledOnce();expect(power).toHaveBeenCalledOnce();expect(speech.say).toHaveBeenLastCalledWith('Merde… une coupure.',.7);
    const spoken=speech.say.mock.calls.length;game.quest=new ApartmentQuest(quest.snapshot());for(let i=0;i<150;i++)game.updateApartmentStory(.05,true);
    expect(cut).toHaveBeenCalledOnce();expect(speech.say).toHaveBeenCalledTimes(spoken);
  }finally{caption.dispose();container.remove();}
});

it('advances passive objects with one fixed driver while the computer is open', () => {
  const probe=Object.create(RussianStairwellGame.prototype),stepDynamics=vi.fn(),update=vi.fn();
  Object.assign(probe,{physics:{stepDynamics},objects:{update},accumulator:0});
  for(let i=0;i<30;i++)probe.stepPassivePhysics(1/30);
  expect(stepDynamics).toHaveBeenCalledTimes(60);expect(stepDynamics).toHaveBeenLastCalledWith(1/60);expect(update).toHaveBeenCalledTimes(30);
});

it('hesitates only for a real exit attempt after the PC recovery, keeps an already-open leaf unchanged and permits initial entry',()=>{
  const probe=Object.create(RussianStairwellGame.prototype),say=vi.fn(),door={restoreState:vi.fn(),getState:()=>({progress:1,targetProgress:1})};
  const inventory=new InventoryState();Object.assign(probe,{quest:{devices:{outageTriggered:false}},inventory,apartment:{doorCenter:new THREE.Vector3(-2,9.8,-2.7),floorY:8.67},exitReminderArmed:true,storyCaption:{say},door});
  const p=new THREE.Vector3(-2.45,9.535,-2.7),m=new THREE.Vector3(.2,-.04,0);
  probe.constrainExit(p,m);expect(m.x).toBe(.2);expect(say).not.toHaveBeenCalled();
  probe.quest.devices.outageTriggered=true;probe.pcUse={isActive:true};probe.constrainExit(p,m);expect(m.x).toBe(.2);
  probe.pcUse.isActive=false;probe.constrainExit(p,m);expect(m.x).toBeCloseTo(.07);expect(say).toHaveBeenCalledOnce();
  for(let i=0;i<80;i++)probe.constrainExit(p,new THREE.Vector3(.2,0,0));expect(say).toHaveBeenCalledOnce();expect(door.restoreState).not.toHaveBeenCalled();expect(door.getState().progress).toBe(1);
  const entering=new THREE.Vector3(-.2,0,0);probe.constrainExit(p,entering);expect(entering.x).toBe(-.2);
  inventory.acquireLamp();const allowed=new THREE.Vector3(.2,0,0);probe.constrainExit(p,allowed);expect(allowed.x).toBe(.2);
});
it('allows an older post-outage save outside the apartment to reopen the door and retrieve the lamp',()=>{
  const probe=Object.create(RussianStairwellGame.prototype);Object.assign(probe,{quest:{devices:{outageTriggered:true}},inventory:new InventoryState(),player:{position:new THREE.Vector3(-1,9.535,-2.7)},apartment:{doorCenter:new THREE.Vector3(-2,9.8,-2.7)},exitReminderArmed:true,storyCaption:{say:vi.fn()}});
  expect(probe.allowEntranceOpening()).toBe(true);probe.player.position.x=-2.8;expect(probe.allowEntranceOpening()).toBe(false);expect(probe.storyCaption.say).toHaveBeenCalledOnce();
});
it('mounts the replacement only once and preserves the outage history when restoring apartment lights',()=>{
  const probe=Object.create(RussianStairwellGame.prototype),activate=vi.fn(),removeChunk=vi.fn(),setPower=vi.fn(),setOldPower=vi.fn();
  const scene=new THREE.Scene(),group=new THREE.Group(),neighbor=new THREE.Group();neighbor.name='east-neighbor-door-5-leaf';group.add(neighbor);
  Object.assign(probe,{quest:{devices:{outageTriggered:true,lightOn:true}},corridorStory:new CorridorStory(),corridor:{activate,setLights:vi.fn()},physics:{removeChunk,batchChunkChanges:(f:()=>void)=>f()},scene,environment:{group:new THREE.Group(),showPostOutage:vi.fn(),setPowerAvailable:setOldPower},apartment:{group,setPowerAvailable:setPower,setInteriorLightsEnabled:vi.fn()},camera:new THREE.PerspectiveCamera(),playerCamera:new THREE.PerspectiveCamera(),settings:{brightness:1},root:document.createElement('div')});
  probe.syncCorridor();probe.syncCorridor();expect(activate).toHaveBeenCalledOnce();expect(removeChunk.mock.calls.map(c=>c[0])).toEqual(['origin','stairwell-furniture']);expect(neighbor.visible).toBe(false);
  probe.corridorStory.state.apartmentRelit=true;probe.applyApartmentPower();expect(setPower).toHaveBeenLastCalledWith(true);expect(setOldPower).toHaveBeenLastCalledWith(false);expect(probe.quest.devices.outageTriggered).toBe(true);
});
