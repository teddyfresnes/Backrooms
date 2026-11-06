import * as THREE from 'three';
import { matchesControlAction, formatKeyLabel, type ControlBindings } from '../input/ControlBindings';
import './door-peephole.css';

/** Optical camera only: the player, collider and ordinary look camera stay on
 * their original side. The host renders its existing scene once, as usual. */
export class DoorPeephole {
  private readonly anchor=new THREE.Group();
  private readonly overlay=document.createElement('div');
  private readonly saved=new THREE.PerspectiveCamera();
  private readonly point=new THREE.Vector3();
  private readonly normal=new THREE.Vector3();
  private readonly faceNormal=new THREE.Vector3();
  private readonly rotation=new THREE.Quaternion();
  private readonly optical=new THREE.PerspectiveCamera();
  private readonly ray=new THREE.Ray();
  private readonly sphere=new THREE.Sphere(undefined,.06);
  private readonly hit=new THREE.Vector3();
  private active=false;
  private prompted=false;
  private elapsed=0;
  private yaw=0;
  private pitch=0;
  private side=1;

  constructor(private readonly leaf:THREE.Object3D,private readonly pivot:THREE.Object3D,box:THREE.Box3,
    private readonly camera:THREE.PerspectiveCamera,container:HTMLElement,
    private readonly ui:{setInteraction(label:string|null):void},private readonly bindings:()=>ControlBindings,
    private readonly onActiveChange:(active:boolean)=>void){
    const center=box.getCenter(new THREE.Vector3());center.y=box.min.y+1.55;
    this.anchor.name='player-door-peephole';this.anchor.userData.noBatch=true;
    const parent=leaf.parent!;parent.add(this.anchor);parent.updateWorldMatrix(true,true);
    this.anchor.position.copy(parent.worldToLocal(center));
    this.anchor.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.anchor.updateMatrixWorld(true);leaf.attach(this.anchor);
    const metal=new THREE.MeshStandardMaterial({color:0x8a8170,metalness:.65,roughness:.65});
    const glass=new THREE.MeshStandardMaterial({color:0x2e3534,metalness:.15,roughness:.25});
    const half=box.getSize(new THREE.Vector3()).x*.5;
    for(const side of [-1,1]){
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.016,.004,5,16),metal);rim.rotation.y=Math.PI/2;rim.position.x=side*(half+.005);
      const lens=new THREE.Mesh(new THREE.CircleGeometry(.012,16),glass);lens.rotation.y=side*Math.PI/2;lens.position.x=side*(half+.004);
      this.anchor.add(rim,lens);
    }
    this.overlay.className='door-peephole';this.overlay.hidden=true;
    this.overlay.addEventListener('animationend',this.onAnimationEnd);
    this.overlay.setAttribute('aria-label','Vue à travers le judas');
    const exit=document.createElement('span');exit.className='door-peephole-exit';this.overlay.append(exit);container.append(this.overlay);
    window.addEventListener('keydown',this.onKey,true);
    document.addEventListener('mousemove',this.onMouse,true);
  }
  get isActive():boolean{return this.active;}
  private targeted():boolean{
    if(Math.abs(this.pivot.rotation.y)>.04)return false;
    this.anchor.getWorldPosition(this.point);this.sphere.center.copy(this.point);
    this.camera.getWorldDirection(this.normal);this.anchor.getWorldQuaternion(this.rotation);this.faceNormal.set(1,0,0).applyQuaternion(this.rotation);
    if(Math.abs(this.normal.dot(this.faceNormal))<.6)return false;
    this.ray.set(this.camera.position,this.normal);
    const hit=this.ray.intersectSphere(this.sphere,this.hit);
    return !!hit&&hit.distanceTo(this.camera.position)<1.7;
  }
  updatePrompt(playing:boolean):void{
    if(!this.active&&playing&&this.targeted()){this.ui.setInteraction('Regarder par le judas');this.prompted=true;}
    else if(this.prompted){this.ui.setInteraction(null);this.prompted=false;}
  }
  interact():boolean{
    if(this.active){this.close(false);return true;}
    if(!this.targeted())return false;
    this.saved.copy(this.camera);this.optical.copy(this.camera);
    this.anchor.getWorldPosition(this.point);this.anchor.getWorldQuaternion(this.rotation);
    this.normal.set(1,0,0).applyQuaternion(this.rotation);
    this.side=this.camera.position.clone().sub(this.point).dot(this.normal)>=0?1:-1;
    this.optical.position.copy(this.point).addScaledVector(this.normal,-this.side*.11);
    this.optical.near=.012;this.optical.lookAt(this.point.clone().addScaledVector(this.normal,-this.side*2));
    this.active=true;this.elapsed=0;this.yaw=0;this.pitch=0;
    this.overlay.querySelector('span')!.textContent=`${formatKeyLabel(this.bindings().interact)} / Échap · Quitter le judas`;
    this.overlay.hidden=false;this.overlay.classList.remove('is-closing');this.overlay.classList.add('is-active');this.ui.setInteraction(null);this.prompted=false;
    this.onActiveChange(true);this.updateView(0);return true;
  }
  updateView(delta:number):void{
    if(!this.active)return;
    this.elapsed=Math.min(1,this.elapsed+Math.max(0,delta)/.2);
    const aspect=this.camera.aspect;
    this.camera.copy(this.optical);this.camera.aspect=aspect;
    this.camera.rotateY(this.yaw);this.camera.rotateX(this.pitch);
    const ease=this.elapsed*this.elapsed*(3-2*this.elapsed);
    this.camera.fov=THREE.MathUtils.lerp(this.saved.fov,82,ease);this.camera.updateProjectionMatrix();
    this.overlay.style.setProperty('--peephole-entry',String(ease));
  }
  close(immediate=true):void{
    if(!this.active)return;
    const aspect=this.camera.aspect;this.camera.copy(this.saved);this.camera.aspect=aspect;this.camera.updateProjectionMatrix();
    this.active=false;this.overlay.hidden=immediate;this.overlay.classList.remove('is-active');
    if(!immediate)this.overlay.classList.add('is-closing');this.onActiveChange(false);
  }
  private onAnimationEnd=(event:AnimationEvent):void=>{if(event.animationName==='peephole-out'&&!this.active)this.overlay.hidden=true;};
  private onKey=(event:KeyboardEvent):void=>{
    if(!this.active||event.ctrlKey||event.metaKey||event.altKey||event.code==='F11')return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!event.repeat&&(event.code==='Escape'||matchesControlAction(event,this.bindings(),'interact')))this.close(false);
  };
  private onMouse=(event:MouseEvent):void=>{
    if(!this.active||!document.pointerLockElement||document.hidden)return;event.stopImmediatePropagation();
    this.yaw=THREE.MathUtils.clamp(this.yaw-event.movementX*.001,-.13,.13);
    this.pitch=THREE.MathUtils.clamp(this.pitch-event.movementY*.001,-.1,.1);
  };
  dispose():void{
    this.close();window.removeEventListener('keydown',this.onKey,true);document.removeEventListener('mousemove',this.onMouse,true);
    this.overlay.removeEventListener('animationend',this.onAnimationEnd);
    this.overlay.remove();this.anchor.removeFromParent();
    const materials=new Set<THREE.Material>();this.anchor.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});materials.forEach(m=>m.dispose());
  }
}
