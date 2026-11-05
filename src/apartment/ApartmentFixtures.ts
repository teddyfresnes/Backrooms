import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import type { ApartmentObjectInteraction } from './ApartmentObjectInteraction';
import type { ApartmentDeviceAudio } from '../audio/ApartmentDeviceAudio';
import { freshFixtures, type ApartmentFixturesProgress } from './ApartmentInteractionState';
export const SINK={minX:-5.528,maxX:-4.842,minZ:-.288,maxZ:.264,bottom:9.423,maxSurface:9.62};
const NOZZLE=new THREE.Vector3(-5.187,9.9593,.1326),FAN_BUTTON=new THREE.Vector3(-8.15225,9.61575,-.16555),LAMP_BUTTON=new THREE.Vector3(-6.0921,9.54,-5.7631);
type Fixture='tap'|'fan'|'lamp';
export class ApartmentFixtures {
  private readonly state:ApartmentFixturesProgress;
  private readonly created:THREE.Object3D[]=[];
  private readonly geometries=new Set<THREE.BufferGeometry>();
  private readonly materials=new Set<THREE.Material>();
  private readonly water:THREE.Mesh;
  private readonly stream:THREE.Mesh;
  private readonly ripple:THREE.Mesh;
  private readonly spotlight=new THREE.SpotLight(0xffd0a1,0,4.2,.88,.65,1.7);
  private readonly lightTarget=new THREE.Object3D();
  private readonly blades?:THREE.Object3D;
  private readonly bladeRotation:THREE.Quaternion;
  private readonly bulb?:THREE.Mesh;
  private readonly originalBulb?:THREE.Material|THREE.Material[];
  private readonly bulbMaterial?:THREE.MeshStandardMaterial;
  private readonly unsubscribe:()=>void;
  private fanSpeed=0;
  private bladeAngle=0;
  private elapsed=0;
  private brightness=1;
  private prompted=false;
  private readonly ray=new THREE.Ray();
  private readonly direction=new THREE.Vector3();
  private readonly targets=new Map<Fixture,THREE.Box3>();
  constructor(private readonly apartment:ImportedApartmentEnvironment,private readonly physics:PhysicsWorld,private readonly objects:ApartmentObjectInteraction,
    private readonly camera:THREE.Camera,private readonly ui:{setInteraction(label:string|null):void},private readonly audio:ApartmentDeviceAudio,
    private readonly powered:()=>boolean,progress?:ApartmentFixturesProgress){
    this.state={...(progress??freshFixtures())};
    this.water=this.mesh(new THREE.PlaneGeometry(SINK.maxX-SINK.minX,SINK.maxZ-SINK.minZ),new THREE.MeshStandardMaterial({color:0x759f9c,transparent:true,opacity:.52,roughness:.14,metalness:.18,side:THREE.DoubleSide,depthWrite:false}));
    this.water.name='sink-water-surface';this.water.rotation.x=-Math.PI/2;this.water.position.set((SINK.minX+SINK.maxX)/2,SINK.bottom,(SINK.minZ+SINK.maxZ)/2);
    this.stream=this.mesh(new THREE.CylinderGeometry(.006,.008,1,7),new THREE.MeshBasicMaterial({color:0xc6e1db,transparent:true,opacity:.57,depthWrite:false}));this.stream.name='tap-running-water';
    this.ripple=this.mesh(new THREE.RingGeometry(.018,.023,18),new THREE.MeshBasicMaterial({color:0xc6e1db,transparent:true,opacity:.35,side:THREE.DoubleSide,depthWrite:false}));this.ripple.rotation.x=-Math.PI/2;
    const plug=this.mesh(new THREE.CylinderGeometry(.024,.024,.004,12),new THREE.MeshStandardMaterial({color:0x474a45,metalness:.7,roughness:.35}));plug.position.set(-5.1853,9.4351,.0115);
    const overflow=this.mesh(new THREE.BoxGeometry(.065,.012,.003),new THREE.MeshStandardMaterial({color:0x222c2a,roughness:.8}));overflow.position.set(-5.185,9.625,SINK.maxZ+.012);overflow.name='sink-overflow-slot';
    this.targets.set('tap',new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(-5.20,9.83,.23),new THREE.Vector3(.24,.31,.24)));
    if(apartment.fan)this.targets.set('fan',new THREE.Box3().setFromCenterAndSize(FAN_BUTTON,new THREE.Vector3(.22,.14,.18)));
    if(apartment.deskLamp)this.targets.set('lamp',new THREE.Box3().setFromCenterAndSize(LAMP_BUTTON,new THREE.Vector3(.18,.12,.16)));
    this.blades=apartment.fan?.getObjectByName('Bone003_03');this.bladeRotation=this.blades?.quaternion.clone()??new THREE.Quaternion();if(this.blades)this.blades.matrixAutoUpdate=true;
    const bulb=apartment.deskLamp?.getObjectByName('Object_24') as THREE.Mesh|undefined;
    if(bulb?.isMesh){this.bulb=bulb;this.originalBulb=bulb.material;const source=Array.isArray(bulb.material)?bulb.material[0]!:bulb.material;this.bulbMaterial=(source as THREE.MeshStandardMaterial).clone();bulb.material=this.bulbMaterial;this.materials.add(this.bulbMaterial);}
    this.spotlight.position.set(-6.116108,9.815836,-5.747627);this.lightTarget.position.copy(this.spotlight.position).add(new THREE.Vector3(-.603778,-.713479,.355527));this.spotlight.target=this.lightTarget;this.spotlight.castShadow=false;
    this.add(this.spotlight);this.add(this.lightTarget);
    this.unsubscribe=physics.onBeforeStep(dt=>this.step(dt));this.update(0,false,false);
  }
  private add<T extends THREE.Object3D>(object:T):T{this.apartment.group.add(object);this.created.push(object);return object;}
  private mesh(g:THREE.BufferGeometry,m:THREE.Material):THREE.Mesh{this.geometries.add(g);this.materials.add(m);return this.add(new THREE.Mesh(g,m));}
  private step(dt:number):void {
    this.elapsed+=dt;if(this.state.tapOn)this.state.waterLevel=Math.min(1,this.state.waterLevel+dt*.022);
    const desired=this.state.fanOn&&this.powered()?27:0;this.fanSpeed=THREE.MathUtils.damp(this.fanSpeed,desired,desired?1.5:1.1,dt);if(this.fanSpeed<.005)this.fanSpeed=0;
    this.bladeAngle=(this.bladeAngle+this.fanSpeed*dt)%(Math.PI*2);
    if(this.blades){this.blades.quaternion.copy(this.bladeRotation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),this.bladeAngle));this.blades.updateMatrix();this.blades.updateMatrixWorld(true);}
    this.objects.applyBuoyancy({...SINK,surface:this.surface},dt);
  }
  get surface():number{return SINK.bottom+(SINK.maxSurface-SINK.bottom)*this.state.waterLevel;}
  private hit():Fixture|undefined {
    this.camera.getWorldDirection(this.direction);this.ray.set(this.camera.position,this.direction);let nearest=2.15,found:Fixture|undefined;
    for(const [key,box]of this.targets){const hit=this.ray.intersectBox(box,new THREE.Vector3());if(!hit)continue;const d=hit.distanceTo(this.camera.position);if(d>nearest)continue;
      const wall=this.physics.world.castRay(new RAPIER.Ray(this.camera.position,this.direction),d,true,undefined,undefined,undefined,undefined,this.physics.isEnvironmentCollider);if(wall&&wall.timeOfImpact+.10<d)continue;nearest=d;found=key;
    }return found;
  }
  interact():boolean{const hit=this.hit();if(!hit)return false;if(hit==='tap')this.state.tapOn=!this.state.tapOn;if(hit==='fan')this.state.fanOn=!this.state.fanOn;if(hit==='lamp')this.state.deskLampOn=!this.state.deskLampOn;this.audio.fixtureClick(hit==='tap'?NOZZLE:hit==='fan'?FAN_BUTTON:LAMP_BUTTON);this.update(0,true,false);return true;}
  setBrightness(value:number):void{this.brightness=value;}
  update(_dt:number,active:boolean,canInteract:boolean):void {
    const surface=this.surface;this.water.visible=this.state.waterLevel>.003;this.water.position.y=surface;
    this.stream.visible=this.state.tapOn;const bottom=Math.max(9.44,surface+.004),height=NOZZLE.y-bottom;this.stream.position.set(NOZZLE.x,bottom+height/2,NOZZLE.z);this.stream.scale.set(1,height,1);
    this.ripple.visible=this.state.tapOn;this.ripple.position.set(NOZZLE.x,bottom+.002,NOZZLE.z);this.ripple.scale.setScalar(1+Math.sin(this.elapsed*7)*.35);
    const lit=this.state.deskLampOn&&this.powered();this.spotlight.intensity=lit?4.5*this.brightness:0;
    if(this.bulbMaterial){this.bulbMaterial.emissive.setHex(lit?0xffd1a0:0);this.bulbMaterial.emissiveIntensity=lit?.7*this.brightness:0;}
    this.audio.fixture('water',NOZZLE,active&&this.state.tapOn?1:0);this.audio.fixture('fan',FAN_BUTTON,active?this.fanSpeed/27:0);
    if(!canInteract){if(this.prompted)this.ui.setInteraction(null);this.prompted=false;return;}const hit=this.hit();
    if(hit){this.ui.setInteraction(hit==='tap'?`${this.state.tapOn?'Fermer':'Ouvrir'} le robinet`:hit==='fan'?`${this.state.fanOn?'Arrêter':'Allumer'} le ventilateur`:`${this.state.deskLampOn?'Éteindre':'Allumer'} la lampe`);this.prompted=true;}else if(this.prompted){this.ui.setInteraction(null);this.prompted=false;}
  }
  getProgress():ApartmentFixturesProgress{return {...this.state};}
  get debugState(){return {waterLevel:this.state.waterLevel,surface:this.surface,fanSpeed:this.fanSpeed,light:this.spotlight.intensity,stream:this.stream.visible};}
  dispose():void{this.unsubscribe();this.audio.fixture('water',NOZZLE,0);this.audio.fixture('fan',FAN_BUTTON,0);if(this.blades){this.blades.quaternion.copy(this.bladeRotation);this.blades.updateMatrix();}if(this.bulb&&this.originalBulb)this.bulb.material=this.originalBulb;this.created.forEach(o=>o.removeFromParent());this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());}
}
