import * as THREE from 'three';
import { solveCombatTwoBone, easeCombat, CombatProceduralPose } from './CombatRig';

export interface ComputerPoseSample {
  feet: THREE.Vector3; yaw: number; seated: number; seat: THREE.Vector3;
  lean: number; time: number; walking?: number;
  leftHand?: THREE.Vector3; rightHand?: THREE.Vector3; handWeight?: number;
}
export interface ComputerPoseFrame {
  eye: THREE.Vector3; head: THREE.Vector3; hips: THREE.Vector3;
  feet: THREE.Vector3[]; knees: THREE.Vector3[]; hands: THREE.Vector3[];
}
const find=(root:THREE.Object3D,suffix:string):THREE.Bone|undefined=>{let result:THREE.Bone|undefined;root.traverse(o=>{if((o as THREE.Bone).isBone&&o.name.toLowerCase().replace(/[^a-z0-9]/g,'').endsWith(suffix))result=o as THREE.Bone;});return result;};
const sitMotions=new WeakMap<THREE.Object3D,THREE.AnimationClip>();
function worldRotation(bone:THREE.Bone,rotation:THREE.Quaternion):void {
  const q=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rotation),parent=bone.parent?.getWorldQuaternion(new THREE.Quaternion()).invert()??new THREE.Quaternion();
  bone.quaternion.copy(parent.multiply(q)).normalize();bone.updateWorldMatrix(false,true);
}
/** Samples the actual dressed world avatar. No clone, replacement mesh or extra renderer. */
export class SeatedCharacterPose {
  private readonly mixer:THREE.AnimationMixer;
  private readonly idle:THREE.AnimationAction;
  private readonly walk:THREE.AnimationAction;
  private readonly sit:THREE.AnimationAction;
  private readonly referenceSeat=new THREE.Vector3(0,.5676605,-.576);
  private readonly originals:{bone:THREE.Bone;position:THREE.Vector3;rotation:THREE.Quaternion}[]=[];
  private readonly hips:THREE.Bone;
  private readonly head:THREE.Bone;
  private readonly spines:THREE.Bone[];
  private readonly legs:{upper:THREE.Bone;lower:THREE.Bone;foot:THREE.Bone;lateral:number;rotation:THREE.Quaternion}[]=[];
  private readonly arms:{upper:THREE.Bone;lower:THREE.Bone;hand:THREE.Bone;side:number;finger:THREE.Vector3;normal:THREE.Vector3}[]=[];
  private readonly fingerRest=new Map<THREE.Bone,THREE.Quaternion>();
  private disposed=false;
  private readonly procedural=new CombatProceduralPose();
  constructor(readonly root:THREE.Object3D,private readonly anchor:THREE.Group,idle:THREE.AnimationClip,walk:THREE.AnimationClip,private readonly soleHeight:number,sourceSit:THREE.AnimationClip){
    root.traverse(o=>{if((o as THREE.Bone).isBone)this.originals.push({bone:o as THREE.Bone,position:o.position.clone(),rotation:o.quaternion.clone()});});
    this.hips=find(root,'hips')!;this.head=find(root,'head')!;if(!this.hips||!this.head)throw Error('Le rig du personnage ne contient pas le bassin et la tête.');
    root.traverse(o=>{const mesh=o as THREE.SkinnedMesh;if(!mesh.isSkinnedMesh)return;
      mesh.skeleton.bones.forEach((bone,i)=>{if(!/hand(?:thumb|index|middle|ring|pinky)[123]$/i.test(bone.name))return;const parent=mesh.skeleton.bones.indexOf(bone.parent as THREE.Bone);if(parent<0)return;
        const local=mesh.skeleton.boneInverses[parent]!.clone().multiply(mesh.skeleton.boneInverses[i]!.clone().invert());this.fingerRest.set(bone,new THREE.Quaternion().setFromRotationMatrix(local).normalize());
      });
    });
    this.spines=['spine','spine1','spine2'].map(s=>find(root,s)).filter((b):b is THREE.Bone=>!!b);
    this.mixer=new THREE.AnimationMixer(root);this.idle=this.mixer.clipAction(idle).play();this.walk=this.mixer.clipAction(walk).play();this.walk.setEffectiveWeight(0);this.mixer.update(0);anchor.updateMatrixWorld(true);
    const inverse=anchor.getWorldQuaternion(new THREE.Quaternion()).invert();
    for(const side of ['left','right']){
      const upper=find(root,side+'upleg'),lower=find(root,side+'leg'),foot=find(root,side+'foot');
      if(upper&&lower&&foot){const p=foot.getWorldPosition(new THREE.Vector3()).sub(anchor.position).applyQuaternion(inverse);this.legs.push({upper,lower,foot,lateral:Math.sign(p.x||1)*THREE.MathUtils.clamp(Math.abs(p.x),.085,.15),rotation:foot.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverse)});}
      const arm=find(root,side+'arm'),forearm=find(root,side+'forearm'),hand=find(root,side+'hand');
      if(arm&&forearm&&hand){
        const h=hand.getWorldPosition(new THREE.Vector3()),middle=find(root,side+'handmiddle1'),index=find(root,side+'handindex1'),pinky=find(root,side+'handpinky1'),inverseHand=hand.getWorldQuaternion(new THREE.Quaternion()).invert();
        const finger=(middle?.getWorldPosition(new THREE.Vector3()).sub(h)??new THREE.Vector3(0,-1,0)).normalize().applyQuaternion(inverseHand);
        const normal=index&&pinky?new THREE.Vector3().crossVectors(index.getWorldPosition(new THREE.Vector3()).sub(h),pinky.getWorldPosition(new THREE.Vector3()).sub(h)).normalize().multiplyScalar(side==='left'?-1:1).applyQuaternion(inverseHand):new THREE.Vector3(0,0,1);
        const lateral=hand.getWorldPosition(new THREE.Vector3()).sub(anchor.position).applyQuaternion(inverse).x;
        this.arms.push({upper:arm,lower:forearm,hand,side:Math.sign(lateral),finger,normal});
      }
    }
    let clip=sitMotions.get(root);if(!clip){clip=this.adaptSitMotion(sourceSit);sitMotions.set(root,clip);}
    this.sit=this.mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);this.sit.clampWhenFinished=true;this.sit.play().setEffectiveWeight(0);
  }
  /** Bake the existing retargeted FBX weight-transfer motion into a seated clip.
   * This runs during loading, once per dressed rig. The mixer drives the whole
   * body thereafter; runtime IK only reconciles chair travel/contact placement. */
  private adaptSitMotion(source:THREE.AnimationClip):THREE.AnimationClip {
    const position=this.anchor.position.clone(),rotation=this.anchor.quaternion.clone();
    this.anchor.position.set(0,0,0);this.anchor.quaternion.identity();this.anchor.updateMatrixWorld(true);
    this.idle.time=0;this.idle.setEffectiveWeight(1);this.mixer.update(0);
    const standing=this.hips.getWorldPosition(new THREE.Vector3());
    const upright=[this.hips,...this.spines,this.head,find(this.root,'neck')].filter((b):b is THREE.Bone=>!!b).map(bone=>({bone,rotation:bone.quaternion.clone()}));
    const action=this.mixer.clipAction(source).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const sampleSource=(t:number)=>{this.idle.setEffectiveWeight(0);action.setEffectiveWeight(1);action.time=Math.min(source.duration-1e-5,t*source.duration);this.mixer.update(0);this.anchor.updateMatrixWorld(true);return this.hips.getWorldPosition(new THREE.Vector3()).y;};
    const top=sampleSource(0),bottom=sampleSource(1),times:number[]=[],tracks=this.originals.map(p=>({bone:p.bone,positions:[] as number[],rotations:[] as number[]}));
    for(let i=0;i<=90;i++){
      const t=i/90,height=sampleSource(t),blend=easeCombat(Math.min(1,t/.18));
      action.setEffectiveWeight(blend);this.idle.setEffectiveWeight(1-blend);this.mixer.update(0);this.anchor.updateMatrixWorld(true);
      // A chair supports the pelvis. Recover an upright torso as it contacts
      // the seat instead of retaining the FBX's deep unsupported squat lean.
      for(const p of upright)p.bone.quaternion.slerp(p.rotation,easeCombat(Math.max(0,(t-.4)/.55)));
      this.anchor.updateMatrixWorld(true);
      const descent=THREE.MathUtils.clamp((top-height)/Math.max(.1,top-bottom),0,1),contact=easeCombat(Math.max(0,(t-.83)/.17));
      const p=THREE.MathUtils.lerp(descent,1,contact),wanted=standing.clone().lerp(this.referenceSeat,p);
      // Small lateral load precedes descent and disappears on seat contact.
      wanted.x+=.018*Math.sin(Math.PI*t);this.hips.position.copy(this.hips.parent!.worldToLocal(wanted));this.hips.updateWorldMatrix(false,true);
      for(const leg of this.legs){
        // The standing anchor is already in front of the pulled-out seat.
        // Keep that floor contact while the pelvis moves back onto the chair.
        solveCombatTwoBone(leg.upper,leg.lower,leg.foot,new THREE.Vector3(leg.lateral,this.soleHeight+.006,0),1,new THREE.Vector3(0,0,1),.997,.22);
        leg.foot.quaternion.copy(leg.foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(leg.rotation));leg.foot.updateWorldMatrix(false,true);
      }
      times.push(t*1.5);for(const track of tracks){track.positions.push(...track.bone.position.toArray());track.rotations.push(...track.bone.quaternion.toArray());}
    }
    action.stop();this.idle.setEffectiveWeight(1);this.mixer.update(0);this.anchor.position.copy(position);this.anchor.quaternion.copy(rotation);this.anchor.updateMatrixWorld(true);
    return new THREE.AnimationClip('computer-sit-retargeted-fbx',1.5,tracks.flatMap(p=>[
      new THREE.VectorKeyframeTrack(`${p.bone.name}.position`,times,p.positions),new THREE.QuaternionKeyframeTrack(`${p.bone.name}.quaternion`,times,p.rotations),
    ]));
  }
  sample(s:ComputerPoseSample):ComputerPoseFrame {
    this.procedural.restore();
    const walk=THREE.MathUtils.clamp(s.walking??0,0,1),seated=THREE.MathUtils.clamp(s.seated,0,1);
    this.idle.setEffectiveWeight(seated>0?0:1-walk);this.walk.setEffectiveWeight(seated>0?0:walk);this.sit.setEffectiveWeight(seated>0?1:0);this.sit.time=Math.min(this.sit.getClip().duration-1e-6,seated*this.sit.getClip().duration);
    this.idle.time=s.time%this.idle.getClip().duration;this.walk.time=s.time%this.walk.getClip().duration;this.mixer.update(0);this.procedural.capture(this.root);
    this.anchor.position.copy(s.feet);this.anchor.rotation.set(0,s.yaw,0);this.anchor.updateMatrixWorld(true);
    const q=this.anchor.quaternion,forward=new THREE.Vector3(0,0,1).applyQuaternion(q),right=new THREE.Vector3(1,0,0).applyQuaternion(q);
    const correction=s.seat.clone().add(new THREE.Vector3(0,.1,0)).sub(this.referenceSeat.clone().applyQuaternion(q).add(s.feet));
    if(seated>0){const wanted=this.hips.getWorldPosition(new THREE.Vector3()).addScaledVector(correction,easeCombat(seated));this.hips.position.copy(this.hips.parent!.worldToLocal(wanted));this.hips.updateWorldMatrix(false,true);}
    for(const spine of this.spines)worldRotation(spine,new THREE.Quaternion().setFromAxisAngle(right,s.lean*(seated>0?.28:1)/this.spines.length));
    // Planted ankles drive visible hip/knee flexion throughout sitting and rising.
    for(const leg of this.legs){
      const point=s.feet.clone().addScaledVector(right,leg.lateral);point.y=s.feet.y+this.soleHeight+.006;
      if(walk<.01){solveCombatTwoBone(leg.upper,leg.lower,leg.foot,point,1,forward,.997,.22);
        const rotation=q.clone().multiply(leg.rotation),parent=leg.foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();leg.foot.quaternion.copy(parent.multiply(rotation));leg.foot.updateWorldMatrix(false,true);}
    }
    for(let i=0;i<this.arms.length;i++){
      const arm=this.arms[i]!,target=i===0?s.leftHand:s.rightHand,weight=THREE.MathUtils.clamp(s.handWeight??1,0,1);if(!target||weight<=0)continue;
      const pole=right.clone().multiplyScalar(arm.side*.7).addScaledVector(forward,.35).add(new THREE.Vector3(0,-.55,0));
      solveCombatTwoBone(arm.upper,arm.lower,arm.hand,target,weight,pole,.985,Math.PI/2);
      // Align fingers along the table, palm down, without altering arm lengths.
      if(seated>.85){const localX=arm.normal.clone().cross(arm.finger).normalize(),localY=arm.normal.clone().projectOnPlane(arm.finger).normalize(),localZ=arm.finger.clone().normalize();
        const targetY=new THREE.Vector3(0,-1,0),targetZ=forward.clone(),targetX=new THREE.Vector3().crossVectors(targetY,targetZ).normalize();
        const local=new THREE.Matrix4().makeBasis(localX,localY,localZ),world=new THREE.Matrix4().makeBasis(targetX,targetY,targetZ),rotation=new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.invert()));
        arm.hand.quaternion.slerp(arm.hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation),easeCombat((seated-.85)/.15)*weight);arm.hand.updateWorldMatrix(false,true);
        const handBlend=easeCombat((seated-.85)/.15)*weight;
        arm.hand.traverse(o=>{const bone=o as THREE.Bone,rest=this.fingerRest.get(bone);if(rest){bone.quaternion.slerp(rest,handBlend).normalize();bone.updateWorldMatrix(false,true);}});
      }
    }
    this.anchor.updateMatrixWorld(true);
    const head=this.head.getWorldPosition(new THREE.Vector3()),eye=head.clone().add(new THREE.Vector3(0,.075,0)).addScaledVector(forward,.095);
    return{eye,head,hips:this.hips.getWorldPosition(new THREE.Vector3()),feet:this.legs.map(l=>l.foot.getWorldPosition(new THREE.Vector3())),knees:this.legs.map(l=>l.lower.getWorldPosition(new THREE.Vector3())),hands:this.arms.map(a=>a.hand.getWorldPosition(new THREE.Vector3()))};
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.mixer.stopAllAction();this.mixer.uncacheRoot(this.root);for(const p of this.originals){p.bone.position.copy(p.position);p.bone.quaternion.copy(p.rotation);}this.anchor.updateMatrixWorld(true);}
}
