import { afterEach, expect, it, vi } from 'vitest';
import { BacteriaAudio } from './BacteriaAudio';

class Param {
  value=0;
  setValueAtTime=vi.fn((v:number)=>{this.value=v;});
  setTargetAtTime=vi.fn((v:number)=>{this.value=v;});
  linearRampToValueAtTime=vi.fn();exponentialRampToValueAtTime=vi.fn();cancelScheduledValues=vi.fn();
}
class Node {
  gain=new Param();frequency=new Param();Q=new Param();pan=new Param();playbackRate=new Param();
  buffer:unknown;loop=false;type='';
  connect=vi.fn((next:unknown)=>next);disconnect=vi.fn();start=vi.fn();stop=vi.fn();
  private ended:(()=>void)[]=[];
  addEventListener(_name:string,callback:()=>void){this.ended.push(callback);}
  end(){this.ended.forEach(callback=>callback());}
}
afterEach(()=>vi.unstubAllGlobals());
it('uses a separate immediate supplied screamer for reveals and capture, immune to distance updates and released on stop',async()=>{
  const sources:Node[]=[],nodes:Node[]=[];
  const make=()=>{const node=new Node();nodes.push(node);return node;};
  const context={currentTime:10,createBufferSource:()=>{const n=make();sources.push(n);return n;},
    createGain:make,createBiquadFilter:make,createStereoPanner:make,
    decodeAudioData:vi.fn(async()=>({duration:4.69})),};
  const fetch=vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}));vi.stubGlobal('fetch',fetch);
  const audio=new BacteriaAudio(()=>({context,destination:make()}) as never);await audio.load();
  expect(fetch).toHaveBeenCalledWith('/assets/audio/bacteria/screamer.ogg');
  audio.roar();
  const reveal=sources.at(-1)!;expect(reveal.loop).toBe(false);expect(reveal.start).toHaveBeenCalledWith(10,0);
  expect(reveal.stop).toHaveBeenCalledWith(11.25);
  context.currentTime=12;audio.jumpscare();
  const capture=sources.at(-1)!;expect(capture).not.toBe(reveal);expect(capture.loop).toBe(false);
  const owned=nodes.slice(-4),gain=owned.find(n=>n.gain.value===1.15)!;
  expect(gain).toBeDefined();audio.updateSpatial(100,1,1);expect(gain.gain.value).toBe(1.15);
  audio.stopAll();expect(capture.stop).toHaveBeenCalled();
  capture.end();expect(owned.every(n=>n.disconnect.mock.calls.length===1)).toBe(true);
  audio.dispose();
});
