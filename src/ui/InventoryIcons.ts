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

/** Hand-drawn slot icon for Chloé's compass: open lid behind, brass case, dial and needle. */
export function compassIcon(): string {
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * Math.PI * 2, major = i % 6 === 0, r1 = major ? 12.2 : 13.4, r2 = 15;
    const x1 = 32 + Math.sin(a) * r1, y1 = 36 - Math.cos(a) * r1, x2 = 32 + Math.sin(a) * r2, y2 = 36 - Math.cos(a) * r2;
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#3a2e1f" stroke-width="${major ? 1.4 : .7}" stroke-linecap="round"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" data-object-thumbnail="true">
<defs>
<radialGradient id="cb" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#f3d58a"/><stop offset=".55" stop-color="#b8892f"/><stop offset="1" stop-color="#6b4a16"/></radialGradient>
<radialGradient id="cl" cx="45%" cy="40%" r="70%"><stop offset="0" stop-color="#e4c47a"/><stop offset="1" stop-color="#7b5a20"/></radialGradient>
<radialGradient id="cd" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#f6eed8"/><stop offset=".85" stop-color="#e3d5b2"/><stop offset="1" stop-color="#bba67a"/></radialGradient>
</defs>
<ellipse cx="32" cy="14" rx="15" ry="8.5" fill="url(#cl)" stroke="#5a3f12" stroke-width="1"/>
<ellipse cx="32" cy="14.6" rx="11.5" ry="6" fill="#c9a35a" opacity=".55"/>
<rect x="29.6" y="18.5" width="4.8" height="3.4" rx="1" fill="#7b5a20"/>
<circle cx="32" cy="36" r="20" fill="url(#cb)" stroke="#4d3510" stroke-width="1.2"/>
<circle cx="32" cy="36" r="17.6" fill="none" stroke="#f0d48c" stroke-width=".8" opacity=".7"/>
<circle cx="32" cy="36" r="16.2" fill="url(#cd)" stroke="#6b4a16" stroke-width=".8"/>
${ticks}
<text x="32" y="28" font-family="Georgia,serif" font-size="6.5" font-weight="700" fill="#9c1f17" text-anchor="middle">N</text>
<path d="M32 21.5 L34.6 36 L32 37.6 L29.4 36 Z" fill="#b3241a" stroke="#5e0d08" stroke-width=".5"/>
<path d="M32 50.5 L34.6 36 L32 34.4 L29.4 36 Z" fill="#efeadf" stroke="#6e6a60" stroke-width=".5"/>
<circle cx="32" cy="36" r="1.9" fill="#c79a3e" stroke="#5a3f12" stroke-width=".6"/>
<ellipse cx="26" cy="29" rx="6" ry="3.2" fill="#fff" opacity=".16" transform="rotate(-30 26 29)"/>
</svg>`;
}
