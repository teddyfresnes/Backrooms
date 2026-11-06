// @vitest-environment happy-dom
import {expect,it,vi} from 'vitest';
import {EquipmentInput}from './EquipmentInput';
import {defaultControlBindings}from './ControlBindings';
it('toggles only on an isolated short F release, leaving combat combinations and fields alone',()=>{
  let now=0,active=true;const clock=vi.spyOn(performance,'now').mockImplementation(()=>now),toggle=vi.fn(),store=vi.fn();const input=new EquipmentInput(defaultControlBindings,()=>active,toggle,store);
  const key=(type:string,code='KeyF',extra={})=>window.dispatchEvent(new KeyboardEvent(type,{code,key:code.slice(3).toLowerCase(),bubbles:true,cancelable:true,...extra}));
  try{key('keydown');expect(toggle).not.toHaveBeenCalled();now+=100;key('keyup');expect(toggle).toHaveBeenCalledTimes(1);
    key('keydown');window.dispatchEvent(new MouseEvent('mousedown'));window.dispatchEvent(new MouseEvent('mouseup'));key('keyup');expect(toggle).toHaveBeenCalledTimes(1);
    key('keydown');key('keydown','KeyZ');key('keyup');expect(toggle).toHaveBeenCalledTimes(1);
    key('keydown');now+=400;key('keyup');expect(toggle).toHaveBeenCalledTimes(1);
    active=false;key('keydown');key('keyup');key('keydown','KeyG');expect(store).not.toHaveBeenCalled();active=true;
    const field=document.createElement('input');document.body.append(field);field.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',key:'f',bubbles:true}));field.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF',key:'f',bubbles:true}));expect(toggle).toHaveBeenCalledTimes(1);field.remove();
    key('keydown','KeyG');expect(store).toHaveBeenCalledOnce();
  }finally{input.dispose();clock.mockRestore();}
});
it('preserves remapped controls and uses free fallback keys',()=>{const bindings={...defaultControlBindings(),interact:'KeyF',jump:'KeyG'};const input=new EquipmentInput(()=>bindings,()=>true,()=>{},()=>{});expect(input.torchKey).toBe('KeyL');expect(input.storeKey).toBe('KeyI');input.dispose();});
it('keeps both equipment actions available and distinct when their first fallback keys are also remapped',()=>{
  const bindings={...defaultControlBindings(),interact:'KeyF',jump:'KeyG',forward:'KeyL',backward:'KeyI'};
  const input=new EquipmentInput(()=>bindings,()=>true,()=>{},()=>{});expect(input.torchKey).toBeTruthy();expect(input.storeKey).toBeTruthy();expect(input.torchKey).not.toBe(input.storeKey);expect(Object.values(bindings)).not.toContain(input.torchKey);expect(Object.values(bindings)).not.toContain(input.storeKey);input.dispose();
});
