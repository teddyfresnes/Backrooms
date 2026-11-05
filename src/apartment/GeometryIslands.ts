import * as THREE from 'three';
export interface GeometryIsland { triangles: number[]; vertices: number[]; bounds: THREE.Box3 }
/** Weld positions across UV/normal seams, retaining the original triangles. */
export function geometryIslands(mesh: THREE.Mesh): GeometryIsland[] {
  mesh.updateWorldMatrix(true,false);
  const g=mesh.geometry,p=g.getAttribute('position'),index=g.index, count=Math.floor((index?.count??p.count)/3);
  const vertex=(i:number)=>index?index.getX(i):i, point=new THREE.Vector3(), weld=new Map<string,number>(), ids:number[]=[], parents:number[]=[];
  const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]!]!;i=parents[i]!;}return i;};
  for(let i=0;i<p.count;i++){
    point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld); const key=[point.x,point.y,point.z].map(v=>Math.round(v*1e5)).join(',');
    let id=weld.get(key);if(id===undefined){id=parents.length;parents.push(id);weld.set(key,id);}ids[i]=id;
  }
  for(let t=0;t<count;t++){const a=root(ids[vertex(t*3)]!);for(let k=1;k<3;k++)parents[root(ids[vertex(t*3+k)]!)]=a;}
  const groups=new Map<number,GeometryIsland>();
  for(let t=0;t<count;t++){
    const id=root(ids[vertex(t*3)]!), group=groups.get(id)??{triangles:[],vertices:[],bounds:new THREE.Box3()};
    group.triangles.push(t);for(let k=0;k<3;k++){const v=vertex(t*3+k);group.vertices.push(v);point.fromBufferAttribute(p,v).applyMatrix4(mesh.matrixWorld);group.bounds.expandByPoint(point);}groups.set(id,group);
  }
  return [...groups.values()].sort((a,b)=>b.triangles.length-a.triangles.length);
}
export function selectedGeometry(source: THREE.BufferGeometry, triangles: readonly number[]): THREE.BufferGeometry {
  const result=new THREE.BufferGeometry(),index=source.index;
  for(const [name,attr] of Object.entries(source.attributes)){
    const values:number[]=[];
    for(const t of triangles)for(let k=0;k<3;k++){const i=index?index.getX(t*3+k):t*3+k;for(let c=0;c<attr.itemSize;c++)values.push(attr.getComponent(i,c));}
    result.setAttribute(name,new THREE.Float32BufferAttribute(values,attr.itemSize,attr.normalized));
  }
  result.computeBoundingBox();result.computeBoundingSphere();return result;
}
