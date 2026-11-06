// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { NeighborVoice } from './NeighborVoice';
import { loadAudioAsset } from './AudioAssetQueue';
vi.mock('./AudioAssetQueue',()=>({loadAudioAsset:vi.fn(async()=>({duration:1}))}));

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('plays recorded neighbour clips through the existing spatial bus, obeys mute and disposes sources',async()=>{
  vi.stubGlobal('scheduler',{yield:async()=>{}});
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  const sources:any[]=[],panners:any[]=[];
  const param=()=>({value:0});
  const node=()=>({connect:vi.fn(function(this:any){return this;}),disconnect:vi.fn()});
  const context={state:'running',createGain:()=>({...node(),gain:param()}),createBiquadFilter:()=>({...node(),frequency:param(),Q:param()}),
    createPanner:()=>{const p={...node(),positionX:param(),positionY:param(),positionZ:param()};panners.push(p);return p;},
    createBufferSource:()=>{const source:any={...node(),start:vi.fn(),stop:vi.fn(()=>source.onended?.())};sources.push(source);return source;}};
  const voice=new NeighborVoice();
  await voice.prepare({context:context as unknown as AudioContext,destination:node() as unknown as AudioNode},['karen']);
  expect(loadAudioAsset).toHaveBeenCalledWith(context,'/assets/audio/neighbors/karen/miscellaneous-15.ogg',expect.any(AbortSignal));
  expect(voice.play('west-door','karen','refusal-1',{x:-2,y:1.5,z:0})).toBe(true);
  expect(panners[0].positionX.value).toBe(-2);expect(sources[0].start).toHaveBeenCalledOnce();
  expect(voice.play('west-door','karen','refusal-2',{x:-2,y:1.5,z:0})).toBe(false);
  expect(voice.play('east-door','karen','refusal-3',{x:2,y:1.5,z:0})).toBe(true);
  expect(voice.play('north-door','karen','refusal-4',{x:0,y:1.5,z:4})).toBe(false);
  expect(sources).toHaveLength(2);
  voice.setVolume(0);expect(sources[0].stop).toHaveBeenCalledOnce();
  expect(voice.play('west-door','karen','refusal-1',{x:0,y:0,z:0})).toBe(false);
  voice.dispose();expect(sources[0].disconnect).toHaveBeenCalled();
});
