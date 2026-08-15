import type { LightingMode } from '../render/LightingMode';
import {
  defaultControlBindings,
  sanitizeControlBindings,
  type ControlBindings,
} from '../input/ControlBindings';

export type LightingPreference = LightingMode;
export type RenderQualityPreference = 'auto' | 'performance' | 'quality';

export interface GameSettings {
  lighting: LightingPreference;
  renderQuality: RenderQualityPreference;
  fieldOfView: number;
  lookSensitivity: number;
  masterVolume: number;
  menuMotion: boolean;
  cameraMotion: boolean;
  crosshair: boolean;
  controls: ControlBindings;
}

const STORAGE_KEY = 'backrooms-random-story-settings-v1';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const defaultGameSettings = (): GameSettings => ({
  lighting: 'modern',
  renderQuality: 'auto',
  fieldOfView: 72,
  lookSensitivity: 1,
  masterVolume: 0.42,
  menuMotion: typeof window === 'undefined'
    ? true
    : !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  cameraMotion: typeof window === 'undefined'
    ? true
    : !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  crosshair: true,
  controls: defaultControlBindings(),
});

export const loadGameSettings = (): GameSettings => {
  const defaults = defaultGameSettings();
  if (typeof window === 'undefined') return defaults;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<GameSettings>;
    return {
      lighting: stored.lighting === 'legacy' ? 'legacy' : 'modern',
      renderQuality: ['auto', 'performance', 'quality'].includes(stored.renderQuality ?? '')
        ? stored.renderQuality as RenderQualityPreference
        : defaults.renderQuality,
      fieldOfView: clamp(Number(stored.fieldOfView) || defaults.fieldOfView, 60, 100),
      lookSensitivity: clamp(
        Number.isFinite(Number(stored.lookSensitivity))
          ? Number(stored.lookSensitivity)
          : defaults.lookSensitivity,
        0.3,
        2,
      ),
      masterVolume: clamp(
        Number.isFinite(Number(stored.masterVolume))
          ? Number(stored.masterVolume)
          : defaults.masterVolume,
        0,
        1,
      ),
      menuMotion: typeof stored.menuMotion === 'boolean' ? stored.menuMotion : defaults.menuMotion,
      cameraMotion: typeof stored.cameraMotion === 'boolean'
        ? stored.cameraMotion
        : defaults.cameraMotion,
      crosshair: typeof stored.crosshair === 'boolean' ? stored.crosshair : defaults.crosshair,
      controls: sanitizeControlBindings(stored.controls, defaults.controls),
    };
  } catch {
    return defaults;
  }
};

export const saveGameSettings = (settings: GameSettings): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be blocked in private or embedded browsing contexts.
  }
};
