import * as THREE from 'three';
import { geometryIslands, selectedGeometry } from './GeometryIslands';
export interface ApartmentPickable {
  id: string; label: string; parts: THREE.Object3D[]; bounds: THREE.Box3;
  supportCluster?: 'books'; breakable?: boolean; appliance?: 'radio';
  kind?: 'whisky'|'pot'|'stool'|'chess'|'bottle'|'glass'|'plate'; mass?: number; buoyancy?: number;
  compound?: boolean; collisionParts?: THREE.Object3D[]; plant?: THREE.Object3D;
}
const pathOf=(object:THREE.Object3D,model:THREE.Object3D):string=>{
  const names:string[]=[];for(let p:THREE.Object3D|null=object;p&&p!==model;p=p.parent)names.unshift(p.name||`part${p.parent?.children.indexOf(p)??0}`);
  return `prop:${names.join('/').replace(/[^a-zA-Z0-9_ .:/-]/g,'_')}`;
};
const plateNames = new Set(['pSphere2','pSphere3','pSphere4','pSphere5_1','pSphere6','pCylinder64']);
const bottleNames = new Set(['pCylinder52','pCylinder53','pCylinder55','pCylinder56']);
const glassNames = new Set(['pCylinder60','pCylinder61','pCylinder63']);
/** One stable identity and fitted body for every visible loose object. */
export function collectApartmentPickables(model: THREE.Object3D): ApartmentPickable[] {
  model.updateWorldMatrix(true,true);const candidates=new Set<THREE.Object3D>();
  for(const name of ['KitchenStuff','use_KitchenStuff'])for(const child of model.getObjectByName(name)?.children??[])candidates.add(child);
  // The radio is not loose: it stays fixed on its shelf (static collider in the environment).
  for(const name of ['whisky','cigaret pack','FloppyDisk_Black','FloppyDisk_Blue','FloppyDisk_Green','FloppyDisk_Red','stool','stool1','flowerpot']){
    const object=model.getObjectByName(name);if(object)candidates.add(object);
  }
  const chess=model.getObjectByName('chess_set');chess?.traverse(o=>{if(/^Cube\d*$/.test(o.name)&&o.name!=='Cube001')candidates.add(o);});
  model.traverse(o=>{if(o.userData.pickableBook)candidates.add(o);});
  const items:ApartmentPickable[]=[];
  for(const object of candidates){
    if(object.name==='pCube113'||object.userData.staticPan)continue;
    let visible=true;for(let p:THREE.Object3D|null=object;p&&p!==model;p=p.parent)visible&&=p.visible;if(!visible)continue;
    const bounds=new THREE.Box3().setFromObject(object,true),size=bounds.getSize(new THREE.Vector3());
    if(bounds.isEmpty()||Math.max(size.x,size.y,size.z)>.8||size.length()<.015)continue;
    object.userData.noBatch=true;
    const kind=object.name==='whisky'?'whisky':object.name==='flowerpot'?'pot':/^stool/.test(object.name)?'stool':chess&&isDescendant(object,chess)?'chess':plateNames.has(object.name)?'plate':bottleNames.has(object.name)?'bottle':glassNames.has(object.name)?'glass':undefined;
    const label=kind==='pot'?'Pot de fleurs':kind==='stool'?'Tabouret':kind==='chess'?'Pièce d’échecs':kind==='plate'?'Assiette':kind==='bottle'?'Bouteille':kind==='glass'?'Verre':object.userData.pickableBook?'Livre':kind==='whisky'?'Bouteille de whisky':object.name==='radio'?'Radio':object.name==='cigaret pack'?'Paquet de cigarettes':object.name.startsWith('FloppyDisk')?'Disquette':object.parent?.name==='use_KitchenStuff'&&size.y>.23&&Math.max(size.x,size.z)<.16?'Bouteille':object.parent?.name==='use_KitchenStuff'&&size.y<.12&&Math.max(size.x,size.z)<.09?'Verre':'Objet de cuisine';
    const overlap=!['whisky','pot','stool','chess'].includes(kind??'')&&!object.userData.pickableBook&&items.find(item=>{
      if(item.supportCluster||['whisky','pot','stool','chess'].includes(item.kind??''))return false;const a=item.bounds.getSize(new THREE.Vector3()),v=item.bounds.clone().intersect(bounds).getSize(new THREE.Vector3());
      const small=Math.min(a.x*a.y*a.z,size.x*size.y*size.z);return small>1e-9&&v.x*v.y*v.z/small>.65;
    });
    if(overlap){overlap.parts.push(object);overlap.bounds.union(bounds);if(kind){overlap.kind=kind;overlap.label=label;overlap.breakable=true;}continue;}
    const item:ApartmentPickable={id:object.userData.pickableBook?object.name:pathOf(object,model),label,parts:[object],bounds,kind,
      mass:kind==='chess'?.012:kind==='stool'?2.8:kind==='pot'?1.15:kind==='whisky'?.95:undefined,
      buoyancy:kind==='chess'||kind==='stool'?1.75:object.userData.pickableBook?1.4:object.name.startsWith('FloppyDisk')||object.name==='cigaret pack'?2:.38,
      ...(object.userData.pickableBook?{supportCluster:'books' as const}:{}),...(['whisky','pot','plate','bottle','glass'].includes(kind??'')?{breakable:true}:{}),
      ...(kind==='stool'?{compound:true}:{}),...(object.name==='radio'?{appliance:'radio' as const,buoyancy:.25}:{})};
    if(kind==='pot'){
      const source=object.getObjectByName('flowerpot_M_LivingRoom_0') as THREE.Mesh;
      if(source?.isMesh){
        const islands=geometryIslands(source),ceramic=new THREE.Mesh(selectedGeometry(source.geometry,islands[0]!.triangles),source.material),plant=new THREE.Mesh(selectedGeometry(source.geometry,islands.slice(1).flatMap(i=>i.triangles)),source.material);
        ceramic.name='flowerpot-ceramic';plant.name='flowerpot-plant';
        for(const mesh of [ceramic,plant]){mesh.matrix.copy(source.matrix);mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);mesh.userData.noBatch=true;source.parent!.add(mesh);}
        source.visible=false;item.collisionParts=[ceramic];item.plant=plant;
        object.userData.splitPotSource=source;object.userData.splitPotGeometry=[ceramic.geometry,plant.geometry];
      }
    }
    items.push(item);
  }
  return items;
}
function isDescendant(object:THREE.Object3D,parent:THREE.Object3D):boolean {for(let p:THREE.Object3D|null=object;p;p=p.parent)if(p===parent)return true;return false;}
