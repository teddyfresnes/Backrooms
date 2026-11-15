import { expect, it, vi } from 'vitest';
import { RiftAudio } from './RiftAudio';

it('keeps even a panic heartbeat quiet and spaces the double beats instead of stacking them every frame', () => {
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
  for (const gain of gains) expect(Math.max(...gain.mock.calls.map(call => call[0]))).toBeLessThanOrEqual(.016);
  for (let i=0;i<20;i++) audio.heartbeat(1/60,i%2?1:.2);
  expect(context.createOscillator).toHaveBeenCalledTimes(2);
  audio.heartbeat(.2,1); expect(context.createOscillator).toHaveBeenCalledTimes(4);
  audio.dispose();audio.heartbeat(1,1);expect(context.createOscillator).toHaveBeenCalledTimes(4);
});
