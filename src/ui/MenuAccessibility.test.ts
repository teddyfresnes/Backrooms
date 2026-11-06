// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ExperienceUI } from './ExperienceUI';
import { defaultGameSettings } from './settings';
vi.mock('../audio/SiteAudio',()=>({siteAudio:new Proxy({},{get:()=>()=>undefined})}));
let ui:ExperienceUI;
afterEach(()=>{ui?.dispose();document.body.replaceChildren();vi.restoreAllMocks();});
function fixture(){
 const actions={enter:vi.fn(),regenerate:vi.fn(),returnToMainMenu:vi.fn(),toggleFullscreen:vi.fn(),settingsChanged:vi.fn(),submitConsole:()=>({close:false,feedback:'',messages:[]}),completeConsole:()=>null,consoleVisibility:vi.fn()};
 ui=new ExperienceUI(document.body,actions,defaultGameSettings());ui.setReady();
 return actions;
}
const button=(selector:string)=>document.querySelector<HTMLButtonElement>(selector)!;
const save=()=>ui.setSaveHistory([{id:'test-save',experienceId:'russian-stairwell',kind:'manual',levelId:'building',levelLabel:'Immeuble',savedAt:'2026-11-01T00:00:00.000Z',playTimeSeconds:20}]);
it('keeps Continue disabled without a save, restores its home style and starts directly without redundant confirmation',()=>{
 const actions=fixture();const continued=button('[data-ui-main-continue]');
 expect(continued.disabled).toBe(true);expect(continued.classList.contains('primary')).toBe(true);
 button('[data-ui="regenerate"]').click();expect(actions.regenerate).toHaveBeenCalledOnce();
 expect(document.querySelector<HTMLElement>('[data-ui="confirmation"]')!.hidden).toBe(true);
 save();expect(continued.disabled).toBe(false);
});
it('offers only a mouse icon to recover capture during gameplay and removes it on capture or pause',()=>{
 const actions=fixture();const capture=button('[data-ui="capture-pointer"]');
 expect(capture.hidden).toBe(true);expect(capture.textContent?.trim()).toBe('');
 expect(capture.getAttribute('aria-label')).toBe('Reprendre le contrôle');
 ui.beginGameplay(true);ui.setPointerCaptureRequired(true);expect(capture.hidden).toBe(false);
 capture.click();expect(actions.enter).toHaveBeenCalledOnce();
 ui.setPointerCaptureRequired(false);expect(capture.hidden).toBe(true);
 ui.setPointerCaptureRequired(true);ui.setLocked(false);expect(capture.hidden).toBe(true);
});
it('traps confirmation focus, restores its origin on cancel and consumes the Escape key',()=>{
 fixture();save();const origin=button('[data-ui="regenerate"]');origin.focus();origin.click();
 const cancel=button('[data-ui="confirmation-cancel"]'),accept=button('[data-ui="confirmation-accept"]');
 cancel.focus();cancel.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',shiftKey:true,bubbles:true,cancelable:true}));expect(document.activeElement).toBe(accept);
 accept.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true,cancelable:true}));expect(document.activeElement).toBe(cancel);
 const world=vi.fn();window.addEventListener('keydown',world);
 try{cancel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));expect(world).not.toHaveBeenCalled();expect(document.activeElement).toBe(origin);}finally{window.removeEventListener('keydown',world);}
});
it('commits a confirmation once even if the accept button is clicked repeatedly',()=>{
 const actions=fixture();save();button('[data-ui="regenerate"]').click();const accept=button('[data-ui="confirmation-accept"]');
 accept.click();accept.click();accept.click();expect(actions.regenerate).toHaveBeenCalledOnce();
});
it('uses compact confirmations and describes only the useful save behavior',()=>{
 fixture();save();button('[data-ui="regenerate"]').click();
 const dialog=document.querySelector<HTMLElement>('[data-ui="confirmation"]')!;
 const title=document.querySelector<HTMLElement>('[data-ui="confirmation-title"]')!;
 const message=document.querySelector<HTMLElement>('[data-ui="confirmation-message"]')!;
 expect(title.textContent).toBe('Nouvelle partie ?');expect(message.hidden).toBe(true);
 expect(dialog.hasAttribute('aria-describedby')).toBe(false);
 expect(button('[data-ui="confirmation-accept"]').textContent).toBe('Commencer');
 button('[data-ui="confirmation-cancel"]').click();ui.beginGameplay(true);ui.setLocked(false);
 button('[data-ui="main-menu"]').click();
 expect(title.textContent).toBe('Quitter la partie ?');expect(message.textContent).toBe('La partie sera sauvegardée.');
 expect(message.hidden).toBe(false);expect(dialog.getAttribute('aria-describedby')).toBe(message.id);
 expect(button('[data-ui="confirmation-accept"]').textContent).toBe('Quitter');
});
it('persists subtitle and sound-caption choices through the existing settings callback',async()=>{
 const actions=fixture();for(const setting of ['subtitles','soundCaptions']){
  const input=document.querySelector<HTMLInputElement>(`[data-setting="${setting}"]`)!;input.checked=true;input.dispatchEvent(new Event('change'));await Promise.resolve();
  expect(actions.settingsChanged.mock.lastCall?.[0][setting]).toBe(true);
 }
});
