/// <reference lib="webworker" />
import { fetchApartmentDocument, prepareApartmentTransfers } from './ApartmentData';

const scope = self as DedicatedWorkerGlobalScope;
let prepared: Awaited<ReturnType<typeof fetchApartmentDocument>> | undefined;
let buffers: ArrayBuffer[] = [];
let requested = false;
const deliver = (): void => {
  if (!requested || !prepared) return;
  scope.postMessage({ data: prepared }, buffers);
  prepared = undefined; buffers = [];
};
scope.addEventListener('message', async (event: MessageEvent<{ type?: 'prepare' | 'take'; url?: string; hold?: boolean }>) => {
  if (event.data.type === 'take') { requested = true; deliver(); return; }
  try {
    if (!event.data.url) throw new Error('Adresse d’appartement absente.');
    requested ||= !event.data.hold;
    prepared = await fetchApartmentDocument(event.data.url);
    buffers = prepareApartmentTransfers(prepared);
    if (requested) deliver(); else scope.postMessage({ ready: true });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'Appartement indisponible' });
  }
});
