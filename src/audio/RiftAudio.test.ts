import { expect, it, vi } from 'vitest';
import { RiftAudio } from './RiftAudio';

it('restores the old double-beat envelope without restarting or stacking at the exhaustion threshold', () => {
  const gains: ReturnType<typeof vi.fn>[] = [];
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = () => ({ connect: vi.fn(() => ({ connect: vi.fn() })), disconnect: vi.fn(), addEventListener: vi.fn() });
  const context = {
    currentTime: 0,
    createOscillator: vi.fn(() => ({ ...node(), frequency: param(), start: vi.fn(), stop: vi.fn() })),
    createGain: () => { const gain = param(); gains.push(gain.exponentialRampToValueAtTime); return { ...node(), gain }; },
  };
  const audio = new RiftAudio(() => ({ context, destination: {} }) as never);
  audio.heartbeat(.016, .2); expect(context.createOscillator).not.toHaveBeenCalled();
  audio.heartbeat(.016, 1); expect(context.createOscillator).toHaveBeenCalledTimes(2);
  expect(gains.map(gain=>Math.max(...gain.mock.calls.map(call=>call[0])))).toEqual([.087,.054]);
  for (let i=0;i<20;i++) audio.heartbeat(1/60,i%2?1:.2);
  expect(context.createOscillator).toHaveBeenCalledTimes(2);
  audio.heartbeat(.2,1); expect(context.createOscillator).toHaveBeenCalledTimes(4);
  audio.dispose();audio.heartbeat(1,1);expect(context.createOscillator).toHaveBeenCalledTimes(4);
});
