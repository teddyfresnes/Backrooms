/// <reference lib="webworker" />

import { generateInfiniteChunk } from './InfiniteWorld';
import type { ChunkKey } from './InfiniteWorld';
import type { BakedLightMapData } from '../render/BakedLighting';
import type { RegionalLightData } from '../render/RegionalLighting';
import { architectureTransferables, prepareSpatialArchitecture, type SpatialArchitectureBuffers } from '../render/SpatialArchitectureBuffers';
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
  regionalLightData?: RegionalLightData;
  architectureData?: SpatialArchitectureBuffers;
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
    const regionalLightData = plan.spatial && event.data.lightingMode !== 'legacy'
      ? (await import('../render/RegionalLighting')).bakeRegionalLightData(plan) : undefined;
    const architectureData = plan.spatial ? prepareSpatialArchitecture(plan) : undefined;
    const response: GenerateResponse = { id, key, plan, lightMaps, regionalLightData, architectureData };
    const transfer = architectureData ? architectureTransferables(architectureData) : [];
    if (lightMaps) transfer.push(lightMaps.general.buffer as ArrayBuffer, lightMaps.ceiling.buffer as ArrayBuffer);
    if (regionalLightData) transfer.push(regionalLightData.bounds.buffer as ArrayBuffer, regionalLightData.lighting.buffer as ArrayBuffer);
    scope.postMessage(response, transfer);
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
