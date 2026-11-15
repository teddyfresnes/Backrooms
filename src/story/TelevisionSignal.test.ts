import {expect,it} from 'vitest';
import {televisionSignal} from './TelevisionSignal';
it('derives the signal from persisted outage and corridor relighting rather than wall-clock delays',()=>{
  expect(televisionSignal(false,false)).toBe('normal');
  expect(televisionSignal(true,false)).toBe('static');
  expect(televisionSignal(true,true)).toBe('broadcast');
});
