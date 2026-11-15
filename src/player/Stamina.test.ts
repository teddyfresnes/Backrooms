import { describe, expect, it } from 'vitest';
import { Stamina, STAMINA_TUNING } from './Stamina';

const DT = 1 / 30;
const sprintUntilEmpty = (stamina: Stamina, threat = 0, limit = 120): number => {
  let time = 0;
  while (stamina.canSprint && time < limit) { stamina.update(DT, { sprinting: true, moving: true, threat }); time += DT; }
  return time;
};

describe('stamina', () => {
  it('triples the previous 22-second calm sprint', () => {
    const stamina = new Stamina();
    const seconds = sprintUntilEmpty(stamina);
    expect(seconds).toBeCloseTo(22*3,0);
    expect(stamina.exhausted).toBe(true);
    expect(stamina.critical).toBe(true);
    expect(stamina.breath).toBeGreaterThan(0.6);
  });

  it('keeps the sprint cut until the resume threshold, with no stutter in between', () => {
    const stamina = new Stamina();
    sprintUntilEmpty(stamina);
    let blocked = 0, flips = 0, previous = stamina.canSprint;
    for (let t = 0; t < 30 && !stamina.canSprint; t += DT) {
      stamina.update(DT, { sprinting: true, moving: true, threat: 0 });
      if (stamina.canSprint !== previous) flips += 1;
      previous = stamina.canSprint;
      blocked += DT;
    }
    expect(stamina.canSprint).toBe(true);
    expect(flips).toBeLessThanOrEqual(1);
    expect(stamina.level).toBeGreaterThanOrEqual(STAMINA_TUNING.resumeThreshold);
    // Walking back to the threshold takes a while: a real recovery, not a blink.
    expect(blocked).toBeGreaterThan(8);
  });

  it('recovers slowly while walking, faster standing still', () => {
    const walking = new Stamina(), standing = new Stamina();
    sprintUntilEmpty(walking); sprintUntilEmpty(standing);
    for (let t = 0; t < 10; t += DT) {
      walking.update(DT, { sprinting: false, moving: true, threat: 0 });
      standing.update(DT, { sprinting: false, moving: false, threat: 0 });
    }
    expect(standing.level).toBeGreaterThan(walking.level * 2);
    expect(walking.level).toBeGreaterThan(0.15);
  });

  it('gives adrenaline when hunted: cheaper sprint and a refill at the scream', () => {
    const calm = new Stamina(), hunted = new Stamina();
    for (let t = 0; t < 36; t += DT) calm.update(DT, { sprinting: true, moving: true, threat: 0 });
    for (let t = 0; t < 36; t += DT) hunted.update(DT, { sprinting: true, moving: true, threat: t < 0.5 ? 0 : 1 });
    expect(hunted.adrenaline).toBeGreaterThan(0.9);
    expect(hunted.level).toBeGreaterThan(calm.level + 0.2);
    // A whole chase from rested lasts well beyond the calm sprint.
    const chased = new Stamina();
    chased.update(DT, { sprinting: false, moving: true, threat: 0 });
    expect(sprintUntilEmpty(chased, 1)).toBeGreaterThan(100);
  });

  it('crashes after the fear: heavy breath and a slower recovery for a few seconds', () => {
    const stamina = new Stamina(), rested = new Stamina();
    for (let t = 0; t < 84; t += DT) stamina.update(DT, { sprinting: true, moving: true, threat: 1 });
    let crashed = false;
    for (let t = 0; t < 14 && !crashed; t += DT) {
      stamina.update(DT, { sprinting: false, moving: true, threat: 0 });
      crashed = stamina.crash > 0;
    }
    expect(crashed).toBe(true);
    const from = stamina.level;
    rested.level = from;
    for (let t = 0; t < 3; t += DT) {
      stamina.update(DT, { sprinting: false, moving: true, threat: 0 });
      rested.update(DT, { sprinting: false, moving: true, threat: 0 });
    }
    expect(stamina.breath).toBeGreaterThan(0.5);
    expect(stamina.level - from).toBeLessThan((rested.level - from) * 0.6);
  });

  it('starts rested (never saved) and resets fully', () => {
    const stamina = new Stamina();
    expect(stamina.level).toBe(1);
    sprintUntilEmpty(stamina, 1);
    stamina.reset();
    expect(stamina.level).toBe(1);
    expect(stamina.canSprint).toBe(true);
    expect(stamina.adrenaline).toBe(0);
  });
  it('shows the cue throughout recovery and gates the pulse with exhaustion hysteresis, never fear',()=>{
    const stamina=new Stamina();stamina.update(DT,{sprinting:false,moving:false,threat:1});
    expect(stamina.heart).toBe(0);expect(stamina.showCue).toBe(false);
    stamina.reset();stamina.update(DT,{sprinting:true,moving:true,threat:0});expect(stamina.showCue).toBe(true);expect(stamina.heart).toBe(0);
    for(const [level,audible] of [[.07,false],[.055,true],[.075,true],[.095,true],[.105,false],[.075,false]] as const){
      stamina.level=level;stamina.update(0,{sprinting:true,moving:true,threat:0});expect(stamina.heart>0).toBe(audible);
    }
    for(let t=0;t<20;t+=DT){stamina.update(DT,{sprinting:false,moving:false,threat:0});expect(stamina.showCue).toBe(stamina.level<1);}
    expect(stamina.showCue).toBe(false);expect(stamina.heart).toBe(0);
  });
});
