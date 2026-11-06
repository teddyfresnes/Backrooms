/// <reference lib="webworker" />
import { downloadApartmentDocument, prepareApartmentTransfers } from './ApartmentData';
import { prepareApartmentImages } from './ApartmentImages';

const scope = self as DedicatedWorkerGlobalScope;
let decode: Awaited<ReturnType<typeof downloadApartmentDocument>> | undefined;
let requested = false;
let decoding = false;
const fail = (error: unknown): void => {
  decode = undefined;
  scope.postMessage({ error: error instanceof Error ? error.message : 'Appartement indisponible' });
};
const deliver = async (): Promise<void> => {
  if (!requested || !decode || decoding) return;
  decoding = true;
  try {
    const data = await decode();
    decode = undefined;
    await prepareApartmentImages(data);
    scope.postMessage({ data }, prepareApartmentTransfers(data));
  } catch (error) { fail(error); }
};
scope.addEventListener('message', (event: MessageEvent<{ type?: 'prepare' | 'take'; url?: string; hold?: boolean; packed?: Blob }>) => {
  if (event.data.type === 'take') { requested = true; void deliver(); return; }
  void (async () => {
    if (!event.data.url) throw new Error('Adresse d’appartement absente.');
    requested ||= !event.data.hold;
    decode = await downloadApartmentDocument(event.data.url, progress => scope.postMessage({ progress }), event.data.packed, packed => scope.postMessage({ downloaded: packed }));
    if (requested) await deliver(); else scope.postMessage({ ready: true });
  })().catch(fail);
});
