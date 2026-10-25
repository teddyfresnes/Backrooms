import type * as THREE from 'three';
type Triangle={xy:number[][];bounds:number[];name:string};
const intersectArea=(a:number[][],b:number[][])=>{
 let p=a;const cross=(u:number[],v:number[],w:number[])=>(v[0]!-u[0]!)*(w[1]!-u[1]!)-(v[1]!-u[1]!)*(w[0]!-u[0]!);
 const orientation=Math.sign(cross(b[0]!,b[1]!,b[2]!));
 for(let k=0;k<3&&p.length;k++){
  const u=b[k]!,v=b[(k+1)%3]!,q:number[][]=[];
  for(let i=0;i<p.length;i++){
   const x=p[i]!,y=p[(i+1)%p.length]!,dx=cross(u,v,x)*orientation,dy=cross(u,v,y)*orientation;
   if(dx>=-1e-8)q.push(x);
   if((dx>0)!==(dy>0)){const t=dx/(dx-dy);q.push(x.map((s,j)=>s+(y[j]!-s)*t));}
  }p=q;
 }
 return Math.abs(p.reduce((s,v,i)=>{const w=p[(i+1)%p.length]!;return s+v[0]!*w[1]!-w[0]!*v[1]!;},0))/2;
};
/** Independent intersection audit on emitted Float32 triangles, including
 * batches whose clipped faces no longer consist of exactly two triangles. */
export const auditAxisPlaneTriangles=(batches:readonly{name:string;geometry:THREE.BufferGeometry}[])=>{
 const bins=new Map<string,Triangle[]>(),errors:string[]=[];let triangleCount=0;
 for(const batch of batches){const p=batch.geometry.getAttribute('position'),normal=batch.geometry.getAttribute('normal');
  for(let i=0;i<p.count;i+=3){
   const coords=[0,1,2].map(a=>[0,1,2].map(j=>p.getComponent(i+j,a))),fixed=coords.findIndex(c=>Math.max(...c)-Math.min(...c)<.00001);if(fixed<0)continue;
   const axes=[0,1,2].filter(a=>a!==fixed),xy=[0,1,2].map(j=>axes.map(a=>coords[a]![j]!));
   const bounds=[Math.min(...xy.map(v=>v[0]!)),Math.max(...xy.map(v=>v[0]!)),Math.min(...xy.map(v=>v[1]!)),Math.max(...xy.map(v=>v[1]!))];
   if(bounds[1]!-bounds[0]!<.00001||bounds[3]!-bounds[2]!<.00001||Math.abs(normal.getComponent(i,fixed))<.9)continue;
   const key=`${fixed}/${Math.sign(normal.getComponent(i,fixed))}/${Math.round(coords[fixed]![0]!*10000)}`,bin=bins.get(key)??[];
   bin.push({xy,bounds,name:batch.name});bins.set(key,bin);triangleCount++;
  }
 }
 for(const[key,triangles]of bins){triangles.sort((a,b)=>a.bounds[0]!-b.bounds[0]!);
  for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++){
   const a=triangles[i]!,b=triangles[j]!;if(b.bounds[0]!>=a.bounds[1]!-.00001)break;
   if(b.bounds[2]!>=a.bounds[3]!-.00001||b.bounds[3]!<=a.bounds[2]!+.00001)continue;
   const overlap=intersectArea(a.xy,b.xy);if(overlap>.0001&&errors.length<12)errors.push(`${key}: ${a.name}/${b.name} area=${overlap}`);
  }
 }
 return{triangleCount,errors};
};
