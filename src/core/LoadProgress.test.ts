// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { LoadProgress, ENTRY_LOAD_TASKS, type EntryLoadTask } from './LoadProgress';
it('shows the current GPU operation without inventing progress', () => {
  const load = new LoadProgress(), updates: Array<[number, string | undefined]> = [];
  load.subscribe((value, phase) => updates.push([value, phase]));
  load.start('gpu'); load.report('gpu', .55, 'Compilation des shaders');
  expect(updates.at(-1)![0]).toBeCloseTo(.0605);
  expect(updates.at(-1)![1]).toBe('Compilation des shaders');
  load.report('gpu', .55, 'Compilation des shaders');
  expect(updates.at(-1)).toEqual(updates.at(-2));
});
it('combines bytes and completed tasks, stays still while unmeasured work runs, and reserves readiness', () => {
  const load = new LoadProgress(), updates: number[]=[]; load.subscribe(p=>updates.push(p));
  load.start('network'); load.report('network',.5); expect(updates.at(-1)).toBe(.16);
  load.start('decode'); load.report('network',.25); expect(updates.at(-1)).toBe(.16);
  for(const task of Object.keys(ENTRY_LOAD_TASKS) as EntryLoadTask[]) if(task!=='ready') load.complete(task);
  expect(updates.at(-1)).toBe(.98);
  const info=vi.spyOn(console,'info').mockImplementation(()=>{});
  load.finish(); expect(updates.at(-1)).toBe(1); expect(updates.every((n,i)=>i===0||n>=updates[i-1]!)).toBe(true);
  info.mockRestore();
});
