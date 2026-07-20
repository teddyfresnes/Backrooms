/// <reference lib="webworker" />

import { generateInfiniteChunk } from './InfiniteWorld';
import type { ChunkKey } from './InfiniteWorld';
import { bakeLightMapData } from '../render/BakedLighting';
import type { BakedLightMapData } from '../render/BakedLighting';

interface GenerateRequest {
  id: number;
  seed: string;
  key: ChunkKey;
}

interface GenerateResponse {
  id: number;
  key: ChunkKey;
  plan?: ReturnType<typeof generateInfiniteChunk>;
  lightMaps?: BakedLightMapData;
  error?: string;
}

const scope = self as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<GenerateRequest>) => {
  const { id, seed, key } = event.data;
  try {
    const plan = generateInfiniteChunk(seed, key);
    const lightMaps = bakeLightMapData(plan);
    const response: GenerateResponse = { id, key, plan, lightMaps };
    scope.postMessage(response, [
      lightMaps.general.buffer as ArrayBuffer,
      lightMaps.ceiling.buffer as ArrayBuffer,
    ]);
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
