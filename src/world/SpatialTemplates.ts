import { generateBspArchitecture, type BspGrain } from './generateWorld';
import type { WorldPlan } from './types';

const templates = new Map<string, WorldPlan>();
export const clearSpatialTemplates = () => templates.clear();
/** One canonical BSP per 224 m domain, story and district grain. Districts of
 * different grains never share a room: a facade always separates them. */
export const spatialTemplate = (seed: string, chunkX: number, chunkZ: number, story: number, grain: BspGrain = 'cells'): WorldPlan => {
  const domain = `${seed}:bsp-district:v1:${Math.floor(chunkX / 2)}:${Math.floor(chunkZ / 2)}:${story}`, key = `${domain}|${grain}`;
  let plan = templates.get(key);
  if (!plan) { plan = generateBspArchitecture(domain, grain); templates.set(key, plan); if (templates.size > 64) templates.delete(templates.keys().next().value!); }
  return plan;
};
