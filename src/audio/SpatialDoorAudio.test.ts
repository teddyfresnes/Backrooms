import { describe, expect, it, vi } from 'vitest';
import { doorAudioChain, setDoorAudioListener, type SpatialAudioBus } from './SpatialDoorAudio';
const position = { x: 2, y: 1.7, z: -4 }, forward = { x: .6, y: 0, z: -.8 };
const names = ['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'];
const modern = () => Object.fromEntries(names.map(name => [name, { value: 0 }]));
const bus = (listener: unknown) => ({ context: { listener } }) as SpatialAudioBus;

describe('spatial audio across listener and panner API versions', () => {
  it('updates modern parameters without invoking the deprecated methods', () => {
    const listener = { ...modern(), setPosition: vi.fn(), setOrientation: vi.fn() };
    setDoorAudioListener(bus(listener), position, forward);
    expect(names.map(name => listener[name as keyof typeof listener])).toEqual([2,1.7,-4,.6,0,-.8,0,1,0].map(value=>({value})));
    expect(listener.setPosition).not.toHaveBeenCalled(); expect(listener.setOrientation).not.toHaveBeenCalled();
  });
  it.each(names)('falls back when %s is absent, while preserving the other supported group', missing => {
    const listener = { ...modern(), setPosition: vi.fn(), setOrientation: vi.fn() };
    delete (listener as Record<string, unknown>)[missing];
    expect(() => setDoorAudioListener(bus(listener), position, forward)).not.toThrow();
    if (missing.startsWith('position')) expect(listener.setPosition).toHaveBeenCalledWith(2,1.7,-4);
    else expect(listener.setOrientation).toHaveBeenCalledWith(.6,0,-.8,0,1,0);
  });
  it('keeps 120 frame updates alive on a legacy Firefox listener', () => {
    const listener = { setPosition: vi.fn(), setOrientation: vi.fn() };
    let frames = 0;
    expect(() => { for (; frames < 120; frames++) setDoorAudioListener(bus(listener), position, forward); }).not.toThrow();
    expect(frames).toBe(120); expect(listener.setPosition).toHaveBeenCalledTimes(120);
    expect(listener.setOrientation).toHaveBeenLastCalledWith(.6,0,-.8,0,1,0);
  });
  it('tolerates an absent bus and implementations with no spatial setters', () => {
    for (const listener of [{}, undefined, { positionX: { value: 0 } }]) expect(()=>setDoorAudioListener(bus(listener),position,forward)).not.toThrow();
    expect(()=>setDoorAudioListener(undefined,position,forward)).not.toThrow();
  });
  it.each(['modern','legacy','none'])('retains an audible connected panner chain with %s position support', mode => {
    const node = () => ({ connect: vi.fn((destination: unknown) => destination), disconnect: vi.fn() });
    const gain = { ...node(), gain: {value:0} }, filter = { ...node(), frequency:{value:0}, Q:{value:0} };
    const panner = { ...node(), ...(mode === 'modern' ? modern() : {}), ...(mode === 'legacy' ? { setPosition: vi.fn() } : {}) };
    const destination = {};
    const context = { createGain:()=>gain, createPanner:()=>panner, createBiquadFilter:()=>filter };
    const chain = doorAudioChain({context,destination} as unknown as SpatialAudioBus, position, .4, true);
    expect(chain.input).toBe(filter); expect(filter.connect).toHaveBeenCalled(); expect(panner.connect).toHaveBeenCalledWith(destination);
    if ('setPosition' in panner) expect(panner.setPosition).toHaveBeenCalledWith(2,1.7,-4);
    chain.dispose(); expect(panner.disconnect).toHaveBeenCalledOnce();
  });
});
