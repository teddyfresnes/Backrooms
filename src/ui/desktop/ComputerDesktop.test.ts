import {reachPowerCut,gasTarget,gasOrigin} from '../../../tests/support/gas-journey';
// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ApartmentQuest, RENT_MAIL_ID } from '../../story/ApartmentQuest';
import { InputManager } from '../../input/InputManager';
import { ComputerDesktop } from './ComputerDesktop';
import { DESKTOP_MAIL } from './DesktopContent';
import { MinesGame } from './MinesGame';
let desktop: ComputerDesktop;
afterEach(() => { desktop?.dispose(); document.body.replaceChildren(); });
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
it('supports mail → finished game, preserving the optional account site and all desktop applications', () => {
  const quest = new ApartmentQuest(), open = vi.fn(), close = vi.fn();
  quest.reachHome(); quest.setLight(true); quest.setGas(true); quest.setTelevision(true); quest.setRadio(true);
  desktop = new ComputerDesktop(document.body, quest, open, close); desktop.open(); desktop.open();
  expect(open).toHaveBeenCalledOnce(); expect(document.querySelector('.pc-lcd')?.getAttribute('aria-label')).toBe('00:30');
  click('.pc-icon[data-app="mail"]');
  expect(document.querySelectorAll('.pc-mail-list button')).toHaveLength(DESKTOP_MAIL.length);
  const search = document.querySelector<HTMLInputElement>('[data-search]')!;
  search.value = 'prelevement'; search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.querySelectorAll('.pc-mail-list button')).toHaveLength(1);
  click(`[data-action="mail"][data-id="${RENT_MAIL_ID}"]`);
  expect(quest.snapshot().stage).toBe('game'); expect(quest.snapshot().readMailIds).toContain(RENT_MAIL_ID);
  expect(document.querySelector('.pc-mail-reader')?.textContent).toContain('RV-041');
  click('.pc-mail-link'); click('[data-action="check-account"]');
  expect(document.querySelector('.pc-debt')?.textContent).toBe('142,60 €'); expect(quest.snapshot().stage).toBe('game');
  expect(document.querySelector('.pc-objective')).toBeNull(); expect(quest.objective('home')).toContain('Démineur');
  click('.pc-icon[data-app="mines"]'); expect(document.querySelectorAll('[data-cell]')).toHaveLength(81);
  expect(quest.snapshot().stage).toBe('game');
  click('[data-cell="40"]'); expect(document.querySelectorAll('.pc-mine-grid .revealed').length).toBeGreaterThan(1);
  const board = new MinesGame(); board.reveal(40); click(`[data-cell="${[...board.mines][0]}"]`); expect(quest.devices.firstGameFinished).toBe(true);
  click('[data-action="minimize"][data-app="mines"]'); expect(document.querySelector<HTMLElement>('.pc-mines')!.hidden).toBe(true);
  click('.pc-tasks [data-app="mines"]'); expect(document.querySelector<HTMLElement>('.pc-mines')!.hidden).toBe(false);
  desktop.close(); desktop.open(); expect(quest.snapshot().stage).toBe('done');
  expect(close).toHaveBeenCalledOnce(); expect(desktop.element.hidden).toBe(false);
});
it('suspends real movement input while open, restores it on Escape, and removes keyboard interception on disposal', () => {
  const input = new InputManager(), quest = new ApartmentQuest();
  try {
    desktop = new ComputerDesktop(document.body, quest, () => input.setEnabled(false), () => input.setEnabled(true));
    desktop.open(); const move = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ' }));
    move(); expect(input.axes.forward).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', cancelable: true }));
    expect(desktop.isOpen).toBe(false); expect(desktop.element.hidden).toBe(true);
    move(); expect(input.axes.forward).toBe(1);
    desktop.dispose(); input.setEnabled(false); input.setEnabled(true); move(); expect(input.axes.forward).toBe(1);
  } finally { input.dispose(); }
});
it('keeps one dialog mounted across repeated uses and does not advance objectives by opening unrelated mail or games early', () => {
  const quest = new ApartmentQuest(); desktop = new ComputerDesktop(document.body, quest, () => {}, () => {});
  desktop.open(); click('.pc-icon[data-app="mines"]'); expect(quest.snapshot().stage).toBe('inbox');
  click('.pc-icon[data-app="mail"]'); click('[data-id="maman"]'); expect(quest.snapshot().stage).toBe('inbox');
  click('[data-action="close"][data-app="mail"]'); click('.pc-icon[data-app="mail"]');
  expect(document.querySelector('[data-id="maman"]')?.classList.contains('pc-unread')).toBe(false);
  for (let i = 0; i < 5; i++) { desktop.close(); desktop.open(); }
  expect(document.querySelectorAll('.computer-desktop')).toHaveLength(1);
});

it.each(['won', 'lost'] as const)('only completes the first game on a real %s result after the narrative mail', result => {
  const quest = new ApartmentQuest(), sound = vi.fn();
  quest.reachHome(); quest.setLight(true); quest.setGas(true); quest.setRadio(true); quest.setTelevision(true);
  desktop = new ComputerDesktop(document.body, quest, () => {}, () => {}, sound); desktop.open();
  click('.pc-icon[data-app="mines"]'); click('[data-cell="40"]');
  click('.pc-icon[data-app="mail"]'); click(`[data-id="${RENT_MAIL_ID}"]`);
  const early = new MinesGame(); early.reveal(40); click(`[data-cell="${[...early.mines][0]}"]`);
  expect(quest.devices.firstGameFinished).toBe(false);
  click('[data-action="restart-mines"]'); expect(quest.devices.firstGameFinished).toBe(false);
  click('[data-cell="40"]'); expect(quest.devices.firstGameFinished).toBe(false);
  const board = new MinesGame('dernier-etage-1'); board.reveal(40);
  if (result === 'lost') click(`[data-cell="${[...board.mines][0]}"]`);
  else for (let i = 0; i < 81; i++) if (!board.mines.has(i)) click(`[data-cell="${i}"]`);
  expect(quest.devices.firstGameFinished).toBe(true); expect(desktop.isOpen).toBe(true);
  expect(quest.devices.outageTriggered).toBe(false); expect(sound.mock.calls.length).toBeGreaterThan(6);
});
it('does not validate physical entry merely by opening the desktop', () => {
  const quest = new ApartmentQuest(); desktop = new ComputerDesktop(document.body, quest, () => {}, () => {}); desktop.open();
  expect(quest.snapshot().homeReached).toBe(false); expect(quest.devices.pcUsed).toBe(true);
  expect(document.querySelectorAll('.pc-objective')).toHaveLength(0);
});
it('interrupts without a normal-close callback and refuses the desktop after a consumed outage or reload',()=>{
  const quest=new ApartmentQuest(),close=vi.fn();quest.reachHome();quest.setLight(true);quest.setGas(true);quest.setTelevision(true);quest.setRadio(true);quest.readMail(RENT_MAIL_ID);
  desktop=new ComputerDesktop(document.body,quest,()=>{},close);desktop.open();quest.finishGame('lost');quest.nextThought();reachPowerCut(quest);
  desktop.interrupt();expect(desktop.isOpen).toBe(false);expect(desktop.element.hidden).toBe(true);expect(close).not.toHaveBeenCalled();desktop.open();expect(desktop.isOpen).toBe(false);
  desktop.dispose();desktop=new ComputerDesktop(document.body,new ApartmentQuest(quest.snapshot()),()=>{},close);desktop.open();expect(desktop.isOpen).toBe(false);
});
