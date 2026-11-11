// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {InputManager} from './InputManager';
import {defaultControlBindings,sanitizeControlBindings} from './ControlBindings';
const inputs:InputManager[]=[];
afterEach(()=>{for(const input of inputs.splice(0))input.dispose();document.body.replaceChildren();vi.restoreAllMocks();});
const fixture=()=>{const input=new InputManager();inputs.push(input);return input;};
function key(code:string,type='keydown',key=code,target:EventTarget=window,extra:KeyboardEventInit={}){
  const event=new KeyboardEvent(type,{code,key,bubbles:true,cancelable:true,...extra});target.dispatchEvent(event);return event;
}
it('supports primary AZERTY/QWERTY and fixed physical alternatives with Num Lock either way',()=>{
  for(const preset of ['azerty','qwerty'] as const){
    const input=fixture();input.setBindings(defaultControlBindings(preset));
    const main=preset==='azerty'?'z':'w';key('KeyW','keydown',main);expect(input.axes.forward).toBe(1);key('KeyW','keyup',main);
    for(const [code,printed,axis,value] of [['ArrowUp','ArrowUp','forward',1],['ArrowDown','ArrowDown','forward',-1],['ArrowLeft','ArrowLeft','right',-1],['ArrowRight','ArrowRight','right',1],['ShiftRight','Shift','sprint',true],['Digit0','à','crouch',true],['Numpad0','Insert','crouch',true],['Numpad0','0','crouch',true]] as const){
      expect(key(code,'keydown',printed).defaultPrevented).toBe(true);expect(input.axes[axis]).toBe(value);key(code,'keyup',printed);
    }
    key('Space');expect(input.consumeActionPress('jump')).toBe(true);expect(input.axes.crouch).toBe(false);key('Space','keyup');
    for(const code of ['ControlLeft','ControlRight']){key(code);expect(input.consumeActionPress('crouch')).toBe(true);expect(input.consumeActionPress('jump')).toBe(false);key(code,'keyup');}
    for(const printed of ['1','End']){key('Numpad1','keydown',printed);expect(input.consumeActionPress('interact')).toBe(true);key('Numpad1','keyup',printed);expect(input.consumeActionRelease('interact')).toBe(true);}
    key('KeyE','keydown','e');expect(input.consumeActionPress('interact')).toBe(true);key('KeyE','keyup','e');
  }
});
it('does not double-trigger repeats, leak input from fields/shadow DOM or retain a held key on blur/hidden',()=>{
  const input=fixture();key('Numpad1');expect(input.consumeActionPress('interact')).toBe(true);
  key('Numpad1','keydown','End',window,{repeat:true});expect(input.consumeActionPress('interact')).toBe(false);key('Numpad1','keyup');
  for(const tag of ['input','textarea','select']){const field=document.createElement(tag);document.body.append(field);expect(key('ArrowUp','keydown','ArrowUp',field).defaultPrevented).toBe(false);expect(input.axes.forward).toBe(0);}
  const host=document.createElement('div');document.body.append(host);const field=document.createElement('input');host.attachShadow({mode:'open'}).append(field);
  key('ArrowUp','keydown','ArrowUp',field,{composed:true});expect(input.axes.forward).toBe(0);
  key('ArrowUp');window.dispatchEvent(new Event('blur'));expect(input.axes.forward).toBe(0);
  key('ArrowUp');vi.spyOn(document,'hidden','get').mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));expect(input.axes.forward).toBe(0);
});
it('keeps browser shortcuts available and releases the original physical letter when its printed key changes',()=>{
  const input=fixture();key('ControlLeft');const print=key('KeyP','keydown','p',window,{ctrlKey:true});expect(print.defaultPrevented).toBe(false);expect(input.axes.vertical).toBe(0);
  key('KeyZ','keydown','z');key('KeyZ','keyup','Z');expect(input.axes.forward).toBe(0);
  const saved={...defaultControlBindings(),crouch:'Digit0',interact:'KeyU'};
  expect(sanitizeControlBindings(saved)).toMatchObject({crouch:'ControlLeft',interact:'KeyU'});
});

it('resumes held movement after a scripted shot, including keys pressed or released during it, without replaying actions',()=>{
  const input=fixture();key('KeyZ','keydown','z');key('ShiftLeft');key('KeyE','keydown','e');
  input.setEnabled(false,true);expect(input.axes.forward).toBe(0);expect(input.axes.sprint).toBe(false);
  key('KeyZ','keyup','z');key('ArrowUp');key('Space');key('KeyE','keyup','e');key('KeyE','keydown','e');
  input.setEnabled(false); // A host may reaffirm the lock every frame.
  input.setEnabled(true);
  expect(input.axes.forward).toBe(1);expect(input.axes.sprint).toBe(true);
  expect(input.consumeActionPress('jump')).toBe(false);expect(input.consumeActionPress('interact')).toBe(false);
  key('ArrowUp','keyup');expect(input.axes.forward).toBe(0);
  input.setEnabled(false,true);window.dispatchEvent(new Event('blur'));input.setEnabled(true);
  expect(input.axes.sprint).toBe(false);
  key('ArrowUp');input.setEnabled(false);input.setEnabled(true);expect(input.axes.forward).toBe(0);
});
