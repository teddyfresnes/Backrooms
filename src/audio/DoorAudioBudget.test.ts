// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { SampledDoorAudio } from './SampledDoorAudio';
import { KeypadAudio } from './KeypadAudio';
import type { SpatialAudioBus } from './SpatialDoorAudio';
vi.mock('./AudioAssetQueue',()=>({loadAudioAsset:vi.fn(async(_context,url:string)=>({duration:url.includes('bell')?4:.8}))}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function busFixture(){
 vi.stubGlobal('scheduler',{yield:async()=>{}});vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const active=new Set<unknown>(),nodes:any[]=[],sources:any[]=[],param=()=>({value:0});let maximum=0;
 const node=()=>{const n={connect:vi.fn(function(this:unknown){return this;}),disconnect:vi.fn()};nodes.push(n);return n;};
 const context={state:'running',currentTime:0,sampleRate:8000,createBuffer:(_channels:number,size:number)=>({getChannelData:()=>new Float32Array(size)}),
  createGain:()=>({...node(),gain:param()}),createBiquadFilter:()=>({...node(),frequency:param(),Q:param()}),
  createPanner:()=>({...node(),positionX:param(),positionY:param(),positionZ:param()}),
  createBufferSource:()=>{const s:any={...node(),playbackRate:param(),onended:null,start:vi.fn(()=>{active.add(s);maximum=Math.max(maximum,active.size);}),stop:vi.fn(()=>{active.delete(s);s.onended?.();})};sources.push(s);return s;}};
 return {context,active,nodes,sources,get maximum(){return maximum;},bus:{context,destination:node()} as unknown as SpatialAudioBus};
}
it('regulates repeated knocks/bells, retriggers audible requests and caps all active spatial door sources',async()=>{
 const f=busFixture(),sound=new SampledDoorAudio();await sound.prepare(f.bus);
 const p={x:1,y:1.5,z:0};
 for(let n=0;n<1000;n++)sound.play('knock',p,'same');expect(f.sources).toHaveLength(1);
 for(let n=0;n<20;n++){f.context.currentTime+=.21;sound.play('knock',p,'same');expect(f.active.size).toBe(1);}
 for(let n=0;n<30;n++){sound.play('bell',p,`door-${n}`);expect(f.active.size).toBeLessThanOrEqual(6);}
 expect(f.maximum).toBeLessThanOrEqual(6);sound.stop();expect(f.active.size).toBe(0);
 const count=f.sources.length;f.context.state='suspended';sound.play('bell',p,'same');expect(f.sources).toHaveLength(count);
 sound.dispose();expect(f.sources.every(s=>s.disconnect.mock.calls.length>0)).toBe(true);
});
it('uses the master spatial bus for tiny keypad transients and leaves no scheduled or active sound after stop',()=>{
 const f=busFixture(),sound=new KeypadAudio(f.bus),p={x:.3,y:1.4,z:-6};
 for(let n=0;n<6;n++){sound.click(p);expect(f.active.size).toBe(1);}
 expect(f.maximum).toBe(1);expect(f.sources).toHaveLength(6);
 sound.stop();expect(f.active.size).toBe(0);const count=f.sources.length;
 f.context.state='suspended';sound.click(p);expect(f.sources).toHaveLength(count);
 sound.dispose();f.context.state='running';sound.click(p);expect(f.sources).toHaveLength(count);
 expect(f.sources.every(s=>s.disconnect.mock.calls.length>0)).toBe(true);
});
