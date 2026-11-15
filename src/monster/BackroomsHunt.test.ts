import * as THREE from 'three';
import { expect, it } from 'vitest';
import { BackroomsHunt, type BackroomsHuntHost } from './BackroomsHunt';

const DT=1/30;
const setup=(blocked=false)=>{
  const camera=new THREE.PerspectiveCamera(72,16/9,.04,180);
  const position=new THREE.Vector3(0,.865,0),root=new THREE.Group();
  const actor={root,isVisible:false,setVisible(value:boolean){this.isVisible=value;},
    setPlacement(p:THREE.Vector3Like,yaw:number){root.position.copy(p);root.rotation.y=yaw;},
    setMotion:()=>{},setPace:()=>{},setHeadTwist:()=>{},setLookTarget:()=>{},snapHead:()=>{},update:()=>{}};
  const silent=new Proxy({}, {get:(_target,key)=>key==='hasPresence'||key==='isScreaming'?false:()=>{}});
  const host={renderCamera:camera,player:{position,horizontalSpeed:0,isMoving:false,isSprinting:false,
    getViewDirection:(out=new THREE.Vector3())=>camera.getWorldDirection(out)},
    physics:{probeWalkableCell:(_x:number,_z:number,y:number)=>y,
      castEnvironmentRay:()=>blocked?{distance:.5}:null},
    creatureSound:silent,sound:silent,hud:{pulseFlash:()=>{}},seed:'hunt-runtime',creature:()=>actor,say:()=>{}};
  const glow=new THREE.PointLight(),hunt=new BackroomsHunt(host as unknown as BackroomsHuntHost,glow);
  const frame=(aim=new THREE.Vector3(0,1.5,-20))=>{
    camera.position.set(position.x,1.65,position.z);camera.lookAt(aim);hunt.update(DT,true,false);
  };
  return {hunt,position,frame,dispose:()=>{hunt.dispose();glow.dispose();}};
};

it('sees a quiet player in its field of view through the actual runtime senses',()=>{
  const h=setup();
  try{
    h.hunt.hunter.place({x:0,y:0,z:-30,yaw:0,style:'still'});
    for(let t=0;t<1.5&&!h.hunt.engaged;t+=DT)h.frame();
    expect(h.hunt.engaged).toBe(true);
  }finally{h.dispose();}
});

it('turns and chases when stared at from 40 m, even with its back turned',()=>{
  const h=setup();
  try{
    h.hunt.hunter.place({x:0,y:0,z:-40,yaw:Math.PI,style:'still'});
    for(let t=0;t<3&&h.hunt.state!=='chase';t+=DT)h.frame(new THREE.Vector3(0,1.5,-40));
    expect(h.hunt.state).toBe('chase');
  }finally{h.dispose();}
});

it('does not see or react to a stare through an opaque wall',()=>{
  const h=setup(true);
  try{
    h.hunt.hunter.place({x:0,y:0,z:-20,yaw:0,style:'still'});
    for(let t=0;t<4;t+=DT)h.frame();
    expect(h.hunt.engaged).toBe(false);
  }finally{h.dispose();}
});
it('reacts beyond its normal sight radius at 175 metres and closes the gap across navigation windows',()=>{
  const h=setup();try{
    h.hunt.hunter.place({x:0,y:0,z:-175,yaw:Math.PI,style:'still'});
    for(let t=0;t<4&&h.hunt.state!=='chase';t+=DT)h.frame(new THREE.Vector3(0,1.5,-175));
    expect(h.hunt.state).toBe('chase');
    for(let t=0;t<10;t+=DT)h.frame(new THREE.Vector3(0,1.5,-175));
    expect(h.hunt.position.z).toBeGreaterThan(-135);
  }finally{h.dispose();}
});

it('keeps a roaming creature inside its navigation window as the player walks away',()=>{
  const h=setup(true);
  try{
    h.hunt.hunter.place({x:-28,y:0,z:0,yaw:Math.PI/2,style:'cross',crossTo:{x:-5,z:0}});
    h.frame();h.hunt.nav.computeField(-5,0,1e6);
    for(let t=0;t<8;t+=DT){
      h.position.x+=4*DT;h.frame(new THREE.Vector3(h.position.x,1.65,20));
      expect(h.hunt.nav.indexAt(h.hunt.position.x,h.hunt.position.z)).toBeGreaterThanOrEqual(0);
      expect(h.hunt.nav.indexAt(h.position.x,h.position.z)).toBeGreaterThanOrEqual(0);
    }
    expect(h.hunt.position.x).toBeGreaterThan(-17);
  }finally{h.dispose();}
});
