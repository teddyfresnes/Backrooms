import type { ApartmentDocument } from './ApartmentData';

type ImageRecord = { url?: unknown };

/** Blob structured cloning shares immutable image bytes instead of copying
 * tens of MB of base64 strings from the apartment worker to the UI thread. */
export async function prepareApartmentImages(document: ApartmentDocument): Promise<void> {
  const images = document.images as ImageRecord[] | undefined;
  const decoded = new Map<string, Blob>();
  for (const image of images ?? []) {
    if (typeof image.url !== 'string' || !image.url.startsWith('data:image/')) continue;
    const source = image.url;
    let blob = decoded.get(source);
    if (!blob) {
      blob = await (await fetch(source)).blob();
      decoded.set(source, blob);
    }
    image.url = blob;
  }
}

/** ObjectLoader accepts URLs; release them after all images have loaded. */
export function apartmentImageUrls(document: ApartmentDocument): () => void {
  const urls: string[] = [];
  for (const image of (document.images as ImageRecord[] | undefined) ?? []) {
    if (!(image.url instanceof Blob)) continue;
    const url = URL.createObjectURL(image.url);
    urls.push(url); image.url = url;
  }
  return () => urls.forEach(url => URL.revokeObjectURL(url));
}
