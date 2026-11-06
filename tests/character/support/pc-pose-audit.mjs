import * as THREE from 'three';
import {writeFileSync,mkdirSync} from 'node:fs';
/** CPU diagnostic projection of the actual skinned clothes and furniture.
 * It cannot validate WebGL materials, lighting or browser input. */
export function auditComputerPose(name,lab,apartment){
 const camera=new THREE.PerspectiveCamera(57,1.4,.035,20);camera.position.set(-5.45,10.05,-3.55);camera.lookAt(-6.97,9.38,-4.5);camera.updateMatrixWorld(true);
 const triangles=[];const roots=[lab.avatarAnchor,apartment.computerChair,apartment.group.getObjectByName('Desk')];
 for(const root of roots)root?.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.visible||!mesh.geometry.getAttribute('position'))return;
  mesh.updateWorldMatrix(true,false);if(mesh.isSkinnedMesh)mesh.skeleton.update();
  const g=mesh.geometry,positions=g.getAttribute('position'),index=g.index,points=[];
  for(let i=0;i<positions.count;i++){const p=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).project(camera);points.push([p.x,p.y,p.z]);}
  const slot=mesh.userData.wardrobeSlot,color=slot==='top'?'#657462':slot==='bottom'?'#484d50':slot==='shoes'?'#292c2c':mesh.isSkinnedMesh?'#b18d76':root===apartment.computerChair?'#806141':'#79715f';
  for(let i=0;i<(index?.count??positions.count);i+=3){const tri=[0,1,2].map(k=>points[index?index.getX(i+k):i+k]);if(tri.some(p=>p[2]<-1||p[2]>1)||tri.every(p=>Math.abs(p[0])>1.3||Math.abs(p[1])>1.3))continue;
    const cross=(tri[1][0]-tri[0][0])*(tri[2][1]-tri[0][1])-(tri[1][1]-tri[0][1])*(tri[2][0]-tri[0][0]);
    triangles.push({points:tri,color,depth:tri.reduce((s,p)=>s+p[2],0)/3,shade:Math.min(1,.65+Math.abs(cross)*400)});
  }
 });
 mkdirSync('.asset-cache/pc-pose',{recursive:true});writeFileSync(`.asset-cache/pc-pose/${name}.json`,JSON.stringify(triangles));
}
