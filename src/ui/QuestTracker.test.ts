// @vitest-environment happy-dom
import {expect,it}from 'vitest';import {QuestTracker}from './QuestTracker';
it('shows one global objective, replaces rapid changes with the newest, freezes in pause and supports reduced motion',()=>{
  const host=document.createElement('div'),tracker=new QuestTracker(host);tracker.update('Ancien',true);tracker.update('Obsolète',true);tracker.tick(.05,true);const paused=tracker.element.style.cssText;tracker.tick(.05,false);expect(tracker.element.style.cssText).toBe(paused);
  tracker.update('Dernier',true);for(let i=0;i<12;i++)tracker.tick(.05,true);expect(tracker.element.textContent).toContain('Dernier');expect(tracker.element.textContent).not.toContain('Obsolète');expect(host.querySelectorAll('.quest-tracker')).toHaveLength(1);
  tracker.tick(0,true,true);tracker.update('Réduit',true);expect(tracker.element.textContent).toContain('Réduit');tracker.dispose();
});
