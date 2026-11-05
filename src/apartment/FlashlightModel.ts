import * as THREE from 'three';

/** Compact lathed aluminium body, bevelled bezel, recessed reflector and rubber grip. */
export function createFlashlightModel():THREE.Group {
  const group=new THREE.Group();group.name='quest-flashlight';
  const metal=new THREE.MeshStandardMaterial({color:0x30383b,roughness:.42,metalness:.72});
  const rubber=new THREE.MeshStandardMaterial({color:0x161b1d,roughness:.92});
  const silver=new THREE.MeshStandardMaterial({color:0xa7adb0,roughness:.22,metalness:.88});
  const profile=[[.015,0],[.019,.005],[.019,.025],[.017,.03],[.017,.168],[.022,.175],[.025,.195],[.034,.218],[.037,.224],[.037,.263],[.034,.269]].map(([r,y])=>new THREE.Vector2(r,y));
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile,24),metal));
  const collar=new THREE.Mesh(new THREE.TorusGeometry(.035,.0025,6,24),silver);collar.rotation.x=Math.PI/2;collar.position.y=.265;group.add(collar);
  const reflector=new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(.005,.237),new THREE.Vector2(.014,.245),new THREE.Vector2(.031,.26)],24),silver);reflector.material.side=THREE.DoubleSide;group.add(reflector);
  const lens=new THREE.Mesh(new THREE.CircleGeometry(.031,24),new THREE.MeshStandardMaterial({color:0xa3b9b4,roughness:.16,metalness:.22,emissive:0xffedbd,emissiveIntensity:0}));lens.name='torch-lens';lens.rotation.x=-Math.PI/2;lens.position.y=.2685;group.add(lens);
  const ribs=new THREE.InstancedMesh(new THREE.TorusGeometry(.018,.0013,5,20),rubber,9),matrix=new THREE.Matrix4(),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);
  for(let i=0;i<9;i++)ribs.setMatrixAt(i,matrix.compose(new THREE.Vector3(0,.045+i*.012,0),q,new THREE.Vector3(1,1,1)));group.add(ribs);
  const button=new THREE.Mesh(new THREE.BoxGeometry(.013,.025,.006),rubber);button.position.set(0,.183,.025);group.add(button);
  const mark=new THREE.Mesh(new THREE.BoxGeometry(.011,.005,.001),new THREE.MeshStandardMaterial({color:0xc9b983,roughness:.7}));mark.position.set(0,.201,.027);group.add(mark);
  return group;
}
