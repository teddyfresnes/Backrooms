import { loadAudioAsset } from './AudioAssetQueue';
import { mapWithConcurrency } from '../core/CooperativeWork';
import { doorAudioChain, type SpatialAudioBus } from './SpatialDoorAudio';
import type { Vec3Data } from '../world/types';

export type NeighborDoorSound='knock'|'bell'|'slam';
const URLS:Record<NeighborDoorSound,string>={knock:'/assets/audio/interactions/knock-wood.ogg',bell:'/assets/audio/interactions/apartment-bell.ogg',slam:'/assets/audio/interactions/door-close.mp3'};
const SCRIPTED_KNOCK_ID = 'scripted-door-knocks';
const SCRIPTED_KNOCK_RATE = .82;
// The recording already contains three separate impacts. Keep its original spacing.
export const SCRIPTED_KNOCK_ONSETS = [.067, .273, .508].map(time => time / SCRIPTED_KNOCK_RATE);
export const SCRIPTED_KNOCK_SECONDS = .768 / SCRIPTED_KNOCK_RATE;
export class SampledDoorAudio {
  private bus?:SpatialAudioBus;
  private readonly buffers=new Map<NeighborDoorSound,AudioBuffer>();
  private readonly sources=new Map<string,{source:AudioBufferSourceNode;chain:ReturnType<typeof doorAudioChain>;at:number}>();
  private readonly abort=new AbortController();
  private cursor=0;
  private disposed=false;
  async prepare(bus:SpatialAudioBus):Promise<void>{
    this.bus=bus;
    await mapWithConcurrency(Object.entries(URLS) as [NeighborDoorSound,string][],2,async([kind,url])=>{
      const buffer=await loadAudioAsset(bus.context,url,this.abort.signal).catch((error:unknown)=>{if(this.disposed)throw error;console.warn('[audio] door sound unavailable',url,error);return undefined;});
      if(buffer&&!this.disposed)this.buffers.set(kind,buffer);
    });
  }
  play(kind:NeighborDoorSound,position:Readonly<Vec3Data>,doorId:string):number{
    const bus=this.bus,buffer=this.buffers.get(kind);
    if(!bus||!buffer||this.disposed||document.hidden||bus.context.state!=='running')return 0;
    const prior=this.sources.get(doorId),now=bus.context.currentTime;
    if(prior&&kind!=='slam'&&now-prior.at<(kind==='bell'?.4:.18))return buffer.duration;
    if(prior)this.release(doorId);
    // Spatial tails may span several doors, but the active node budget is fixed.
    if(this.sources.size>=6)this.release([...this.sources.keys()].find(id => id !== SCRIPTED_KNOCK_ID)!);
    const chain=doorAudioChain(bus,position,kind==='slam'?.24:kind==='bell'?.2:.42,kind==='bell');
    const source=bus.context.createBufferSource();source.buffer=buffer;
    const rate=kind==='knock'?[.99,1.01,1][this.cursor++%3]!:1;
    source.playbackRate.value=rate;source.connect(chain.input);this.sources.set(doorId,{source,chain,at:now});
    source.onended=()=>{if(this.sources.get(doorId)?.source===source)this.sources.delete(doorId);source.disconnect();chain.dispose();};
    source.start();return buffer.duration/rate;
  }
  /** The three heavy scripted knocks share one voice, even across triggers. */
  playKnocks(position: Readonly<Vec3Data>): void {
    const bus=this.bus,buffer=this.buffers.get('knock'),id=SCRIPTED_KNOCK_ID;
    if(!bus||!buffer||this.disposed||bus.context.state!=='running'||this.sources.has(id))return;
    if(this.sources.size>=6)this.release(this.sources.keys().next().value!);
    const spatial = doorAudioChain(bus,position,2.6,false,{refDistance:2.5,maxDistance:30,rolloff:.8});
    const bass = bus.context.createBiquadFilter();
    bass.type = 'lowshelf'; bass.frequency.value = 320; bass.gain.value = 6;
    bass.connect(spatial.input);
    const chain = { ...spatial, input: bass, dispose: () => { bass.disconnect(); spatial.dispose(); } };
    const source=bus.context.createBufferSource();source.buffer=buffer;source.playbackRate.value=SCRIPTED_KNOCK_RATE;
    source.connect(chain.input);this.sources.set(id,{source,chain,at:bus.context.currentTime});
    source.onended=()=>{if(this.sources.get(id)?.source===source)this.sources.delete(id);source.disconnect();chain.dispose();};
    source.start();
  }
  stopKnocks(): void { this.release(SCRIPTED_KNOCK_ID); }
  stopNeighborSounds(): void {
    for (const id of this.sources.keys()) if (id !== SCRIPTED_KNOCK_ID) this.release(id);
  }
  private release(id:string):void{
    const active=this.sources.get(id);if(!active)return;this.sources.delete(id);active.source.onended=null;
    try{active.source.stop();}catch{}active.source.disconnect();active.chain.dispose();
  }
  stop():void{for(const id of this.sources.keys())this.release(id);}
  dispose():void{this.disposed=true;this.abort.abort();this.stop();this.buffers.clear();this.bus=undefined;}
}
