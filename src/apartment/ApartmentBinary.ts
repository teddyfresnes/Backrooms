import type { ApartmentDocument } from './ApartmentData';

const TYPES = { Float32Array, Float64Array, Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray, Int32Array, Int16Array, Int8Array };
const MAGIC = 0x31425041; // APB1, little endian
const align = (n: number) => Math.ceil(n / 8) * 8;

/** Build-time encoding. Numeric geometry is stored at the exact typed precision
 * used by BufferGeometryLoader; all other scene JSON remains unchanged. */
export function encodeApartmentBinary(document: ApartmentDocument): Uint8Array<ArrayBuffer> {
  const arrays: ArrayBufferView[] = [];
  let length = 0;
  const json = JSON.stringify(document, (_key, value: unknown) => {
    if (!ArrayBuffer.isView(value)) return value;
    const view = value as Exclude<ArrayBufferView, DataView> & { length: number };
    const offset = length; arrays.push(view); length = align(length + view.byteLength);
    return { __apartmentArray: view.constructor.name, offset, length: view.length };
  });
  const metadata = new TextEncoder().encode(json), start = align(8 + metadata.length);
  const result = new Uint8Array(start + length), header = new DataView(result.buffer);
  header.setUint32(0, MAGIC, true); header.setUint32(4, metadata.length, true);
  result.set(metadata, 8);
  let offset = start;
  for (const array of arrays) { result.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset); offset += align(array.byteLength); }
  return result;
}

/** Small JSON metadata + zero-copy typed views. No multi-million-number parse,
 * per-attribute copies, or bounds scan on the runtime's loading path. */
export function decodeApartmentBinary(buffer: ArrayBuffer): ApartmentDocument {
  if (buffer.byteLength < 8) throw new Error('Appartement binaire incomplet.');
  const header = new DataView(buffer), jsonLength = header.getUint32(4, true), start = align(8 + jsonLength);
  if (header.getUint32(0, true) !== MAGIC || start > buffer.byteLength) throw new Error('Appartement binaire invalide.');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, jsonLength)), (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || !('__apartmentArray' in value)) return value;
    const item = value as { __apartmentArray: keyof typeof TYPES; offset: number; length: number };
    if (!Object.hasOwn(TYPES, item.__apartmentArray)) throw new Error('Type de géométrie inconnu.');
    const Constructor = TYPES[item.__apartmentArray];
    if (!Number.isSafeInteger(item.offset) || item.offset < 0 || item.offset % 8 !== 0
      || !Number.isSafeInteger(item.length) || item.length < 0
      || start + item.offset + item.length * Constructor.BYTES_PER_ELEMENT > buffer.byteLength) throw new Error('Géométrie binaire incomplète.');
    return new Constructor(buffer, start + item.offset, item.length);
  }) as ApartmentDocument;
}
