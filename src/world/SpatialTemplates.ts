import { generateBspArchitecture } from './generateWorld';
import type { WorldPlan } from './types';

const templates = new Map<string, WorldPlan>();
export const clearSpatialTemplates = () => templates.clear();
export const spatialTemplate = (seed: string, chunkX: number, chunkZ: number, story: number): WorldPlan => {
  const key = `${seed}:bsp-district:v1:${Math.floor(chunkX / 2)}:${Math.floor(chunkZ / 2)}:${story}`;
  let plan = templates.get(key);
  if (!plan) { plan = generateBspArchitecture(key); templates.set(key, plan); if (templates.size > 32) templates.delete(templates.keys().next().value!); }
  return plan;
};
