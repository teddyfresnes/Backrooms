import { afterEach, expect, it } from 'vitest';
import { LIGHT_DISTURBANCE, LightFlicker } from './LightDisturbance';
import { SeededRandom } from '../world/SeededRandom';

afterEach(() => LightFlicker.clear());
it('supports a single real fixture and a wide outage, then returns every lamp to normal', () => {
  const flicker=new LightFlicker(new SeededRandom('lighting'));
  for(let i=0;i<30;i++)flicker.update(.1,1);
  flicker.apply({x:7,y:2.7,z:-40},3.2,true);
  expect(LIGHT_DISTURBANCE.center.value.toArray()).toEqual([7,2.7,-40,-3.2]);
  flicker.apply({x:20,y:2.7,z:-60},42);
  expect(LIGHT_DISTURBANCE.center.value.w).toBe(42);expect(LIGHT_DISTURBANCE.state.value.x).toBeGreaterThan(.9);
  for(let i=0;i<150;i++)flicker.update(.1,0);
  expect(flicker.amplitude).toBeLessThan(.001);
  LightFlicker.clear();expect(LIGHT_DISTURBANCE.state.value.toArray()).toEqual([0,1,1,0]);
});
