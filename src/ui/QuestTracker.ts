import './quest-tracker.css';
export class QuestTracker {
  readonly element = document.createElement('aside');
  private readonly copy = document.createElement('span');
  private text: string | null = null;
  private desired:string|null=null;
  private phase:'idle'|'out'|'in'='idle';
  private elapsed=0;
  private reduced=false;
  constructor(container: HTMLElement) {
    this.element.className = 'quest-tracker'; this.element.hidden = true;
    this.element.setAttribute('role', 'status'); this.element.setAttribute('aria-live', 'polite');
    const label = document.createElement('small'); label.textContent = 'À faire';
    this.element.append(label, this.copy); container.append(this.element);
  }
  update(text: string | null, visible: boolean): void {
    this.desired=text;
    if(this.text!==text){
      if(!this.text||this.reduced||!visible){this.text=text;this.copy.textContent=text??'';this.phase='idle';this.element.style.opacity='1';this.element.style.transform='none';}
      else if(this.phase!=='out'){this.phase='out';this.elapsed=0;}
    }
    this.element.hidden = !visible || (!this.text&&!text);
  }
  tick(delta:number,playing:boolean,reduced=false):void {
    this.reduced=reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(this.reduced){this.text=this.desired;this.copy.textContent=this.text??'';this.phase='idle';this.element.style.opacity='1';this.element.style.transform='none';return;}
    if(!playing||this.phase==='idle')return;
    this.elapsed+=Math.min(.05,Math.max(0,delta));const t=Math.min(1,this.elapsed/(this.phase==='out'?.13:.24));
    this.element.style.opacity=String(this.phase==='out'?1-t:t);
    this.element.style.transform=`translateY(${this.phase==='out'?-4*t:5*(1-t)}px)`;
    if(t===1){if(this.phase==='out'){this.text=this.desired;this.copy.textContent=this.text??'';this.phase='in';this.elapsed=0;}else{this.phase='idle';this.element.style.transform='none';}}
  }
  dispose(): void { this.element.remove(); }
}
