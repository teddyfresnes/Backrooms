/// <reference lib="webworker" />

import { bakeLightMapData } from './BakedLighting';
import type { BakedLightMapData } from './BakedLighting';
import type { WorldPlan } from '../world/types';

interface BakeRequest {
  id: number;
  plan: WorldPlan;
}

interface BakeResponse {
  id: number;
  lightMaps?: BakedLightMapData;
  error?: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<BakeRequest>) => {
  const { id, plan } = event.data;
  try {
    const lightMaps = bakeLightMapData(plan);
    const response: BakeResponse = { id, lightMaps };
    scope.postMessage(response, [
      lightMaps.general.buffer as ArrayBuffer,
      lightMaps.ceiling.buffer as ArrayBuffer,
    ]);
  } catch (error) {
    const response: BakeResponse = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
});

