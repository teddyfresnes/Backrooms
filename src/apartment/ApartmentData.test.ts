import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { fetchApartmentDocument, prepareApartmentTransfers, type ApartmentDocument } from './ApartmentData';
import { parseApartmentScene, loadApartmentDocument } from './LoadApartmentScene';

afterEach(()=>vi.unstubAllGlobals());
const sample=(): ApartmentDocument => new THREE.Mesh(new THREE.BufferGeometry().copy(new THREE.BoxGeometry(2,3,4)),new THREE.MeshBasicMaterial({color:0x123456})).toJSON() as unknown as ApartmentDocument;

describe('apartment preparation outside the cinematic thread', () => {
  it('transfers typed arrays without altering geometry, UVs, groups, material or hierarchy', async () => {
    const original=sample(), prepared=structuredClone(original);
    const buffers=prepareApartmentTransfers(prepared);
    expect(buffers.length).toBeGreaterThan(3);
    const data=structuredClone(prepared,{transfer:buffers});
    expect(buffers.every(buffer=>buffer.byteLength===0)).toBe(true);
    const before=await new THREE.ObjectLoader().parseAsync(original) as THREE.Mesh;
    const pause=vi.fn(async()=>undefined);
    const after=await parseApartmentScene(data,'/assets/imported-apartment/',undefined,pause) as THREE.Mesh;
    const transferred = (data.geometries![0]!.data as { attributes: { position: { array: Float32Array } } }).attributes.position.array;
    expect(after.geometry.getAttribute('position').array).toBe(transferred);
    expect(after.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual([2,3,4]);
    for(const key of ['position','normal','uv'])expect([...after.geometry.getAttribute(key).array]).toEqual([...before.geometry.getAttribute(key).array]);
    expect([...after.geometry.index!.array]).toEqual([...before.geometry.index!.array]);
    expect(after.geometry.groups).toEqual(before.geometry.groups);
    expect(after.uuid).toBe(before.uuid); expect((after.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x123456);
    expect(pause).toHaveBeenCalled(); before.geometry.dispose();after.geometry.dispose();
  });

  it('supports the raw source and a gzip stream split across part boundaries', async () => {
    const model=sample();
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(model)));
    await expect(fetchApartmentDocument('https://game.test/apartment.json')).resolves.toEqual(model);
    const compressor=new CompressionStream('gzip'), writer=compressor.writable.getWriter();
    const done=writer.write(new TextEncoder().encode(JSON.stringify(model))).then(()=>writer.close());
    const zipped=new Uint8Array(await new Response(compressor.readable).arrayBuffer());await done;
    const half=Math.floor(zipped.length/2);
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('.json')
      ?Response.json({version:1,compression:'gzip',parts:[{file:'apartment-000.bin'},{file:'apartment-001.bin'}]})
      :new Response(url.endsWith('000.bin')?zipped.slice(0,half):zipped.slice(half))));
    await expect(fetchApartmentDocument('https://game.test/apartment.parts.json')).resolves.toEqual(model);
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({version:1,compression:'gzip',parts:[{file:'../private'}]})));
    await expect(fetchApartmentDocument('/apartment.parts.json')).rejects.toThrow('incomplet');
  });

  it('terminates cancelled workers, rejects stale results and frees geometry on cancelled mounting', async () => {
    class WorkerMock {
      static latest:WorkerMock; onmessage?: (event: MessageEvent)=>void;
      onerror?:()=>void; onmessageerror?:()=>void;
      terminate=vi.fn();postMessage=vi.fn();
      constructor(){WorkerMock.latest=this;}
    }
    vi.stubGlobal('Worker',WorkerMock);vi.stubGlobal('window',{location:{href:'https://game.test/'}});
    const abort=new AbortController(), result=loadApartmentDocument('/apartment.json',abort.signal);
    abort.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});
    expect(WorkerMock.latest.terminate).toHaveBeenCalled();
    WorkerMock.latest.onmessage?.({data:{data:sample()}} as MessageEvent);
    const mounting=new AbortController();
    await expect(parseApartmentScene(sample(),'',mounting.signal,async()=>mounting.abort())).rejects.toMatchObject({name:'AbortError'});
  });
});
