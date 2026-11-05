import { doorAudioChain, type SpatialAudioBus } from './SpatialDoorAudio';
import type { Vec3Data } from '../world/types';

/** A tiny dry switch transient. No timers and no scheduled notes to survive skip. */
export class KeypadAudio {
  private buffer?:AudioBuffer;
  private active?:{source:AudioBufferSourceNode;chain:ReturnType<typeof doorAudioChain>};
  constructor(private readonly bus:SpatialAudioBus){
    const sampleRate=bus.context.sampleRate,buffer=bus.context.createBuffer(1,Math.ceil(sampleRate*.028),sampleRate),samples=buffer.getChannelData(0);
    let noise=0x19741;
    for(let i=0;i<samples.length;i++){
      noise=(Math.imul(noise,1664525)+1013904223)|0;
      const t=i/sampleRate,decay=Math.exp(-t*230);
      samples[i]=(((noise>>>0)/4294967296-.5)*.65+Math.sin(t*2*Math.PI*1850)*.35)*decay*Math.min(1,t/.001);
    }
    this.buffer=buffer;
  }
  click(position:Readonly<Vec3Data>):void {
    const {context}=this.bus;
    if(!this.buffer||document.hidden||context.state!=='running')return;
    this.stop();
    const chain=doorAudioChain(this.bus,position,.15),source=context.createBufferSource();source.buffer=this.buffer;source.connect(chain.input);
    this.active={source,chain};
    source.onended=()=>{if(this.active?.source===source)this.active=undefined;source.disconnect();chain.dispose();};source.start();
  }
  stop():void {
    const active=this.active;this.active=undefined;
    if(active){active.source.onended=null;try{active.source.stop();}catch{}active.source.disconnect();active.chain.dispose();}
  }
  dispose():void {this.stop();this.buffer=undefined;}
}
