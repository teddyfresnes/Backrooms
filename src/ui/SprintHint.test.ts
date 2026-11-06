import {expect,it} from 'vitest';
import {sprintHintText} from './SprintHint';
import {defaultControlBindings} from '../input/ControlBindings';
it('shows configured sprint controls and preserves the fixed right-shift alternative',()=>{
  const bindings=defaultControlBindings('azerty');expect(sprintHintText(bindings)).toBe('Maj pour courir');
  expect(sprintHintText({...bindings,sprint:'KeyR'})).toBe('R ou Maj droite pour courir');
});
