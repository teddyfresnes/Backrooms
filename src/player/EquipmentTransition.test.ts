import {expect,it} from 'vitest';
import {EquipmentTransition} from './EquipmentTransition';
it('replaces the model only below view and coalesces rapid wheel changes into the latest selection',()=>{
  const motion=new EquipmentTransition();
  for(let i=0;i<20;i++)motion.update('compass',1/60);
  expect(motion.presented).toBe('compass');expect(motion.lower).toBe(0);
  motion.update('torch',1/60);expect(motion.presented).toBe('compass');expect(motion.lower).toBeGreaterThan(0);
  for(let i=0;i<6;i++)motion.update(i%2?'prop':'torch',1/60);
  let previous=motion.presented;
  for(let i=0;i<30;i++){
    motion.update('prop',1/60);
    if(motion.presented!==previous)expect(motion.amount).toBeGreaterThan(.98);
    previous=motion.presented;
  }
  expect(motion.presented).toBe('prop');expect(motion.lower).toBe(0);
  motion.update('torch',1/60);const lower=motion.lower;motion.update('prop',1/60);
  expect(motion.lower).toBeLessThan(lower);expect(motion.presented).toBe('prop');
  for(let i=0;i<20;i++)motion.update(undefined,1/60);expect(motion.presented).toBeUndefined();expect(motion.amount).toBe(1);
  motion.hide();motion.update('torch',0);expect(motion.presented).toBe('torch');expect(motion.lower).toBe(1);
});
