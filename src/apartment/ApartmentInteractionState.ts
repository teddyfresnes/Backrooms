import type { Vec3Data, QuaternionData } from '../world/types';
export interface DepositState { kind: 'whisky' | 'soil'; position: Vec3Data; normal: Vec3Data; radius: number }
export interface PropPose { position: Vec3Data; rotation: QuaternionData; sleeping: boolean; visualMatrix?: number[] }
export type BrokenPropKind = 'whisky' | 'pot' | 'glass' | 'ceramic';
export interface ApartmentObjectsProgress {
  version: 1; bodies: Record<string, PropPose>;
  broken: Record<string, { kind: BrokenPropKind; position: Vec3Data; residuePending?: boolean }>;
  deposits: DepositState[];
}
export interface ApartmentFixturesProgress { version: 1; tapOn: boolean; waterLevel: number; fanOn: boolean; deskLampOn: boolean; closetDoor: number }
export const freshFixtures = (): ApartmentFixturesProgress => ({ version: 1, tapOn: false, waterLevel: 0, fanOn: false, deskLampOn: false, closetDoor: 0 });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vector = (v: unknown): v is Vec3Data => record(v) && ['x','y','z'].every(k => finite(v[k]) && Math.abs(v[k] as number) < 2000);
const idValid = (id: string) => id.length > 0 && id.length < 220 && /^[a-zA-Z0-9_ .:/-]+$/.test(id);
export function sanitizeApartmentObjects(v: unknown): ApartmentObjectsProgress | null {
  if (!record(v) || v.version !== 1 || !record(v.bodies) || !record(v.broken) || !Array.isArray(v.deposits)
    || Object.keys(v.bodies).length > 128 || Object.keys(v.broken).length > 128 || v.deposits.length > 48) return null;
  const bodies: ApartmentObjectsProgress['bodies'] = {}, broken: ApartmentObjectsProgress['broken'] = {}, deposits: DepositState[] = [];
  for (const [id,p] of Object.entries(v.bodies)) {
    if (!idValid(id) || !record(p) || !vector(p.position) || !record(p.rotation) || typeof p.sleeping !== 'boolean') return null;
    const r=p.rotation; if (!['x','y','z','w'].every(k=>finite(r[k])) || Math.abs(Math.hypot(r.x as number,r.y as number,r.z as number,r.w as number)-1)>.1) return null;
    if (p.visualMatrix !== undefined && (!Array.isArray(p.visualMatrix) || p.visualMatrix.length !== 16 || !p.visualMatrix.every(finite))) return null;
    bodies[id]={position:{...p.position},rotation:{x:r.x as number,y:r.y as number,z:r.z as number,w:r.w as number},sleeping:p.sleeping,...(p.visualMatrix?{visualMatrix:[...p.visualMatrix as number[]]}:{})};
  }
  for (const [id,b] of Object.entries(v.broken)) {
    if (!idValid(id)||!record(b)||!['whisky','pot','glass','ceramic'].includes(b.kind as string)||!vector(b.position)||b.residuePending!==undefined&&typeof b.residuePending!=='boolean')return null;
    broken[id]={kind:b.kind as BrokenPropKind,position:{...b.position},...(b.residuePending?{residuePending:true}:{})};
  }
  for (const d of v.deposits) {
    if (!record(d)||!['whisky','soil'].includes(d.kind as string)||!vector(d.position)||!vector(d.normal)||!finite(d.radius)||d.radius<.005||d.radius>.6) return null;
    const n=d.normal;if(Math.hypot(n.x,n.y,n.z)<.9||Math.hypot(n.x,n.y,n.z)>1.1)return null;
    deposits.push({kind:d.kind as 'whisky'|'soil',position:{...d.position},normal:{...n},radius:d.radius});
  }
  return {version:1,bodies,broken,deposits};
}
export function sanitizeApartmentFixtures(v: unknown): ApartmentFixturesProgress | null {
  if (!record(v)||v.version!==1||!['tapOn','fanOn','deskLampOn'].every(k=>typeof v[k]==='boolean')
    ||!['waterLevel','closetDoor'].every(k=>finite(v[k])&&(v[k] as number)>=0&&(v[k] as number)<=1))return null;
  return {version:1,tapOn:v.tapOn as boolean,waterLevel:v.waterLevel as number,fanOn:v.fanOn as boolean,deskLampOn:v.deskLampOn as boolean,closetDoor:v.closetDoor as number};
}
