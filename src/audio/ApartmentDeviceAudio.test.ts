import {reachPowerCut,gasTarget,gasOrigin} from '../../tests/support/gas-journey';
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApartmentDeviceAudio, RADIO_PLAYLIST, PRESSURE_URL } from './ApartmentDeviceAudio';
import { ApartmentQuest, RENT_MAIL_ID } from '../story/ApartmentQuest';

class StreamMock extends EventTarget {
  static instances: StreamMock[] = [];
  paused = true; preload = ''; crossOrigin = ''; loop = false; src = '';
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; }); load = vi.fn();
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  constructor() { super(); StreamMock.instances.push(this); }
}
function audioFixture() {
  const node = () => ({ connect: vi.fn((destination: unknown) => destination), disconnect: vi.fn() });
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const panners: { setPosition: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    state: 'running', currentTime: 0, sampleRate: 8000,
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createPanner: vi.fn(() => { const panner = { ...node(), setPosition: vi.fn() }; panners.push(panner); return panner; }),
    createBiquadFilter: vi.fn(() => ({ ...node(), frequency: param(), Q: param() })),
    createBuffer: vi.fn((_channels: number, size: number) => ({ getChannelData: () => new Float32Array(size) })),
    createBufferSource: vi.fn(() => ({ ...node(), start: vi.fn(), stop: vi.fn() })),
    createOscillator: vi.fn(() => ({ ...node(), start: vi.fn(), stop: vi.fn(), frequency: param() })),
    createMediaElementSource: vi.fn(() => node()), decodeAudioData: vi.fn(),
  };
  const destination = node(), positions = { tv: { x: -9, y: 9.8, z: 0 }, radio: { x: -5, y: 9.7, z: -6 }, pc: { x: -7, y: 9.7, z: -5 }, gas: { x: -6, y: 9.6, z: 0 } };
  const quest = new ApartmentQuest(), next = vi.fn(() => quest.setRadioTrack(quest.devices.radioTrack + 1));
  const audio = new ApartmentDeviceAudio({ context: context as unknown as AudioContext, destination: destination as unknown as AudioNode }, positions, next);
  return { audio, quest, next, context, destination, positions, panners };
}
let audio: ApartmentDeviceAudio | undefined;
beforeEach(() => { StreamMock.instances = []; vi.stubGlobal('Audio', StreamMock); });
afterEach(() => { audio?.dispose(); audio = undefined; vi.unstubAllGlobals(); });
function outage(quest: ApartmentQuest) {
  quest.reachHome(); quest.setLight(true); quest.setGas(true); quest.setTelevision(true); quest.setRadio(true);
  quest.readMail(RENT_MAIL_ID); quest.finishGame('lost'); quest.nextThought(); reachPowerCut(quest);
}
it('creates no song request or song decoder at startup; streams only the current radio track through the master bus', async () => {
  const fixture = audioFixture(); ({ audio } = fixture); const { quest, context, destination, panners, positions, next } = fixture;
  const [radio, pressure] = StreamMock.instances;
  expect(radio!.src).toBe(''); expect(pressure!.src).toBe(''); expect(context.createMediaElementSource).not.toHaveBeenCalled();
  expect(context.decodeAudioData).not.toHaveBeenCalled(); expect(radio!.preload).toBe('none');
  quest.setRadio(true); audio.sync(quest.devices, true); await Promise.resolve();
  expect(radio!.src).toBe(RADIO_PLAYLIST[0]); expect(pressure!.src).toBe(''); expect(radio!.paused).toBe(false);
  expect(context.createMediaElementSource).toHaveBeenCalledOnce();
  audio.moveRadio({ x: -3, y: 10, z: -2 });
  expect(panners.at(-1)!.setPosition).toHaveBeenLastCalledWith(-3, 10, -2);
  expect(panners.some(p => p.setPosition.mock.calls.some(args => args.join() === Object.values(positions.radio).join()))).toBe(true);
  expect(panners.every(p => (p as unknown as { connect: ReturnType<typeof vi.fn> }).connect.mock.calls.some(([target]) => target === destination))).toBe(true);
  radio!.dispatchEvent(new Event('ended')); expect(next).toHaveBeenCalledOnce(); expect(radio!.src).toBe(RADIO_PLAYLIST[1]);
  expect(context.decodeAudioData).not.toHaveBeenCalled();
});
it('stops the playlist at the surge, starts Pressure afterward at the TV, and pauses it inside the TV-off event', async () => {
  const fixture = audioFixture(); ({ audio } = fixture); const { quest, context, positions, panners, next } = fixture;
  quest.setRadio(true); audio.sync(quest.devices, true); await Promise.resolve();
  outage(quest); audio.powerCut(); audio.sync(quest.devices, true);
  const [radio, pressure] = StreamMock.instances; expect(radio!.paused).toBe(true); expect(pressure!.src).toBe('');
  for (let i = 0; i < 14; i++) audio.sync(quest.devices, true, .05);
  expect(pressure!.src).toBe(PRESSURE_URL); expect(pressure!.paused).toBe(false);
  expect(panners.some(p => p.setPosition.mock.calls.some(args => args.join() === Object.values(positions.tv).join()))).toBe(true);
  expect(context.createOscillator).toHaveBeenCalledOnce();
  quest.setTelevision(false); audio.sync(quest.devices, true); expect(pressure!.paused).toBe(true);
  const starts = radio!.play.mock.calls.length; audio.radioStatic(); audio.sync(quest.devices, true);
  radio!.dispatchEvent(new Event('ended')); expect(next).not.toHaveBeenCalled(); expect(radio!.play).toHaveBeenCalledTimes(starts);
});
it('pauses streamed time with gameplay and restores a saved outage without replaying the electrical shock', async () => {
  const fixture = audioFixture(); ({ audio } = fixture); const { quest, context } = fixture;
  outage(quest); audio.sync(quest.devices, true); await Promise.resolve();
  const pressure = StreamMock.instances[1]!; expect(pressure.paused).toBe(false); expect(context.createOscillator).not.toHaveBeenCalled();
  audio.sync(quest.devices, false); expect(pressure.paused).toBe(true);
  audio.sync(quest.devices, true); await vi.waitFor(() => expect(pressure.paused).toBe(false));
  audio.dispose(); expect(pressure.paused).toBe(true); expect(pressure.src).toBe(''); expect(pressure.load).toHaveBeenCalled();
  audio = undefined;
});
it('reduces only the local cooking bus and keeps the reusable appliance loops bounded',()=>{
  const f=audioFixture();({audio}=f);f.quest.setGas(true);f.quest.setRadio(true);audio.sync(f.quest.devices,true);
  const gains=f.context.createGain.mock.results.map(r=>r.value.gain.value);expect(gains).toContain(.0075);expect(gains).toContain(.38);
  const position={x:-5,y:9.8,z:0};for(let i=0;i<100;i++){audio.fixture('water',position,i%2);audio.fixture('fan',position,i%2);}
  expect(f.context.createBufferSource).toHaveBeenCalledTimes(4);audio.fixture('water',position,0);audio.fixture('fan',position,0);
  expect(f.context.createGain.mock.results.at(-1)!.value.gain.value).toBe(0);
});
it('attenuates Pressure continuously by distance from the TV and stops immediately when switched off',async()=>{
  const {pressureDistanceGain}=await import('./ApartmentDeviceAudio');const f=audioFixture();({audio}=f);outage(f.quest);audio.sync(f.quest.devices,true);
  expect(pressureDistanceGain(14)).toBe(1);expect(pressureDistanceGain(20)).toBeGreaterThan(0);expect(pressureDistanceGain(32)).toBe(0);
  expect(Math.abs(pressureDistanceGain(18.001)-pressureDistanceGain(18))).toBeLessThan(.001);
  const p=f.positions.tv;audio.setListenerPosition({x:p.x+32,y:p.y,z:p.z});expect(f.context.createGain.mock.results.at(-1)!.value.gain.value).toBe(0);
  f.quest.setTelevision(false);audio.sync(f.quest.devices,true);expect(StreamMock.instances[1]!.paused).toBe(true);
});
it('ducks the existing music buses under speech without restarting or allocating streams',()=>{
  const f=audioFixture();({audio}=f);f.quest.setRadio(true);audio.sync(f.quest.devices,true);
  const radioGain=f.context.createGain.mock.results.at(-1)!.value.gain,streams=f.context.createMediaElementSource.mock.calls.length;
  audio.setNarrationActive(true);expect(radioGain.value).toBeCloseTo(.38*.28);audio.setNarrationActive(false);expect(radioGain.value).toBe(.38);
  outage(f.quest);audio.sync(f.quest.devices,true);const pressureGain=f.context.createGain.mock.results.at(-1)!.value.gain;
  audio.setNarrationActive(true);expect(pressureGain.value).toBeCloseTo(.43*.28);audio.setListenerPosition(f.positions.tv);expect(pressureGain.value).toBeCloseTo(.43*.28);
  const count=f.context.createMediaElementSource.mock.calls.length;audio.setNarrationActive(false);expect(pressureGain.value).toBe(.43);expect(f.context.createMediaElementSource).toHaveBeenCalledTimes(count);expect(count).toBe(streams+1);
});
