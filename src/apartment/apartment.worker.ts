/// <reference lib="webworker" />
import { fetchApartmentDocument, prepareApartmentTransfers } from './ApartmentData';

const scope = self as DedicatedWorkerGlobalScope;
scope.addEventListener('message', async (event: MessageEvent<{ url: string }>) => {
  try {
    const data = await fetchApartmentDocument(event.data.url);
    scope.postMessage({ data }, prepareApartmentTransfers(data));
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'Appartement indisponible' });
  }
});
