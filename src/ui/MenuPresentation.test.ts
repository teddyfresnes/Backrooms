// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ExperienceUI } from './ExperienceUI';
import { defaultGameSettings } from './settings';

vi.mock('../audio/SiteAudio', () => ({ siteAudio: new Proxy({}, { get: () => () => undefined }) }));
let ui: ExperienceUI;
afterEach(() => { ui?.dispose(); document.body.replaceChildren(); });

function fixture() {
  const stylesheet = document.createElement('style');
  document.body.append(stylesheet);
  ui = new ExperienceUI(document.body, {
    enter() {}, regenerate() {}, returnToMainMenu() {}, toggleFullscreen() {}, settingsChanged() {},
    submitConsole: () => ({ close: false, feedback: '', messages: [] }), completeConsole: () => null, consoleVisibility() {},
  }, defaultGameSettings());
  ui.setReady();
  return stylesheet;
}
const appearance = (selector: string, properties: string[]) => {
  const style = getComputedStyle(document.querySelector(selector)!);
  return Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)]));
};

it('keeps the home menu appearance from before ModernUI while leaving recent dialogs enabled', async () => {
  // Vitest stubs CSS imports by default; read the real styles for this check.
  // @ts-expect-error Node typings are not a production dependency.
  const { readFile } = await import('node:fs/promises');
  const [baseCss, tokens, modern] = await Promise.all([
    readFile('src/styles.css', 'utf8'), readFile('src/ui/menu-tokens.css', 'utf8'),
    readFile('src/ui/ModernUI.css', 'utf8'),
  ]);
  const recentCss = tokens + modern.replace(/^@import.*$/gm, '');
  const stylesheet = fixture();
  stylesheet.textContent = baseCss;
  const properties = ['font-size', 'font-weight', 'text-transform', 'padding-left', 'border-radius', 'box-shadow'];
  const originalAction = appearance('[data-ui="regenerate"]', properties);
  expect(originalAction['font-weight']).toBe('650');
  const originalTitle = appearance('.home-title h2', properties);
  stylesheet.textContent = baseCss + recentCss;
  expect(appearance('[data-ui="regenerate"]', properties)).toEqual(originalAction);
  expect(appearance('.home-title h2', properties)).toEqual(originalTitle);

  ui.setSaveHistory([{ id: 'save', experienceId: 'russian-stairwell', kind: 'manual', levelId: 'building',
    levelLabel: 'Immeuble', savedAt: '2026-11-01T00:00:00Z', playTimeSeconds: 20 }]);
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  const dialogAppearance = () => ({
    card: appearance('.confirmation-card', ['border-radius', 'box-shadow', 'padding-top', 'background-color']),
    title: appearance('.confirmation-card h2', ['font-size', 'font-weight']),
    action: appearance('[data-ui="confirmation-accept"]', ['padding-left', 'border-radius', 'font-size', 'box-shadow']),
  });
  click('[data-ui="regenerate"]');
  expect(document.querySelector<HTMLElement>('[data-ui="confirmation"]')!.hidden).toBe(false);
  const mainMenuDialog = dialogAppearance();
  expect(mainMenuDialog.title['font-weight']).toBe('400');
  expect(mainMenuDialog.card['box-shadow']).toBe('none');
  click('[data-ui="confirmation-cancel"]');
  ui.beginGameplay(true); ui.setLocked(false);
  click('[data-ui="regenerate"]');
  expect(dialogAppearance()).toEqual(mainMenuDialog);
});
