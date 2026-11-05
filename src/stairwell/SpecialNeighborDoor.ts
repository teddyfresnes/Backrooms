import * as THREE from 'three';

/** A real inward-opening leaf and a shallow, closed vestibule. Nothing covers
 * the doorway plane; the jamb, floor and back wall remain visible in the crack. */
export class SpecialNeighborDoor {
  private readonly pivot=new THREE.Group();
  private readonly recess=new THREE.Group();
  private readonly parent:THREE.Object3D;
  private readonly closed=new THREE.Matrix4();
  private readonly autoUpdate:boolean;
  private elapsed?:number;
  constructor(private readonly leaf:THREE.Object3D,private readonly onSlam:()=>void){
    this.parent=leaf.parent!;leaf.updateWorldMatrix(true,true);this.closed.copy(leaf.matrix);this.autoUpdate=leaf.matrixAutoUpdate;
    const box=new THREE.Box3().setFromObject(leaf),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const hinge=new THREE.Vector3().fromArray(leaf.userData.neighborHinge??[center.x,box.min.y,box.min.z]);
    this.pivot.name='special-neighbor-door-hinge';
    this.parent.add(this.pivot);this.pivot.position.copy(this.parent.worldToLocal(hinge));this.pivot.updateWorldMatrix(true,false);
    this.pivot.attach(leaf);leaf.updateMatrix();leaf.matrixAutoUpdate=false;
    this.recess.name='neighbor-entry-alcove';this.recess.userData.noBatch=true;
    this.parent.add(this.recess);
    const world=new THREE.Matrix4().makeTranslation(box.max.x+.035,box.min.y,center.z);
    this.recess.matrix.copy(this.parent.matrixWorld.clone().invert().multiply(world));this.recess.matrixAutoUpdate=false;
    const plaster=new THREE.MeshStandardMaterial({color:0x777166,roughness:1});
    const floor=new THREE.MeshStandardMaterial({color:0x494239,roughness:.96});
    const trim=new THREE.MeshStandardMaterial({color:0x474339,roughness:1});
    const width=size.z+.22,depth=1.25,height=size.y+.08;
    const boxMesh=(name:string,dims:[number,number,number],p:[number,number,number],material:THREE.Material)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...dims),material);mesh.name=name;mesh.position.set(...p);this.recess.add(mesh);
    };
    boxMesh('neighbor-alcove-floor',[depth,.08,width],[depth/2,-.04,0],floor);
    boxMesh('neighbor-alcove-ceiling',[depth,.08,width],[depth/2,height+.04,0],plaster);
    boxMesh('neighbor-alcove-back-wall',[.08,height,width],[depth+.04,height/2,0],plaster);
    for(const side of [-1,1]){
      boxMesh(`neighbor-alcove-side-${side}`,[depth,height,.08],[depth/2,height/2,side*(width/2+.04)],plaster);
      boxMesh(`neighbor-alcove-skirting-${side}`,[depth,.085,.025],[depth/2,.042,side*(width/2-.012)],trim);
    }
    const bulb=new THREE.MeshStandardMaterial({color:0x9b8b6e,emissive:0x9b6c33,emissiveIntensity:.12,roughness:1});
    boxMesh('neighbor-alcove-night-light',[.035,.10,.06],[depth-.025,1.1,.28],bulb);
    const light=new THREE.PointLight(0xc9b38b,.5,2.2,2);light.position.set(.62,1.6,.28);this.recess.add(light);
    this.recess.updateWorldMatrix(true,true);
  }
  start():void {if(this.elapsed===undefined)this.elapsed=0;}
  update(delta:number):void {
    if(this.elapsed===undefined)return;
    this.elapsed+=Math.max(0,delta);const t=this.elapsed;
    const angle=t<.2?.38*(1-(1-t/.2)**3):t<.67?.38:.38*Math.max(0,1-(t-.67)/.11);
    this.pivot.rotation.y=-angle;this.pivot.updateMatrixWorld(true);
    if(t>=.78){this.elapsed=undefined;this.pivot.rotation.y=0;this.pivot.updateMatrixWorld(true);this.onSlam();}
  }
  dispose():void {
    this.elapsed=undefined;this.pivot.rotation.y=0;this.pivot.updateMatrixWorld(true);
    this.parent.attach(this.leaf);this.leaf.matrix.copy(this.closed);this.leaf.matrix.decompose(this.leaf.position,this.leaf.quaternion,this.leaf.scale);this.leaf.matrixAutoUpdate=this.autoUpdate;
    this.pivot.removeFromParent();this.recess.removeFromParent();
    const materials=new Set<THREE.Material>();
    this.recess.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    materials.forEach(m=>m.dispose());this.recess.clear();
  }
}
