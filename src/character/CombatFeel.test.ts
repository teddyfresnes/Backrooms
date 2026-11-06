// @vitest-environment happy-dom
import{afterEach,expect,it,vi}from 'vitest';
import{CombatImpactAudio}from './CombatFeel';
afterEach(()=>vi.unstubAllGlobals());
it('spatializes stronger varied wall transients, applies master volume once, caps voices and suspends/resumes the context',()=>{
  const node=()=>({connect:vi.fn((next:unknown)=>next),disconnect:vi.fn()});
  const param=()=>({value:0,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()});
  const panners:{setPosition:ReturnType<typeof vi.fn>}[]=[],sources:any[]=[],gains:any[]=[];
  const listener={setPosition:vi.fn(),setOrientation:vi.fn()};
  const context={state:'running',currentTime:0,sampleRate:8000,destination:node(),listener,
    suspend:vi.fn(async()=>{}),resume:vi.fn(async()=>{}),close:vi.fn(async()=>{}),
    createGain:()=>{const n={...node(),gain:param()};gains.push(n);return n;},
    createPanner:()=>{const n={...node(),setPosition:vi.fn()};panners.push(n);return n;},
    createBiquadFilter:()=>({...node(),frequency:param(),Q:param()}),
    createBuffer:(_channels:number,size:number)=>({getChannelData:()=>new Float32Array(size)}),
    createBufferSource:()=>{const n={...node(),playbackRate:param(),start:vi.fn(),stop:vi.fn(),onended:undefined as undefined|(()=>void)};sources.push(n);return n;},
    createOscillator:()=>({...node(),frequency:param(),start:vi.fn(),stop:vi.fn()}),
  };
  vi.stubGlobal('AudioContext',class{constructor(){return context;}});let random=0;const audio=new CombatImpactAudio(()=>{random=(random+.137)%1;return random;});
  audio.setVolume(.4);audio.unlock();const point={x:1,y:1.5,z:-2},eye={x:0,y:1.6,z:0},forward={x:0,y:0,z:-1};
  try{
    audio.wall(false,point,eye,forward);expect(panners[0]!.setPosition).toHaveBeenLastCalledWith(1,1.5,-2);expect(listener.setPosition).toHaveBeenLastCalledWith(0,1.6,0);
    expect(gains[0]!.gain.value).toBe(.4);expect(gains[1]!.gain.linearRampToValueAtTime.mock.calls[0][0]).toBeGreaterThan(.4);
    const firstRate=sources[0].playbackRate.value;context.currentTime+=.12;audio.wall(false,point,eye,forward);expect(sources[1].playbackRate.value).not.toBe(firstRate);
    for(let i=0;i<20;i++){context.currentTime+=.12;audio.wall(true,point,eye,forward);}expect(sources).toHaveLength(6);
    audio.setSuspended(true);expect(context.suspend).toHaveBeenCalledOnce();context.currentTime+=1;audio.wall(false,point,eye,forward);expect(sources).toHaveLength(6);
    sources[0].onended();audio.setSuspended(false);audio.setVolume(0);context.currentTime+=1;audio.wall(false,point,eye,forward);expect(sources).toHaveLength(6);
  }finally{audio.dispose();expect(context.close).toHaveBeenCalledOnce();}
});
