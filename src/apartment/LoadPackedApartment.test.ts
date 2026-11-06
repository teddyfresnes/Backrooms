import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeApartmentBinary } from './ApartmentBinary';
import { decodePackedApartment, downloadPackedApartment, loadPackedApartmentJson } from './LoadPackedApartment';

afterEach(() => vi.unstubAllGlobals());

describe('loading the hosted apartment', () => {
  it('retains only compressed bytes until decoding is explicitly permitted, with two downloads at most', async () => {
    const model = { object: { name: 'network-only preparation' } };
    const compressed = new Response(new Blob([JSON.stringify(model)]).stream().pipeThrough(new CompressionStream('gzip')));
    const bytes = new Uint8Array(await compressed.arrayBuffer());
    const NativeDecoder = DecompressionStream;
    const decoding = vi.fn(function (format: CompressionFormat) { return new NativeDecoder(format); });
    vi.stubGlobal('DecompressionStream', decoding);
    let concurrent = 0, maximum = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('.json')) return Response.json({ version: 1, compression: 'gzip', parts: [0, 1, 2, 3].map(i => ({ file: `apartment-00${i}.bin` })) });
      expect(options?.priority).toBe('low');
      concurrent++; maximum = Math.max(maximum, concurrent);
      await Promise.resolve(); concurrent--;
      const index = Number(url.match(/00(\d)\.bin$/)![1]);
      const cut = Math.ceil(bytes.length / 4);
      return new Response(bytes.slice(index * cut, (index + 1) * cut));
    }));
    const packed = await downloadPackedApartment('/assets/apartment.parts.json');
    expect(packed.size).toBe(bytes.length); expect(maximum).toBe(2);
    expect(decoding).not.toHaveBeenCalled();
    await expect(decodePackedApartment(packed)).resolves.toEqual(model);
    expect(decoding).toHaveBeenCalledOnce();
  });

  it('decodes the original JSON when a gzip stream crosses file boundaries', async () => {
    const model = { object: { name: 'apartment', children: [{ name: 'door', matrix: [1, 0, 0, 1] }] } };
    const compressor = new CompressionStream('gzip');
    const writer = compressor.writable.getWriter();
    const writing = writer.write(new TextEncoder().encode(JSON.stringify(model))).then(() => writer.close());
    const bytes = new Uint8Array(await new Response(compressor.readable).arrayBuffer());
    await writing;
    const cut = Math.floor(bytes.length / 2);
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('.json')) return Response.json({ version: 1, compression: 'gzip', parts: [
        { file: 'apartment-000.bin' }, { file: 'apartment-001.bin' },
      ] });
      if (url.endsWith('000.bin')) await firstPending;
      return new Response(new Uint8Array(url.endsWith('000.bin') ? bytes.subarray(0, cut) : bytes.subarray(cut)));
    });
    vi.stubGlobal('fetch', fetcher);
    const loading = loadPackedApartmentJson('/assets/apartment.parts.json');
    for (let tick = 0; tick < 30; tick++) await Promise.resolve();
    const ahead = fetcher.mock.calls.some(([url]) => url.endsWith('001.bin'));
    releaseFirst();
    expect(ahead, 'the next part downloads before the first one finishes').toBe(true);
    await expect(loading).resolves.toEqual(model);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/assets/apartment.parts.json', '/assets/apartment-000.bin', '/assets/apartment-001.bin',
    ]);
  });

  it('reports an interrupted download when a required part is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('.json')
      ? Response.json({ version: 1, compression: 'gzip', parts: [{ file: 'apartment-000.bin' }] })
      : new Response(null, { status: 404 })));
    await expect(loadPackedApartmentJson('/assets/apartment.parts.json')).rejects.toThrow('interrompu');
  });
});

it('reports received chunks against manifest bytes without time-driven progress', async () => {
  const original = new Blob([JSON.stringify({ object: { name: 'chunked' } })]);
  const packed = new Uint8Array(await new Response(original.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const events: { progress?: number; receivedBytes?: number; totalBytes?: number }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('.json')
    ? Response.json({version:1,compression:'gzip',parts:[{file:'apartment-000.bin',bytes:packed.length}]})
    : new Response(new ReadableStream({ start(controller) { controller.enqueue(packed.slice(0,7)); controller.enqueue(packed.slice(7)); controller.close(); } }))));
  await downloadPackedApartment('/apartment.parts.json',undefined,event=>events.push(event));
  expect(events[0]).toMatchObject({progress:0,receivedBytes:0,totalBytes:packed.length});
  expect(events.at(-1)).toMatchObject({progress:1,receivedBytes:packed.length,totalBytes:packed.length});
});

it('loads the version-two binary pack through the production streaming decoder', async () => {
  const document={geometries:[{data:{attributes:{position:{type:'Float32Array',itemSize:3,array:new Float32Array([.125,2,-3])}}}}],object:{name:'Preserved hierarchy'}};
  const bytes=encodeApartmentBinary(document);
  const zipped=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('.json')
    ?Response.json({version:2,encoding:'apartment-binary-v1',compression:'gzip',parts:[{file:'apartment-runtime-000.bin',bytes:zipped.length}]})
    :new Response(zipped)));
  const packed=await downloadPackedApartment('/apartment.runtime.parts.json');
  expect(packed.type).toBe('application/x-apartment-binary-gzip');
  await expect(decodePackedApartment(packed)).resolves.toEqual(document);
});

it('keys every runtime part to the manifest content hash so an old browser cache cannot mix apartment versions',async()=>{
 const hash='a'.repeat(64),file='apartment-runtime-000.bin';
 const fetcher=vi.fn(async(url:string)=>url.includes('.json')?Response.json({version:2,encoding:'apartment-binary-v1',compression:'gzip',runtimeSha256:hash,parts:[{file,bytes:3}]}):new Response(new Uint8Array([1,2,3])));
 vi.stubGlobal('fetch',fetcher);await downloadPackedApartment(`/apartment.runtime.parts.json?v=${hash}`);
 expect(fetcher.mock.calls.map(c=>c[0])).toEqual([`/apartment.runtime.parts.json?v=${hash}`,`/${file}?v=${hash}`]);
});
