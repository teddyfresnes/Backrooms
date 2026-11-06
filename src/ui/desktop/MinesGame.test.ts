import { expect, it } from 'vitest';
import { MinesGame } from './MinesGame';
it('offers a safe first click, deterministic boards, flood fill, flags, victory and loss', () => {
  const a = new MinesGame('test'), b = new MinesGame('test'); a.reveal(40); b.reveal(40);
  expect([...a.mines]).toEqual([...b.mines]); expect(a.mines.size).toBe(10);
  expect(a.count(40)).toBe(0); expect(a.revealed.size).toBeGreaterThan(1);
  for (const cell of a.neighbours(40)) expect(a.mines.has(cell)).toBe(false);
  const mine = [...a.mines][0]!; a.flag(mine); a.reveal(mine); expect(a.status).toBe('playing');
  a.flag(mine); a.reveal(mine); expect(a.status).toBe('lost');
  const revealed = a.revealed.size; a.reveal(0); expect(a.revealed.size).toBe(revealed);
  for (let cell = 0; cell < 81; cell++) if (!b.mines.has(cell)) b.reveal(cell);
  expect(b.status).toBe('won'); expect(b.revealed.size).toBe(71);
});
it('bounds coordinates and prevents neighbours wrapping between rows', () => {
  const game = new MinesGame(); expect(game.neighbours(0)).toEqual([1, 9, 10]);
  game.reveal(-1); game.reveal(81); game.flag(NaN); expect(game.status).toBe('ready');
  expect(game.flags.size).toBe(0);
});
