import { afterEach, expect, it, vi } from 'vitest';
import { apartmentImageUrls, prepareApartmentImages } from './ApartmentImages';

afterEach(() => vi.restoreAllMocks());

it('passes exact image bytes through a worker clone and releases loader URLs', async () => {
  const source = 'data:image/png;base64,AAECA//+', document = { images: [{ url: source }, { url: source }, { url: 'external.png' }] };
  await prepareApartmentImages(document);
  const transported = structuredClone(document);
  expect(transported.images[0]!.url).toBeInstanceOf(Blob);
  const blob = transported.images[0]!.url as unknown as Blob;
  expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 1, 2, 3, 255, 254]);
  expect(blob.type).toBe('image/png');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const release = apartmentImageUrls(transported);
  expect(transported.images[0]!.url).toMatch(/^blob:/);
  expect(transported.images[2]!.url).toBe('external.png');
  release(); expect(revoke).toHaveBeenCalledTimes(2);
});
