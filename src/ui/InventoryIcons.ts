import * as THREE from 'three';

type Point = { x: number; y: number; z: number };
const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function hull(points: Point[]): Point[] {
  const sorted = points.sort((a,b) => a.x-b.x || a.y-b.y), lower: Point[] = [], upper: Point[] = [];
  for (const p of sorted) { while (lower.length>1 && cross(lower.at(-2)!, lower.at(-1)!, p)<=0) lower.pop(); lower.push(p); }
  for (let i=sorted.length-1;i>=0;i--) { const p=sorted[i]!; while (upper.length>1 && cross(upper.at(-2)!, upper.at(-1)!, p)<=0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}

/** Cached CPU silhouettes from the actual meshes, including the torch's rings,
 * reflector, lens and switch. No second renderer, asset or per-frame GPU read. */
export function inventoryObjectIcon(parts: readonly THREE.Object3D[], local = false): string {
  const view = new THREE.Matrix4().lookAt(new THREE.Vector3(2,1.1,3), new THREE.Vector3(), new THREE.Vector3(0,1,0)).invert();
  const point = new THREE.Vector3(), instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  const edgeA=new THREE.Vector3(),edgeB=new THREE.Vector3(),normal=new THREE.Vector3(),light=new THREE.Vector3(.3,.7,1).normalize();
  const origin = local && parts[0] ? parts[0].matrixWorld.clone().invert() : new THREE.Matrix4();
  const polygons: { points: Point[]; depth: number; color: string; opacity: number }[] = [];
  const bounds = new THREE.Box2();
  for (const part of parts) {
    part.updateWorldMatrix(true,true);
    if(local && part === parts[0]) origin.copy(part.matrixWorld).invert();
    part.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const attr = mesh.geometry.getAttribute('position'); if(!attr) return;
      const instanced = mesh as THREE.InstancedMesh;
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      for (let n=0;n<(instanced.isInstancedMesh?instanced.count:1);n++) {
        world.copy(mesh.matrixWorld);
        if(instanced.isInstancedMesh){instanced.getMatrixAt(n,instance);world.multiply(instance);}
        world.premultiply(origin).premultiply(view);
        const points: Point[] = []; let depth=0;
        for(let i=0;i<attr.count;i++){point.fromBufferAttribute(attr,i).applyMatrix4(world);points.push({x:point.x,y:-point.y,z:point.z});depth+=point.z;}
        if(local){
          const index=mesh.geometry.index,count=index?.count??points.length;
          for(let t=0;t+2<count;t+=3){
            const a=points[index?index.getX(t):t]!,b=points[index?index.getX(t+1):t+1]!,c=points[index?index.getX(t+2):t+2]!;
            edgeA.set(b.x-a.x,a.y-b.y,b.z-a.z);edgeB.set(c.x-a.x,a.y-c.y,c.z-a.z);normal.crossVectors(edgeA,edgeB).normalize();
            if(normal.z<0&&material.side!==THREE.DoubleSide)continue;
            const color=material.color?.clone().multiplyScalar(.58+.42*Math.abs(normal.dot(light))).getHexString()??'b7b9aa';
            const outline=[a,b,c];for(const p of outline)bounds.expandByPoint(new THREE.Vector2(p.x,p.y));
            polygons.push({points:outline,depth:(a.z+b.z+c.z)/3,color:'#'+color,opacity:material.transparent?Math.max(.5,material.opacity):1});
          }
          continue;
        }
        const outline=hull(points); if(outline.length<3) continue;
        for(const p of outline)bounds.expandByPoint(new THREE.Vector2(p.x,p.y));
        polygons.push({points:outline,depth:depth/attr.count,color:'#'+(material.color?.getHexString()??'b7b9aa'),opacity:material.transparent?Math.max(.5,material.opacity):1});
      }
    });
  }
  if(bounds.isEmpty())return '';
  const size=bounds.getSize(new THREE.Vector2()),center=bounds.getCenter(new THREE.Vector2()),scale=54/Math.max(size.x,size.y,.001);
  const paths=polygons.sort((a,b)=>a.depth-b.depth).map(p=>`<polygon points="${p.points.map(v=>`${((v.x-center.x)*scale+32).toFixed(2)},${((v.y-center.y)*scale+32).toFixed(2)}`).join(' ')}" fill="${p.color}" fill-opacity="${p.opacity}" stroke="${local?p.color:'#d5dfd080'}" stroke-width="${local?'.15':'.65'}" stroke-linejoin="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" data-object-thumbnail="true">${paths}</svg>`;
}
