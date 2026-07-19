/// <reference lib="webworker" />

import { generateInfiniteChunk } from './InfiniteWorld';
import type { ChunkKey } from './InfiniteWorld';

interface GenerateRequest {
  id: number;
  seed: string;
  key: ChunkKey;
}

interface GenerateResponse {
  id: number;
  key: ChunkKey;
  plan?: ReturnType<typeof generateInfiniteChunk>;
  error?: string;
}

const scope = self as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<GenerateRequest>) => {
  const { id, seed, key } = event.data;
  try {
    const response: GenerateResponse = { id, key, plan: generateInfiniteChunk(seed, key) };
    scope.postMessage(response);
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
