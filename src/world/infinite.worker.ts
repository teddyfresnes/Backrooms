/// <reference lib="webworker" />

import { generateInfiniteChunk } from './InfiniteWorld';
import type { ChunkKey } from './InfiniteWorld';
import type { BakedLightMapData } from '../render/BakedLighting';
import type { LightingMode } from '../render/LightingMode';

interface GenerateRequest {
  id: number;
  seed: string;
  key: ChunkKey;
  lightingMode?: LightingMode;
}

interface GenerateResponse {
  id: number;
  key: ChunkKey;
  plan?: ReturnType<typeof generateInfiniteChunk>;
  lightMaps?: BakedLightMapData;
  error?: string;
}

const scope = self as DedicatedWorkerGlobalScope;

scope.addEventListener('message', async (event: MessageEvent<GenerateRequest>) => {
  const { id, seed, key } = event.data;
  try {
    const plan = generateInfiniteChunk(seed, key);
    const lightMaps = event.data.lightingMode === 'legacy'
      ? (await import('../render/BakedLighting')).bakeLightMapData(plan)
      : undefined;
    const response: GenerateResponse = { id, key, plan, lightMaps };
    if (lightMaps) {
      scope.postMessage(response, [
        lightMaps.general.buffer as ArrayBuffer,
        lightMaps.ceiling.buffer as ArrayBuffer,
      ]);
    } else {
      scope.postMessage(response);
    }
  } catch (error) {
    const response: GenerateResponse = {
      id,
      key,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
});

export {};
