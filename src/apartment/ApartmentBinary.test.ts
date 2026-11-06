import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { encodeApartmentBinary, decodeApartmentBinary } from './ApartmentBinary';
import { prepareApartmentTransfers, type ApartmentDocument } from './ApartmentData';
import { parseApartmentScene } from './LoadApartmentScene';

describe('compact apartment runtime', () => {
  it('preserves actual scene identity, materials, topology, UVs, normals and typed precision', async () => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry().copy(new THREE.BoxGeometry(2,3,4)),new THREE.MeshStandardMaterial({color:0x294923}));
    mesh.name='ImportedApartment'; mesh.position.set(1,.125,-6); mesh.updateMatrix();
    const original = mesh.toJSON() as unknown as ApartmentDocument;
    const prepared = structuredClone(original); prepareApartmentTransfers(prepared);
    const bytes = encodeApartmentBinary(prepared), decoded = decodeApartmentBinary(bytes.buffer);
    expect(decoded).toEqual(prepared);
    const buffers = prepareApartmentTransfers(decoded);
    expect(buffers).toHaveLength(1); // All views share one immutable pack allocation.
    const transported = structuredClone(decoded,{transfer:buffers}); expect(bytes.byteLength).toBe(0);
    const after = await parseApartmentScene(transported,'',undefined,async()=>{}) as THREE.Mesh;
    expect(after.uuid).toBe(mesh.uuid); expect(after.position.toArray()).toEqual([1,.125,-6]);
    for (const key of ['position','normal','uv']) expect(after.geometry.getAttribute(key).array).toEqual(mesh.geometry.getAttribute(key).array);
    expect(after.geometry.index!.array).toEqual(mesh.geometry.index!.array); expect(after.geometry.groups).toEqual(mesh.geometry.groups);
    expect((after.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x294923);
    mesh.geometry.dispose(); after.geometry.dispose();
  });
  it('rejects truncated headers and out-of-bounds typed arrays', () => {
    expect(()=>decodeApartmentBinary(new ArrayBuffer(4))).toThrow();
    const data = {geometries:[{array:new Float32Array([1,2,3])}]};
    const packed = encodeApartmentBinary(data);
    expect(()=>decodeApartmentBinary(packed.buffer.slice(0,12))).toThrow();
    expect(()=>decodeApartmentBinary(packed.buffer.slice(0,-10))).toThrow();
  });
});
