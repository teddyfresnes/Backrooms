// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', () => ({ default: {} }));
vi.mock('../physics/PhysicsWorld', () => ({ PhysicsWorld: class {} }));
// This host lifecycle fixture stubs collision queries; its Rapier-backed
// adapter must also stay outside happy-dom's browser import resolution.
vi.mock('../character/CharacterEnvironment', () => ({ CharacterEnvironment: class {} }));
vi.mock('../apartment/Flashlight', () => ({ Flashlight: class {} }));
vi.mock('../apartment/ApartmentFixtures', () => ({ ApartmentFixtures: class {} }));
vi.mock('../apartment/ClosetHide', () => ({ ClosetHide: class {} }));
vi.mock('../apartment/ComputerChair', () => ({ ComputerChair: class {} }));
vi.mock('../apartment/ComputerUseSequence', () => ({ ComputerUseSequence: class {} }));
vi.mock('../apartment/ApartmentObjectInteraction', () => ({ ApartmentObjectInteraction: class {} }));
vi.mock('../apartment/ApartmentComputerInteraction', () => ({ ApartmentComputerInteraction: class {} }));
vi.mock('../apartment/ApartmentDevices', () => ({ ApartmentDevices: class {}, apartmentDevicePositions: () => ({}) }));
vi.mock('../character/CharacterRuntime', () => ({ CharacterRuntime: class {} }));
vi.mock('../audio/SiteAudio', () => ({ siteAudio: new Proxy({}, { get: () => () => Promise.resolve() }) }));
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement=document.createElement('canvas'); shadowMap={enabled:false};
    info={autoReset:false,reset:vi.fn()}; capabilities={getMaxAnisotropy:()=>1};
    setPixelRatio(){} setSize(){} setAnimationLoop(){} dispose(){} forceContextLoss(){}
  } };
});
import * as THREE from 'three';
import { RussianStairwellGame } from './RussianStairwellGame';
import { Game } from './Game';
import { PlayerController } from '../player/PlayerController';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { defaultControlBindings } from '../input/ControlBindings';
import { ComputerDesktop } from '../ui/desktop/ComputerDesktop';
import { ExperienceUI } from '../ui/ExperienceUI';
import { defaultGameSettings } from '../ui/settings';
import { ApartmentQuest } from '../story/ApartmentQuest';

// WebGL and collision queries are stand-ins here. The host's actual frame,
// entry/pause code, UI, InputManager and PlayerController run unchanged.
const games: RussianStairwellGame[]=[];
it('completes locate arguments through the actual input and executes the French target and its aliases', async () => {
  const game=Object.create(Game.prototype) as Record<string, any>;
  const target={command:'toboggans',label:'Les toboggans',aliases:['slides','toboggan','backrooms-slides'],distance:548,chunkKey:'0:-5:0',position:{x:0,y:.865,z:-548}};
  const prepareLocateTarget=vi.fn(async()=>true),teleport=vi.fn(),showConsoleMessage=vi.fn();
  Object.assign(game,{worldStream:{getLocateTargets:()=>[target],prepareLocateTarget,update:vi.fn()},player:{position:new THREE.Vector3(),teleport},
    locateRequestId:0,disposed:false,elapsed:0,updateDebugState:vi.fn()});
  const ui=new ExperienceUI(document.body,{
    enter:vi.fn(),regenerate:vi.fn(),returnToMainMenu:vi.fn(),toggleFullscreen:vi.fn(),settingsChanged:vi.fn(),consoleVisibility:vi.fn(),
    submitConsole:(value,mode)=>game.submitConsole(value,mode),completeConsole:(value,mode)=>game.completeConsole(value,mode),
  },defaultGameSettings());
  game.ui=ui; vi.spyOn(ui,'showConsoleMessage').mockImplementation(showConsoleMessage);
  try {
    ui.openConsole('command');
    const input=document.querySelector<HTMLInputElement>('[data-ui="console-input"]')!;
    const type=(value:string)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
    const tab=()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true,cancelable:true}));
    type('/loc');tab();expect(input.value).toBe('/locate ');
    tab();expect(input.value).toBe('/locate toboggans');
    type('/locate ');tab();expect(input.value).toBe('/locate toboggans');
    type('/locate tobo');tab();expect(input.value).toBe('/locate toboggans');
    type('/locate\t');tab();expect(input.value).toBe('/locate toboggans');
    for (const alias of ['toboggans','slides','toboggan','backrooms-slides']) {
      const result=game.submitConsole(`/locate ${alias}`,'command');
      expect(result.close).toBe(true);await Promise.resolve();
      expect(teleport).toHaveBeenLastCalledWith(target.position);
    }
    expect(prepareLocateTarget).toHaveBeenCalledTimes(4);
    prepareLocateTarget.mockResolvedValueOnce(false);
    const before=teleport.mock.calls.length;
    await game.teleportToLocateTarget(target);
    expect(teleport).toHaveBeenCalledTimes(before);
    expect(showConsoleMessage).toHaveBeenLastCalledWith(expect.objectContaining({kind:'error',text:expect.stringContaining('DESTINATION INDISPONIBLE')}));
  } finally { ui.dispose(); }
});
it('keeps the top-floor direction in the parcel objective after collecting the mail',()=>{
  const game=Object.create(RussianStairwellGame.prototype) as Record<string,any>;
  Object.assign(game,{arrivalStory:{getState:()=> 'home'},quest:new ApartmentQuest(),giftOpened:false});
  expect(game.currentObjective()).toBe('Ouvrir le cadeau de Chloé devant ma porte, au dernier étage.');
});
it('warms the launcher effects at low resolution and presents only the final frame at full size', async () => {
  const game = Object.create(Game.prototype) as Record<string, any>;
  let width = 800, height = 600;
  const sizes: number[][] = [];
  const renderer = { setPixelRatio: vi.fn(), setSize: vi.fn((w, h) => { width = w; height = h; }), getContext: () => ({}) };
  const postFX = { setSize: vi.fn(), setVhs: vi.fn(), setLensRain: vi.fn(), render: vi.fn(() => sizes.push([width, height])) };
  const resize = vi.fn(() => { renderer.setSize(800, 600); postFX.setSize(800, 600); });
  Object.assign(game, { renderer, postFX, resize, disposed: false });
  await game.warmupPostFX();
  expect(sizes).toEqual([[320, 180], [320, 180], [800, 600]]);
  expect(resize).toHaveBeenCalledOnce();
  postFX.render.mockImplementationOnce(() => { throw new Error('render failed'); });
  await expect(game.warmupPostFX()).rejects.toThrow('render failed');
  expect([width, height]).toEqual([800, 600]);
});
beforeEach(()=>{
  vi.spyOn(window,'matchMedia').mockReturnValue({matches:false} as MediaQueryList);
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
  document.exitPointerLock=()=>{Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});document.dispatchEvent(new Event('pointerlockchange'));};
  vi.stubGlobal('requestAnimationFrame',()=>1); vi.stubGlobal('cancelAnimationFrame',()=>{});
  localStorage.clear();
});
afterEach(()=>{for(const game of games.splice(0))game.dispose();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture() {
  const app=document.createElement('div');document.body.append(app);
  const returnToMail=vi.fn(),enterBackrooms=vi.fn();
  const runtime=new RussianStairwellGame(app,{kind:'new'},{onRequestNewGame(){},onReturnToMail:returnToMail,onRequestMainMenu(){},onRequestLoadGame(){},onEnterBackrooms:enterBackrooms},{deferEntry:true});
  games.push(runtime);
  // Private fields are intentionally exposed only to this integration fixture.
  const game=runtime as unknown as Record<string, any>;
  const position=new THREE.Vector3(0,.865,-3);
  const physics={crouchCenterOffset:0,crouchedCenterDrop:.3,
    getPosition:(out=new THREE.Vector3())=>out.copy(position),getStandingPosition:(out=new THREE.Vector3())=>out.copy(position),
    teleport:(p:THREE.Vector3)=>position.copy(p),setCrouched:()=>false,dispose(){},
    move:(delta:THREE.Vector3)=>{const moved=new THREE.Vector3(delta.x,0,delta.z);position.add(moved);return {position:position.clone(),grounded:true,moved};}};
  const listener={setPosition:vi.fn(),setOrientation:vi.fn()};
  const audio={spatialBus:{context:{listener}},start:async()=>{},setSuspended:async()=>{},
    setInteriorMix(){},updateInteriorGain(){},stopRecordedEffects:vi.fn(),getOutput:()=>null,dispose(){}};
  const canvas=game.renderer.domElement as HTMLCanvasElement;
  const request=vi.fn(async()=>{});canvas.requestPointerLock=request;
  const player=new PlayerController(game.playerCamera,canvas,physics as unknown as PhysicsWorld,{
    onLockChange:locked=>game.onPlayerLockChange(locked),onPointerCaptureChange:captured=>game.ui.setPointerCaptureRequired(!captured),
    onFootstep(){},onInteract(){},onLand(){},onSafePosition(){},onFallReset(){},
  });
  player.setControlBindings({...defaultControlBindings(),forward:'KeyI'});
  Object.assign(game,{initialized:true,player,physics,audio,
    environment:{update(){},dispose(){}},door:{update(){},dispose(){}},
    character:{setActive:(active:boolean)=>player.setInputEnabled(active),setArrivalPresentation(){},getEquipmentHandPosition:()=>false,setHeldItem(){},getHeldItemFrame:()=>false,dispose(){},
      update:(dt:number)=>{player.fixedUpdate(dt);player.renderUpdate(dt,1);game.camera.copy(game.playerCamera);}},
    postFX:{render:vi.fn(),setPerformanceMode(){},setSize(){},setVhs(){},setLensRain(){},dispose(){}}});
  game.ui.setReady();
  const step=()=>game.frame(game.previousTime+1000/60);
  const key=(type:string)=>window.dispatchEvent(new KeyboardEvent(type,{key:'i',code:'KeyI',bubbles:true}));
  const aim=()=>{for(const x of [100,140]){const event=new MouseEvent('mousemove',{bubbles:true,clientX:x,clientY:100});Object.defineProperties(event,{movementX:{value:40},movementY:{value:15}});canvas.dispatchEvent(event);}};
  const capture=()=>{Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:canvas});document.dispatchEvent(new Event('pointerlockchange'));};
  return {app,game,player,canvas,request,listener,step,key,aim,capture,returnToMail,enterBackrooms};
}

it.each(['level0', 'intro'])('runs /skip %s through the live console during the chase and suspends the old runtime', destination => {
  const {app,game,player,step,returnToMail,enterBackrooms}=fixture();
  game.enterAfterIntro();
  game.inventory.acquireLamp();
  game.inventory.acquireCompass();
  const inventory=game.inventory.snapshot();
  const update=vi.fn(),suspend=vi.fn();
  game.encounter={isActive:true,locksInput:true,update,suspend,dispose(){}};
  game.closet={isActive:true,exitLocked:true,dispose(){}};
  game.doorKnocks={time:0};
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'/',code:'Slash',bubbles:true,cancelable:true}));
  expect(game.ui.isConsoleOpen).toBe(true);
  expect(player.isInputEnabled).toBe(false);
  const input=app.querySelector<HTMLInputElement>('[data-ui="console-input"]')!;
  input.value=`/skip ${destination}`;
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
  expect(game.ui.isConsoleOpen).toBe(false);
  expect(player.isInputEnabled).toBe(false);
  expect(suspend).toHaveBeenCalledOnce();
  expect(game.audio.stopRecordedEffects).toHaveBeenCalledOnce();
  expect(game.doorKnocks).toBeNull();
  for(let i=0;i<240;i++)step();
  expect(update).not.toHaveBeenCalled();
  if(destination==='level0') {
    expect(enterBackrooms).toHaveBeenCalledExactlyOnceWith(inventory);
    expect(returnToMail).not.toHaveBeenCalled();
  } else {
    expect(returnToMail).toHaveBeenCalledOnce();
    expect(enterBackrooms).not.toHaveBeenCalled();
  }
});

it('enables F and the mouse wheel after each exit from the checkpoint while the encounter stays active', () => {
  const {game,canvas}=fixture();
  game.enterAfterIntro();
  game.inventory.acquireLamp();game.inventory.acquireCompass();
  const encounter=game.encounter={isActive:true,locksInput:true,dispose(){}};
  const closet=game.closet={isActive:true,dispose(){}};
  const f=(type:string)=>window.dispatchEvent(new KeyboardEvent(type,{key:'f',code:'KeyF',bubbles:true}));
  for(let attempt=0;attempt<4;attempt++){
    closet.isActive=true;encounter.locksInput=true;
    const dark=game.inventory.state.lampOn;
    f('keydown');f('keyup');expect(game.inventory.state.lampOn).toBe(dark);
    closet.isActive=false;encounter.locksInput=false;
    f('keydown');f('keyup');expect(game.inventory.state.lampOn).toBe(!dark);
    const selected=game.inventory.state.selected;
    canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:100,cancelable:true}));
    expect(game.inventory.state.selected).not.toBe(selected);
  }
});
it('keeps playing on blur with a recapture prompt, pauses on Escape, freezes uncaptured look, and resumes configured controls across repeated games',()=>{
  for(let run=0;run<3;run++){
    const {app,game,player,canvas,request,listener,step,key,aim,capture}=fixture();
    game.enterAfterIntro();
    expect(app.inert).toBeFalsy();expect(document.activeElement).toBe(canvas);expect(request).not.toHaveBeenCalled();
    const before=player.position.clone(); key('keydown');for(let i=0;i<45;i++)step();key('keyup');
    expect(player.position.distanceTo(before)).toBeGreaterThan(.4);expect(listener.setPosition).toHaveBeenCalledTimes(45);
    const rotation=player.getLookQuaternion().clone();aim();expect(player.getLookQuaternion().angleTo(rotation)).toBe(0);
    capture();aim();step();expect(player.getLookQuaternion().angleTo(rotation)).toBeGreaterThan(.03);
    expect(game.postFX.render).toHaveBeenCalledTimes(46);
    // Switching to another application is not a pause: play goes on and the
    // recapture affordance shows until the next click on the game.
    window.dispatchEvent(new Event('blur'));expect(game.ui.isPaused).toBe(false);
    expect(app.querySelector<HTMLButtonElement>('[data-ui="capture-pointer"]')!.hidden).toBe(false);
    const away=player.position.clone();key('keydown');for(let i=0;i<20;i++)step();key('keyup');
    expect(player.position.distanceTo(away)).toBeGreaterThan(.1);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
    expect(game.ui.isPaused).toBe(true);
    const paused=player.position.clone();key('keydown');for(let i=0;i<8;i++)step();key('keyup');
    expect(player.position.distanceTo(paused)).toBe(0);expect(game.ui.isPaused).toBe(true);
    // The actual resume button forwards its click; a synthetic click may enter
    // gameplay, but must never request privileged browser capture.
    const resume=app.querySelector<HTMLButtonElement>('.pause-only [data-ui="enter"]')!;
    expect(resume.disabled).toBe(false);resume.click();expect(game.ui.isPaused).toBe(false);
    expect(request).not.toHaveBeenCalled();
    key('keydown');for(let i=0;i<30;i++)step();key('keyup');expect(player.position.distanceTo(paused)).toBeGreaterThan(.2);
    // As in the router: the replaced game is suspended, then torn down.
    game.suspendForTransition();game.dispose();
  }
});
it('restores a saved view and movement, and ignores audio APIs that expose no spatial setters',()=>{
  const {game,player,step,key,aim,capture}=fixture();
  game.audio.spatialBus.context.listener={};
  player.teleport({x:1,y:.865,z:-3});
  const saved=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,.4,0,'YXZ'));player.setLookQuaternion(saved);
  game.enter(true);expect(player.getLookQuaternion().angleTo(saved)).toBeLessThan(1e-6);
  const before=player.position.clone();key('keydown');expect(()=>{for(let i=0;i<40;i++)step();}).not.toThrow();key('keyup');
  expect(player.position.distanceTo(before)).toBeGreaterThan(.3);
  aim();expect(player.getLookQuaternion().angleTo(saved)).toBeLessThan(1e-6);
  capture();aim();expect(player.getLookQuaternion().angleTo(saved)).toBeGreaterThan(.03);
});

it('opens pause above the real desktop with P or Escape, freezes passive ticks and resumes the same PC sequence and windows',()=>{
  const {app,game,player,step}=fixture();game.saveNow=vi.fn();game.enter(true);
  const sequenceUpdate=vi.fn(),passive=vi.fn();game.physics.stepDynamics=passive;
  game.pcUse={isActive:true,isUsing:true,update:sequenceUpdate,dispose(){}};
  const desktop=new ComputerDesktop(app,game.quest,()=>player.unlock(),()=>{});
  game.computerDesktop=desktop;desktop.open();
  const clock=desktop.element.querySelector('[data-app="clock"].pc-window');expect(clock).not.toBeNull();
  step();const elapsed=game.elapsed,ticks=passive.mock.calls.length,updates=sequenceUpdate.mock.calls.length;
  const camera=game.camera.clone();
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',code:'KeyP',bubbles:true,cancelable:true}));
  expect(game.ui.isPaused).toBe(true);expect(desktop.isOpen).toBe(true);expect(desktop.element.hidden).toBe(true);
  for(let i=0;i<120;i++)step();
  expect(game.elapsed).toBe(elapsed);expect(passive).toHaveBeenCalledTimes(ticks);expect(sequenceUpdate).toHaveBeenCalledTimes(updates);
  expect(game.camera.quaternion.angleTo(camera.quaternion)).toBe(0);
  app.querySelector<HTMLButtonElement>('.pause-only [data-ui="enter"]')!.click();
  expect(game.ui.isPaused).toBe(false);expect(desktop.element.hidden).toBe(false);expect(desktop.element.querySelector('[data-app="clock"].pc-window')).toBe(clock);
  step();expect(sequenceUpdate).toHaveBeenCalledTimes(updates+1);expect(sequenceUpdate.mock.calls.at(-1)![0]).toBeLessThan(.05);
  const input=document.createElement('input');desktop.element.append(input);input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'p',code:'KeyP',bubbles:true,cancelable:true}));expect(game.ui.isPaused).toBe(false);
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));expect(game.ui.isPaused).toBe(true);expect(desktop.isOpen).toBe(true);
});

it('pauses solely from native capture loss when the browser consumes Escape, and stays paused when focus returns',()=>{
  const {game,player,capture,step,key}=fixture();game.enter(true);capture();
  document.exitPointerLock();
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
  expect(game.ui.isPaused).toBe(true);const position=player.position.clone();
  window.dispatchEvent(new Event('focus'));key('keydown');for(let i=0;i<40;i++)step();key('keyup');
  expect(player.position.distanceTo(position)).toBe(0);expect(game.ui.isPaused).toBe(true);
});
