import {expect,it} from 'vitest';
const GAS_THOUGHT='Je devrais couper le gaz avant que…';
import {interruptionPlan,interruptionProgress} from './InterruptedNarration';
it('leaves perceptible reading time after the gas phrase and cuts before the last word',()=>{
  const p=interruptionPlan(GAS_THOUGHT);expect(p.cutTime).toBeGreaterThan(2.8);expect(p.holdSeconds).toBeGreaterThan(1.5);
  const early=interruptionProgress(GAS_THOUGHT,1.15),late=interruptionProgress(GAS_THOUGHT,2.5);
  expect(GAS_THOUGHT.slice(0,early.visibleCharacters)).toContain('couper le gaz');expect(late.visibleCharacters).toBe(early.visibleCharacters);expect(late.canInterrupt).toBe(false);
  const end=interruptionProgress(GAS_THOUGHT,p.cutTime);expect(end.canInterrupt).toBe(true);expect(end.visibleCharacters).toBeLessThan(end.totalCharacters);expect(GAS_THOUGHT.slice(end.visibleCharacters)).toContain('que');
});
