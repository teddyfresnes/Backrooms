import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ download: vi.fn(), transfer: vi.fn() }));
vi.mock('./ApartmentData', () => ({ downloadApartmentDocument: state.download, prepareApartmentTransfers: state.transfer }));
let message: (event: MessageEvent) => void;
let post: ReturnType<typeof vi.fn>;
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const send = (data: unknown) => message({ data } as MessageEvent);

beforeEach(async () => {
  vi.resetModules(); state.download.mockReset(); state.transfer.mockReset();
  post = vi.fn();
  vi.stubGlobal('self', { postMessage: post, addEventListener: (_type: string, handler: typeof message) => { message = handler; } });
  await import('./apartment.worker');
});
afterEach(() => vi.unstubAllGlobals());

it('downloads in the worker but performs no decompression or geometry conversion until take', async () => {
  const data = { object: { name: 'apartment' } }, buffers = [new ArrayBuffer(8)];
  const decode = vi.fn(async () => data);
  state.download.mockResolvedValue(decode); state.transfer.mockReturnValue(buffers);
  send({ type: 'prepare', url: '/apartment.parts.json', hold: true }); await settle();
  expect(state.download).toHaveBeenCalledExactlyOnceWith('/apartment.parts.json', expect.any(Function), undefined, expect.any(Function));
  expect(post).toHaveBeenCalledExactlyOnceWith({ ready: true });
  expect(decode).not.toHaveBeenCalled(); expect(state.transfer).not.toHaveBeenCalled();
  send({ type: 'take' }); send({ type: 'take' }); await settle();
  expect(decode).toHaveBeenCalledOnce(); expect(state.transfer).toHaveBeenCalledExactlyOnceWith(data);
  expect(post).toHaveBeenLastCalledWith({ data }, buffers);
});

it('handles Skip before downloading finishes and reports a decoding failure once', async () => {
  let downloaded!: (decode: () => Promise<unknown>) => void;
  state.download.mockReturnValue(new Promise(resolve => { downloaded = resolve; }));
  send({ type: 'prepare', url: '/apartment.parts.json', hold: true });
  send({ type: 'take' }); await settle(); expect(post).not.toHaveBeenCalled();
  const decode = vi.fn(async () => { throw new Error('Interrupted model'); });
  downloaded(decode); await settle();
  expect(decode).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledExactlyOnceWith({ error: 'Interrupted model' });
});
