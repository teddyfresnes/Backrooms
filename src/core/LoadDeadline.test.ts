import {afterEach,expect,it,vi} from 'vitest';
import {withLoadDeadline} from './LoadDeadline';
afterEach(()=>vi.useRealTimers());
it('bounds a stalled load and clears its timer after success or cancellation',async()=>{
 vi.useFakeTimers();const controller=new AbortController();
 await expect(withLoadDeadline(Promise.resolve('ready'),controller.signal,100)).resolves.toBe('ready');expect(vi.getTimerCount()).toBe(0);
 const stuck=withLoadDeadline(new Promise(()=>{}),controller.signal,100);const timed=expect(stuck).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(100);await timed;expect(vi.getTimerCount()).toBe(0);
 const cancelled=withLoadDeadline(new Promise(()=>{}),controller.signal,100);const aborted=expect(cancelled).rejects.toMatchObject({name:'AbortError'});controller.abort();await aborted;expect(vi.getTimerCount()).toBe(0);
});
