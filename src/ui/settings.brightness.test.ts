// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultGameSettings, loadGameSettings, saveGameSettings } from './settings';
import { ExperienceUI } from './ExperienceUI';

vi.mock('../audio/SiteAudio', () => ({ siteAudio: new Proxy({}, { get: () => () => undefined }) }));
const key = 'backrooms-random-story-settings-v1';
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it('migrates old settings to 50 without losing other preferences, and preserves exact zero', () => {
  localStorage.setItem(key, JSON.stringify({ lighting: 'legacy', fieldOfView: 86, masterVolume: .2 }));
  expect(loadGameSettings()).toMatchObject({ brightness: 50, lighting: 'legacy', fieldOfView: 86, masterVolume: .2 });
  for (const brightness of [0, 50, 100]) {
    saveGameSettings({ ...defaultGameSettings(), brightness });
    expect(loadGameSettings().brightness).toBe(brightness);
  }
  for (const brightness of [null, false, '25', {}, 'NaN']) {
    localStorage.setItem(key, JSON.stringify({ brightness })); expect(loadGameSettings().brightness).toBe(50);
  }
  localStorage.setItem(key, '{broken'); expect(loadGameSettings().brightness).toBe(50);
  localStorage.setItem(key, '{"brightness":-10}'); expect(loadGameSettings().brightness).toBe(0);
  localStorage.setItem(key, '{"brightness":120}'); expect(loadGameSettings().brightness).toBe(100);
});

it('handles blocked settings storage and reset defaults', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(loadGameSettings().brightness).toBe(50);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(() => saveGameSettings({ ...defaultGameSettings(), brightness: 0 })).not.toThrow();
  expect(defaultGameSettings().brightness).toBe(50);
});

it('sends numeric slider input and synchronizes its displayed and persisted value in both experiences', async () => {
  for (const experience of ['backrooms', 'russian-stairwell'] as const) {
    const changed = vi.fn();
    const noop = () => undefined;
    const ui = new ExperienceUI(document.body, { enter: noop, regenerate: noop, returnToMainMenu: noop,
      toggleFullscreen: noop, settingsChanged: changed, submitConsole: () => ({ close: false, feedback: '', messages: [] }),
      completeConsole: () => null, consoleVisibility: noop }, defaultGameSettings(), experience);
    try {
      const slider = document.querySelector<HTMLInputElement>('[data-setting="brightness"]')!;
      expect(slider.min).toBe('0'); expect(slider.max).toBe('100'); expect(slider.step).toBe('1'); expect(slider.value).toBe('50');
      for (const value of [0, 100, 50]) {
        slider.value = String(value); slider.dispatchEvent(new Event('input')); await Promise.resolve();
        expect(changed.mock.lastCall?.[0].brightness).toBe(value);
        expect(document.querySelector<HTMLOutputElement>('[data-output="brightness"]')!.value).toBe(`${value}%`);
        expect(loadGameSettings().brightness).toBe(value);
      }
    } finally { ui.dispose(); }
  }
});
