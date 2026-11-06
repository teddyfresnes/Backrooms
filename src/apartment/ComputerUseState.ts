import type { Vec3Data } from '../world/types';
export const COMPUTER_PHASES=['standing','approach','pull-chair','align','sitting','settling','camera-in','using','exit-chair','rising','step-away','return-chair','handoff','blocked'] as const;
export type ComputerUsePhase=typeof COMPUTER_PHASES[number];
export interface ComputerUseProgress {version:1;phase:ComputerUsePhase;safePosition:Vec3Data;chairOffset:number}
export function sanitizeComputerUse(v:unknown):ComputerUseProgress|null {
  if(!v||typeof v!=='object'||Array.isArray(v))return null;const p=v as ComputerUseProgress;
  if(p.version!==1||!COMPUTER_PHASES.includes(p.phase)||!p.safePosition||!['x','y','z'].every(k=>Number.isFinite(p.safePosition[k as keyof Vec3Data])&&Math.abs(p.safePosition[k as keyof Vec3Data])<2000)||!Number.isFinite(p.chairOffset)||p.chairOffset<0||p.chairOffset>.351)return null;
  return{version:1,phase:p.phase,safePosition:{...p.safePosition},chairOffset:p.chairOffset};
}
