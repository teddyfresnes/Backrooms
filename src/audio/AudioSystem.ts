import type { RoomKind } from '../world/types';
import { audioGainFromSetting } from './volume';

export type AudioSurface = 'backrooms-carpet' | 'apartment-wood' | 'stairwell-concrete';
export type LandingKind = 'light' | 'medium' | 'heavy' | 'traumatic';
export type AudioAmbience = 'backrooms' | 'interior';
export type DoorSound = 'open' | 'close' | 'blocked';

interface AudioClip {
  readonly offset: number;
  readonly duration: number;
}

const footstepUrls = (name: string): readonly string[] => Array.from(
  { length: 8 },
  (_, index) => `/assets/audio/footsteps/${name}-${index + 1}.mp3`,
);

const FOOTSTEP_URLS: Record<AudioSurface, readonly string[]> = {
  'backrooms-carpet': footstepUrls('backrooms-carpet'),
  'apartment-wood': footstepUrls('apartment-wood'),
  'stairwell-concrete': footstepUrls('stairwell-concrete'),
};

const SPRINT_URLS: Record<AudioSurface, string> = {
  'backrooms-carpet': '/assets/audio/footsteps/run-backrooms-carpet.mp3',
  'apartment-wood': '/assets/audio/footsteps/run-apartment-wood.mp3',
  'stairwell-concrete': '/assets/audio/footsteps/run-stairwell-concrete.mp3',
};

const SURFACE_GAIN: Record<AudioSurface, number> = {
  'backrooms-carpet': 0.96,
  'apartment-wood': 1,
  'stairwell-concrete': 0.98,
};

const WALK_CUTOFF: Record<AudioSurface, number> = {
  'backrooms-carpet': 5400,
  'apartment-wood': 6800,
  'stairwell-concrete': 6400,
};

const WALK_RATE: Record<AudioSurface, number> = {
  'backrooms-carpet': 0.94,
  'apartment-wood': 0.93,
  'stairwell-concrete': 0.92,
};

const SPRINT_LOOP_TRIM: Record<AudioSurface, { start: number; end: number }> = {
  'backrooms-carpet': { start: 0.015, end: 0.025 },
  'apartment-wood': { start: 0.025, end: 0.17 },
  'stairwell-concrete': { start: 0.055, end: 0.045 },
};

const STEP_RATE_VARIATION = [0.99, 1.015, 0.98, 1.008, 0.992, 1.02, 0.985, 1.005] as const;

// This non-linear order keeps neighbouring recordings apart without inventing
// an artificial left/right stereo alternation.
const STEP_ORDER = [0, 5, 2, 7, 3, 1, 6, 4] as const;

export const landingKindForSpeed = (impactSpeed: number): LandingKind => {
  if (impactSpeed < 4.5) return 'light';
  if (impactSpeed < 9) return 'medium';
  if (impactSpeed < 17) return 'heavy';
  return 'traumatic';
};

export const walkingFootstepGain = (strength: number): number => (
  strength <= 0.5 ? 0.032 : 0.105
);

export const sprintFootstepGain = 0.78;

export const interiorRainGainForDistance = (
  _surface: AudioSurface,
  distanceToWindow: number,
  exposure = 1,
): number => {
  const proximity = Math.min(1, Math.max(0, (5.5 - distanceToWindow) / 4.8));
  return 0.014 + proximity ** 1.35 * 0.48 * Math.min(1, Math.max(0, exposure));
};

export const rainExposureForBlindClosure = (closureProgress: number): number => {
  const closure = Math.min(1, Math.max(0, closureProgress));
  const smoothClosure = closure * closure * (3 - 2 * closure);
  return 1 + (0.045 - 1) * smoothClosure;
};

export const interiorRainRoomBleedGain = (exposure: number): number => (
  0.014 + 0.055 * Math.min(1, Math.max(0, exposure))
);

const createLoopSource = (
  context: AudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
  offset = 0,
): AudioBufferSourceNode => {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(destination);
  source.start(0, Math.min(offset, Math.max(0, buffer.duration - 0.01)));
  return source;
};

export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private humGain?: GainNode;
  private ventGain?: GainNode;
  private rainGain?: GainNode;
  private lowpass?: BiquadFilterNode;
  private readonly footsteps: Partial<Record<AudioSurface, readonly AudioBuffer[]>> = {};
  private readonly sprintBuffers: Partial<Record<AudioSurface, AudioBuffer>> = {};
  private readonly footstepCursor: Record<AudioSurface, number> = {
    'backrooms-carpet': 0,
    'apartment-wood': 3,
    'stairwell-concrete': 6,
  };
  private readonly transientOffsets = new WeakMap<AudioBuffer, number>();
  private bodyFall?: AudioBuffer;
  private boneCrack?: AudioBuffer;
  private doorOpen?: AudioBuffer;
  private doorClose?: AudioBuffer;
  private lockClose?: AudioBuffer;
  private lockOpen?: AudioBuffer;
  private blindsOpen?: AudioBuffer;
  private blindsClose?: AudioBuffer;
  private lightSwitchOn?: AudioBuffer;
  private lightSwitchOff?: AudioBuffer;
  private readonly loopSources: AudioScheduledSourceNode[] = [];
  private sprintSource?: AudioBufferSourceNode;
  private sprintGain?: GainNode;
  private sprintSurface?: AudioSurface;
  private started = false;
  private disposed = false;
  private masterVolume = 0.6;
  private loadedAssetCount = 0;
  private loadProgress?: (progress: number) => void;

  constructor(private readonly ambience: AudioAmbience = 'backrooms') {}

  async start(onProgress?: (progress: number) => void): Promise<void> {
    if (this.disposed) return;
    if (this.started) {
      onProgress?.(1);
      try {
        await this.context?.resume();
      } catch {
        // The context may have closed while a session was being replaced.
      }
      return;
    }
    this.started = true;
    this.loadedAssetCount = 0;
    this.loadProgress = onProgress;
    this.loadProgress?.(0);
    this.context = new AudioContext({ latencyHint: 'interactive' });
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = audioGainFromSetting(this.masterVolume);
    this.master.connect(context.destination);

    if (this.ambience === 'backrooms') {
      this.lowpass = context.createBiquadFilter();
      this.lowpass.type = 'lowpass';
      this.lowpass.frequency.value = 6200;
      this.lowpass.Q.value = 0.25;
      this.lowpass.connect(this.master);
      this.humGain = context.createGain();
      this.ventGain = context.createGain();
      this.humGain.gain.value = 0.17;
      this.ventGain.gain.value = 0.12;
      this.humGain.connect(this.lowpass);
      this.ventGain.connect(this.lowpass);
    } else {
      this.rainGain = context.createGain();
      this.rainGain.gain.value = 0.018;
      this.rainGain.connect(this.master);
    }

    const commonPromise = Promise.all([
      this.loadBuffers(FOOTSTEP_URLS['backrooms-carpet']),
      this.loadBuffers(FOOTSTEP_URLS['apartment-wood']),
      this.loadBuffers(FOOTSTEP_URLS['stairwell-concrete']),
      this.loadBuffer(SPRINT_URLS['backrooms-carpet']),
      this.loadBuffer(SPRINT_URLS['apartment-wood']),
      this.loadBuffer(SPRINT_URLS['stairwell-concrete']),
      this.loadBuffer('/assets/audio/impacts/body-fall-normalized.mp3'),
      this.loadBuffer('/assets/audio/impacts/bone-crack-normalized.mp3'),
    ]);
    const ambiencePromise = this.ambience === 'backrooms'
      ? Promise.all([
        this.loadBuffer('/assets/audio/fluorescent-hum-cc0.mp3'),
        this.loadBuffer('/assets/audio/ventilation-cc0.mp3'),
      ])
      : Promise.all([
        this.loadBuffer('/assets/audio/apartment/rain-window.mp3'),
        this.loadBuffer('/assets/audio/interactions/door-open.mp3'),
        this.loadBuffer('/assets/audio/interactions/door-close.mp3'),
        this.loadBuffer('/assets/audio/interactions/lock.mp3'),
        this.loadBuffer('/assets/audio/interactions/unlock.mp3'),
        this.loadBuffer('/assets/audio/interactions/blinds-open.mp3'),
        this.loadBuffer('/assets/audio/interactions/blinds-close.mp3'),
        this.loadBuffer('/assets/audio/interactions/light-switch-on.mp3'),
        this.loadBuffer('/assets/audio/interactions/light-switch-off.mp3'),
      ]);
    // Install the ambience as soon as it is decoded. In particular, apartment
    // rain must not wait for every footstep and impact asset to finish loading.
    const ambienceBuffers = await ambiencePromise;
    if (this.disposed || this.context !== context) return;
    if (this.ambience === 'backrooms') {
      const [humBuffer, ventilationBuffer] = ambienceBuffers;
      if (humBuffer && this.humGain) {
        this.loopSources.push(createLoopSource(context, humBuffer, this.humGain, 3.7));
      }
      if (ventilationBuffer && this.ventGain) {
        this.loopSources.push(createLoopSource(context, ventilationBuffer, this.ventGain, 8.1));
      }
    } else {
      const [
        rain,
        doorOpen,
        doorClose,
        lockClose,
        lockOpen,
        blindsOpen,
        blindsClose,
        lightSwitchOn,
        lightSwitchOff,
      ] = ambienceBuffers;
      if (rain && this.rainGain) {
        this.loopSources.push(createLoopSource(context, rain, this.rainGain, 1.9));
      }
      this.doorOpen = doorOpen ?? undefined;
      this.doorClose = doorClose ?? undefined;
      this.lockClose = lockClose ?? undefined;
      this.lockOpen = lockOpen ?? undefined;
      this.blindsOpen = blindsOpen ?? undefined;
      this.blindsClose = blindsClose ?? undefined;
      this.lightSwitchOn = lightSwitchOn ?? undefined;
      this.lightSwitchOff = lightSwitchOff ?? undefined;
    }

    const [
      carpet,
      wood,
      concrete,
      sprintCarpet,
      sprintWood,
      sprintConcrete,
      bodyFall,
      boneCrack,
    ] = await commonPromise;
    if (this.disposed || this.context !== context) return;
    if (carpet.length > 0) this.footsteps['backrooms-carpet'] = carpet;
    if (wood.length > 0) this.footsteps['apartment-wood'] = wood;
    if (concrete.length > 0) this.footsteps['stairwell-concrete'] = concrete;
    if (sprintCarpet) this.sprintBuffers['backrooms-carpet'] = sprintCarpet;
    if (sprintWood) this.sprintBuffers['apartment-wood'] = sprintWood;
    if (sprintConcrete) this.sprintBuffers['stairwell-concrete'] = sprintConcrete;
    this.bodyFall = bodyFall ?? undefined;
    this.boneCrack = boneCrack ?? undefined;
    this.loadProgress?.(1);
    this.loadProgress = undefined;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0.6));
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(
      audioGainFromSetting(this.masterVolume),
      this.context.currentTime,
      0.035,
    );
  }

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok || !this.context) return null;
      return await this.context.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null;
    } finally {
      this.loadedAssetCount += 1;
      const total = this.ambience === 'interior' ? 38 : 31;
      this.loadProgress?.(Math.min(1, this.loadedAssetCount / total));
    }
  }

  private async loadBuffers(urls: readonly string[]): Promise<AudioBuffer[]> {
    const buffers = await Promise.all(urls.map((url) => this.loadBuffer(url)));
    return buffers.filter((buffer): buffer is AudioBuffer => buffer !== null);
  }

  private nextFootstep(surface: AudioSurface): AudioBuffer | undefined {
    const buffers = this.footsteps[surface];
    if (!buffers || buffers.length === 0) return undefined;
    const cursor = this.footstepCursor[surface];
    const orderedIndex = STEP_ORDER[cursor % STEP_ORDER.length]! % buffers.length;
    this.footstepCursor[surface] = cursor + 1;
    return buffers[orderedIndex];
  }

  private transientOffset(buffer: AudioBuffer): number {
    const cached = this.transientOffsets.get(buffer);
    if (cached !== undefined) return cached;
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        peak = Math.max(peak, Math.abs(samples[index]!));
      }
    }
    const threshold = Math.max(0.012, peak * 0.16);
    let onsetSample = 0;
    findOnset: for (let index = 0; index < buffer.length; index += 1) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        if (Math.abs(buffer.getChannelData(channel)[index]!) >= threshold) {
          onsetSample = index;
          break findOnset;
        }
      }
    }
    const offset = Math.min(
      Math.max(0, buffer.duration - 0.02),
      Math.max(0, onsetSample / buffer.sampleRate - 0.008),
    );
    this.transientOffsets.set(buffer, offset);
    return offset;
  }

  private playRecordedClip(
    buffer: AudioBuffer,
    clip: AudioClip,
    gainValue: number,
    playbackRate: number,
    cutoff: number,
    delay = 0,
    bodyBoost = 0,
  ): void {
    if (!this.context || !this.master) return;
    const context = this.context;
    const now = context.currentTime + delay;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const body = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.18;
    body.type = 'peaking';
    body.frequency.value = 175;
    body.Q.value = 0.72;
    body.gain.value = bodyBoost;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), now + 0.006);
    source.connect(filter).connect(body).connect(gain).connect(this.master);
    source.addEventListener('ended', () => {
      source.disconnect();
      filter.disconnect();
      body.disconnect();
      gain.disconnect();
    }, { once: true });
    const offset = Math.min(clip.offset, Math.max(0, buffer.duration - 0.02));
    const duration = Math.min(clip.duration, Math.max(0.02, buffer.duration - offset));
    const audibleDuration = duration / Math.max(0.01, playbackRate);
    const fadeDuration = Math.min(0.055, audibleDuration * 0.16);
    gain.gain.setValueAtTime(
      Math.max(0.0001, gainValue),
      now + Math.max(0.006, audibleDuration - fadeDuration),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + audibleDuration);
    source.start(now, offset, duration);
  }

  footstep(surface: AudioSurface, strength: number): void {
    if (strength >= 0.9) return;
    const buffer = this.nextFootstep(surface);
    if (!buffer) return;
    const crouching = strength <= 0.5;
    const onset = this.transientOffset(buffer);
    const variation = STEP_RATE_VARIATION[
      this.footstepCursor[surface] % STEP_RATE_VARIATION.length
    ]!;
    this.playRecordedClip(
      buffer,
      { offset: onset, duration: buffer.duration - onset },
      walkingFootstepGain(strength) * SURFACE_GAIN[surface],
      WALK_RATE[surface] * variation,
      crouching ? 3200 : WALK_CUTOFF[surface],
      0,
      crouching ? 2.5 : 4.8,
    );
  }

  setMovementState(surface: AudioSurface, state: 'idle' | 'sprint'): void {
    if (state !== 'sprint') {
      this.stopSprint();
      return;
    }
    if (this.sprintSource && this.sprintSurface === surface) return;
    const buffer = this.sprintBuffers[surface];
    if (!buffer || !this.context || !this.master) return;
    this.stopSprint(0.09);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const body = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    const loopTrim = SPRINT_LOOP_TRIM[surface];
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = Math.min(loopTrim.start, Math.max(0, buffer.duration - 0.1));
    source.loopEnd = Math.max(source.loopStart + 0.1, buffer.duration - loopTrim.end);
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(7600, WALK_CUTOFF[surface] + 1000);
    filter.Q.value = 0.16;
    body.type = 'peaking';
    body.frequency.value = 190;
    body.Q.value = 0.68;
    body.gain.value = 5.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      sprintFootstepGain * SURFACE_GAIN[surface],
      now + 0.075,
    );
    source.connect(filter).connect(body).connect(gain).connect(this.master);
    source.addEventListener('ended', () => {
      source.disconnect();
      filter.disconnect();
      body.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start(now, source.loopStart);
    this.sprintSource = source;
    this.sprintGain = gain;
    this.sprintSurface = surface;
  }

  private stopSprint(fadeDuration = 0.14): void {
    const source = this.sprintSource;
    const gain = this.sprintGain;
    if (!source || !gain || !this.context) return;
    this.sprintSource = undefined;
    this.sprintGain = undefined;
    this.sprintSurface = undefined;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeDuration);
    try {
      source.stop(now + fadeDuration + 0.02);
    } catch {
      // A surface switch can race with an already completed fade.
    }
  }

  land(surface: AudioSurface, impactSpeed: number): void {
    const kind = landingKindForSpeed(Math.max(0, impactSpeed));
    const surfaceBuffer = this.nextFootstep(surface);
    if (kind === 'light' || kind === 'medium') {
      if (!surfaceBuffer) return;
      const onset = this.transientOffset(surfaceBuffer);
      this.playRecordedClip(
        surfaceBuffer,
        { offset: onset, duration: surfaceBuffer.duration - onset },
        (kind === 'light' ? 0.27 : 0.58) * SURFACE_GAIN[surface],
        kind === 'light' ? 0.86 : 0.9,
        kind === 'light' ? 4300 : 5900,
        0,
        kind === 'light' ? 5.5 : 6.2,
      );
      return;
    }
    if (this.bodyFall) {
      const onset = this.transientOffset(this.bodyFall);
      this.playRecordedClip(
        this.bodyFall,
        { offset: onset, duration: this.bodyFall.duration - onset },
        kind === 'traumatic' ? 1 : 0.78,
        kind === 'traumatic' ? 0.88 : 0.96,
        kind === 'traumatic' ? 7600 : 6400,
        0,
        4.5,
      );
    }
    if (kind === 'traumatic' && this.boneCrack) {
      this.playRecordedClip(
        this.boneCrack,
        { offset: 0, duration: this.boneCrack.duration },
        0.68,
        0.93,
        8200,
        0.055,
      );
    }
  }

  door(sound: DoorSound): void {
    const buffer = sound === 'close'
      ? this.doorClose
      : sound === 'blocked' ? this.lockClose : this.doorOpen;
    if (!buffer) return;
    this.playRecordedClip(
      buffer,
      { offset: 0, duration: buffer.duration },
      sound === 'close' ? 0.76 : sound === 'blocked' ? 0.4 : 0.64,
      sound === 'blocked' ? 0.9 : 1,
      sound === 'blocked' ? 5200 : 9200,
    );
  }

  lock(locked: boolean): void {
    const buffer = locked ? this.lockClose : this.lockOpen;
    if (!buffer) return;
    this.playRecordedClip(buffer, { offset: 0, duration: buffer.duration }, 0.66, 1, 9800);
  }

  blinds(opening: boolean): void {
    const buffer = opening ? this.blindsOpen : this.blindsClose;
    if (!buffer) return;
    this.playRecordedClip(buffer, { offset: 0, duration: buffer.duration }, 0.5, 1, 8200);
  }

  lightSwitch(enabled: boolean): void {
    const buffer = enabled ? this.lightSwitchOn : this.lightSwitchOff;
    if (!buffer) return;
    this.playRecordedClip(buffer, { offset: 0, duration: buffer.duration }, 0.54, 1, 10500);
  }

  update(room: RoomKind): void {
    if (!this.context || !this.humGain || !this.ventGain || !this.lowpass) return;
    const now = this.context.currentTime;
    const sparse = room === 'sparse';
    const cavernous = room === 'open-hall' || room === 'pit-gallery';
    this.humGain.gain.setTargetAtTime(sparse ? 0.105 : 0.17, now, 0.8);
    this.ventGain.gain.setTargetAtTime(cavernous ? 0.19 : sparse ? 0.085 : 0.12, now, 1.3);
    this.lowpass.frequency.setTargetAtTime(cavernous ? 7600 : 5900, now, 0.75);
  }

  updateInterior(surface: AudioSurface, distanceToWindow: number, exposure = 1): void {
    this.updateInteriorGain(interiorRainGainForDistance(surface, distanceToWindow, exposure));
  }

  updateInteriorGain(targetGain: number): void {
    if (!this.context || !this.rainGain) return;
    const target = Math.min(1, Math.max(0, targetGain));
    this.rainGain.gain.setTargetAtTime(target, this.context.currentTime, 0.055);
  }

  async setSuspended(suspended: boolean): Promise<void> {
    if (!this.context || this.disposed) return;
    try {
      if (suspended) {
        this.stopSprint(0.025);
        await this.context.suspend();
      }
      else await this.context.resume();
    } catch {
      // Closing and suspending can race while a runtime is replaced.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSprint(0.01);
    this.loopSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    });
    const context = this.context;
    this.context = undefined;
    this.master = undefined;
    this.humGain = undefined;
    this.ventGain = undefined;
    this.rainGain = undefined;
    this.lowpass = undefined;
    this.bodyFall = undefined;
    this.boneCrack = undefined;
    this.doorOpen = undefined;
    this.doorClose = undefined;
    this.lockClose = undefined;
    this.lockOpen = undefined;
    this.blindsOpen = undefined;
    this.blindsClose = undefined;
    this.lightSwitchOn = undefined;
    this.lightSwitchOff = undefined;
    this.loadProgress = undefined;
    void context?.close().catch(() => undefined);
  }
}
