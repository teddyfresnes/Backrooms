/** One French dialogue lane. Captions remain usable when system speech is absent.
 * Consumed cue IDs belong to the saved story, not to this transient audio queue. */
export class StorySpeech {
  private readonly synth=typeof window!=='undefined'?window.speechSynthesis:undefined;
  private queue:{text:string;seconds:number;delay:number}[]=[];
  private current?:{text:string;seconds:number};
  private utterance?:SpeechSynthesisUtterance;
  private elapsed=0;
  private started=false;
  private paused=false;
  private disposed=false;
  private volume=1;
  private voices:SpeechSynthesisVoice[]=[];
  private availability:'ready'|'unavailable'|'speaking'='unavailable';
  constructor(private readonly gender=-1){this.refreshVoices();this.synth?.addEventListener('voiceschanged',this.refreshVoices);}
  private readonly refreshVoices=()=>{this.voices=this.synth?.getVoices().filter(v=>v.lang.toLowerCase().startsWith('fr'))??[];if(this.voices.length)this.availability='ready';};
  get busy():boolean{return !!this.current||this.queue.length>0;}
  get status():string{return this.availability;}
  setVolume(value:number):void{this.volume=Math.max(0,Math.min(1,value));if(this.utterance)this.utterance.volume=this.volume;}
  say(text:string,delay=0):void{if(!this.disposed)this.queue.push({text,seconds:Math.max(2.5,text.split(/\s+/).length*.39+.65),delay});}
  update(delta:number,playing:boolean):void {
    if(this.disposed)return;
    if(!playing){if(!this.paused)this.synth?.pause();this.paused=true;return;}
    if(this.paused){this.synth?.resume();this.paused=false;}
    if(!this.current&&this.queue.length){
      if(this.queue[0]!.delay>0){this.queue[0]!.delay=Math.max(0,this.queue[0]!.delay-delta);return;}
      this.current=this.queue.shift()!;this.elapsed=0;this.started=false;
      if(this.synth&&this.voices.length&&typeof SpeechSynthesisUtterance!=='undefined'&&this.volume>0){
        const u=new SpeechSynthesisUtterance(this.current.text);this.utterance=u;u.lang='fr-FR';u.volume=this.volume;u.rate=.96;u.pitch=this.gender>0?1.03:.96;
        u.voice=this.voices.find(v=>/natural|enhanced|online/i.test(v.name))??this.voices[0]!;
        u.onstart=()=>{if(this.utterance===u){this.started=true;this.availability='speaking';}};
        u.onend=()=>{if(this.utterance===u){this.current=undefined;this.utterance=undefined;this.availability='ready';}};
        u.onerror=()=>{if(this.utterance===u){this.utterance=undefined;this.availability='unavailable';}};
        this.synth.speak(u);
      }
    }
    if(!this.current)return;
    this.elapsed+=Math.max(0,delta);
    if(this.utterance&&(!this.started&&this.elapsed>2||this.started&&this.elapsed>Math.max(15,this.current.seconds*4))){this.utterance=undefined;this.synth?.cancel();this.availability='unavailable';}
    if(!this.utterance&&this.elapsed>=this.current.seconds)this.current=undefined;
  }
  dispose():void{this.disposed=true;this.queue=[];this.current=undefined;this.utterance=undefined;this.synth?.cancel();this.synth?.removeEventListener('voiceschanged',this.refreshVoices);}
}
