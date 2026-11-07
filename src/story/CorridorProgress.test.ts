import {expect,it} from 'vitest';
import {CorridorStory,CORRIDOR_LAMPS,CORRIDOR_RETRY_LAMP,sanitizeCorridor,corridorLampTime} from './CorridorProgress';
const door={x:-2,y:8.67,z:-2.7};
function walk(story:CorridorStory,hasLamp=true){let events=0;for(let i=0;i<=205;i++)events+=Number(story.observe({x:door.x-.1+i*.1,y:door.y+.865,z:door.z},door,hasLamp,Math.PI/2));return events;}
it('requires real horizontal movement from the doorway, correct corridor/floor and the flashlight',()=>{
  const s=new CorridorStory();expect(walk(s)).toBe(0);s.activate();expect(walk(s,false)).toBe(0);
  for(let i=0;i<200;i++)expect(s.observe({x:door.x+25,y:30,z:door.z},door,true,0)).toBe(false);
  expect(s.observe({x:door.x+25,y:door.y+.865,z:door.z},door,true,0)).toBe(false);
  expect(s.state.triggered).toBe(false);
  const actual=new CorridorStory();actual.activate();expect(walk(actual)).toBe(1);expect(actual.state.distance).toBeGreaterThanOrEqual(19.9);expect(walk(actual)).toBe(0);
});
it('freezes the complete reaction and light wave in pause, restores without replaying, returns control as the wave passes and stops here',()=>{
  const s=new CorridorStory();s.activate();walk(s);const saved=s.snapshot();s.update(5,false);expect(s.snapshot()).toEqual(saved);
  for(let i=0;i<90;i++)s.update(.05,true);expect(s.litCount).toBeGreaterThan(0);expect(s.modal).toBe(true);
  const mid=s.snapshot();expect(sanitizeCorridor(mid)).toEqual(mid);const restored=new CorridorStory(mid);expect(walk(restored)).toBe(0);
  for(let i=0;i<100;i++)restored.update(.05,true);expect(restored.state.returned).toBe(true);expect(restored.litCount).toBeLessThan(CORRIDOR_LAMPS);
  for(let i=0;i<1000;i++)restored.update(.05,true);expect(restored.litCount).toBe(CORRIDOR_LAMPS);expect(restored.finished).toBe(true);expect(restored.objective(true)).toBeNull();
  const end=restored.snapshot();expect(new CorridorStory(end).snapshot()).toEqual(end);
});
it('rejects inconsistent checkpoints and selects the correct pre- and post-pickup objectives',()=>{
  const s=new CorridorStory();expect(s.objective(false)).toBeNull();s.activate();expect(s.objective(false)).toMatch(/Récupérer/);expect(s.objective(true)).toMatch(/tableau électrique/);expect(s.beforeExploring).toBe(true);
  expect(s.tryFuse()).toBe(true);expect(s.tryFuse()).toBe(false);expect(s.objective(true)).toBeNull();s.finishKnock();expect(s.objective(true)).toMatch(/voisins/);expect(s.beforeExploring).toBe(false);
  expect(sanitizeCorridor({...s.snapshot(),fuseTried:false,knockDone:true})).toBeNull();expect(sanitizeCorridor(s.snapshot())).toEqual(s.snapshot());
  expect(sanitizeCorridor({...s.snapshot(),triggered:true})).toBeNull();expect(sanitizeCorridor({...s.snapshot(),elapsed:NaN})).toBeNull();
});
it('consumes the spoken entry and sprint hint only after actual forward steps, including reloads',()=>{
  const s=new CorridorStory();s.activate();
  expect(s.consumeEntry()).toBe(false);s.observe({x:door.x+2,y:door.y+.865,z:door.z},door,true,0);expect(s.consumeEntry()).toBe(false);
  for(let i=0;i<=35;i++)s.observe({x:door.x+i*.1,y:door.y+.865,z:door.z},door,true,0);
  expect(s.consumeEntry()).toBe(true);expect(s.consumeEntry()).toBe(false);
  const restored=new CorridorStory(s.snapshot());expect(restored.consumeEntry()).toBe(false);
});
it.each([30,60,120])('starts at the apartment whatever the player position and accelerates identically at %s FPS, pausing and restoring every checkpoint',fps=>{
  const s=new CorridorStory();s.activate();walk(s);expect(s.firstLamp).toBe(0);
  // An older save that anchored the wave at the player's lamp is re-anchored at the apartment.
  expect(new CorridorStory({...s.snapshot(),waveStart:4}).firstLamp).toBe(0);
  let previous=Infinity;for(let i=1;i<42;i++){const gap=corridorLampTime(i)-corridorLampTime(i-1);expect(gap).toBeLessThan(previous);previous=gap;}
  expect(corridorLampTime(1)-corridorLampTime(0)).toBeCloseTo(.76);expect(previous).toBeLessThan(.11);
  for(let i=0;i<fps*6;i++)s.update(1/fps,true);
  const checkpoint=s.snapshot(),count=s.litCount;s.update(20,false);expect(s.snapshot()).toEqual(checkpoint);
  const restored=new CorridorStory(checkpoint);expect(restored.litCount).toBe(count);expect(restored.observe(door,door,true,0)).toBe(false);
  expect(count).toBe(3);restored.update(20,true);expect(restored.finished).toBe(true);
});

it('arms Bacteria only at the corridor reaction and persists survival without replaying it',()=>{
  const story=new CorridorStory();
  const trigger={x:door.x+20,y:door.y+.865,z:door.z};
  expect(story.canStartBacteria(trigger,door)).toBe(false);
  story.activate();walk(story);
  expect(story.canStartBacteria(trigger,door)).toBe(false);
  story.update(6,true);
  // Not before the wave has passed over the player.
  expect(story.canStartBacteria(trigger,door)).toBe(false);
  story.update(2,true);
  expect(story.canStartBacteria({...trigger,x:door.x-.5},door)).toBe(false);
  expect(story.canStartBacteria({...trigger,y:door.y-8},door)).toBe(false);
  expect(story.canStartBacteria(trigger,door)).toBe(true);
  story.update(20,true);
  story.rewindBacteria();
  expect(story.litCount).toBe(CORRIDOR_RETRY_LAMP+1);
  expect(story.modal).toBe(false);
  expect(story.canStartBacteria(trigger,door)).toBe(true);
  story.completeBacteria();
  const restored=new CorridorStory(sanitizeCorridor(story.snapshot())!);
  expect(restored.canStartBacteria(trigger,door)).toBe(false);
  expect(sanitizeCorridor({...story.snapshot(),bacteriaSurvived:'yes'})).toBeNull();
});
