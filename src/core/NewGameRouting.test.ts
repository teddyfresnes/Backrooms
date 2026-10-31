// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeGameSave } from './SaveHistory';

interface Gate { promise: Promise<void>; resolve(): void }
interface MenuOptions {
  onRequestNewGame(): void;
  onRequestMainMenu(): void;
  onRequestLoadGame(id: string): void;
  onRequestContinue?(): void;
}
interface RuntimeStub { initialize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; enterAfterIntro: ReturnType<typeof vi.fn> }
interface FilmStub { finished: Promise<void>; complete(): void; setSceneReady: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; reveal: ReturnType<typeof vi.fn> }
const state = vi.hoisted(() => ({
  menus: [] as MenuOptions[],
  halls: [] as { game: RuntimeStub; launch: unknown; options: { deferEntry?: boolean }; callbacks: MenuOptions }[],
  films: [] as FilmStub[],
  nextGate: null as Gate | null,
}));
vi.mock('./Game', () => ({ Game: class {
  constructor(_root: HTMLElement, options: MenuOptions) { state.menus.push(options); }
  initialize = vi.fn(async (progress: (n: number) => void) => { progress(1); });
  dispose = vi.fn();
} }));
vi.mock('./RussianStairwellGame', () => ({ RussianStairwellGame: class {
  private gate = state.nextGate;
  constructor(_root: HTMLElement, launch: unknown, callbacks: MenuOptions, options: { deferEntry?: boolean }) {
    state.halls.push({ game: this, launch, callbacks, options }); state.nextGate = null;
  }
  initialize = vi.fn(async (progress: (n: number) => void) => { progress(.5); await this.gate?.promise; progress(1); });
  dispose = vi.fn();
  enterAfterIntro = vi.fn();
} }));
vi.mock('../ui/NewGameIntro', () => ({ NewGameIntro: class {
  complete: () => void = () => undefined;
  finished = new Promise<void>(resolve => { this.complete = resolve; });
  constructor() { state.films.push(this); }
  setProgress = vi.fn();
  setSceneReady = vi.fn();
  reveal = vi.fn(async (enter: () => void) => { enter(); });
  dispose = vi.fn(() => this.complete());
} }));
vi.mock('../ui/OpeningIntro', () => ({ OpeningIntro: class {
  minimumDuration = Promise.resolve(); finish = vi.fn(async () => undefined);
} }));
vi.mock('../audio/SiteAudio', () => ({ siteAudio: {
  setMasterVolume: vi.fn(), setMenuActive: vi.fn(), syncVisibility: vi.fn(),
} }));

let frames: Map<number, FrameRequestCallback>;
let sequence = 0;
let visibilityListeners: EventListener[];
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const pump = async () => {
  for (let i = 0; i < 12; i++) {
    await settle();
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(i * 16));
  }
};
const gate = (): Gate => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  state.menus = []; state.halls = []; state.films = []; state.nextGate = null;
  frames = new Map(); sequence = 0; visibilityListeners = [];
  window.localStorage.clear(); document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++sequence, fn); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'visibilitychange' && typeof listener === 'function') visibilityListeners.push(listener);
    add(type, listener, options);
  });
});
afterEach(() => {
  for (const listener of visibilityListeners) document.removeEventListener('visibilitychange', listener);
  document.body.replaceChildren(); window.localStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('starts a new cinematic in parallel with the real loader, gates gameplay, and bypasses it for saved sessions', async () => {
  await import('../main'); await pump();
  expect(state.films).toHaveLength(0);
  const loading = state.nextGate = gate();
  state.menus[0]!.onRequestNewGame(); await pump();
  const hall = state.halls[0]!, film = state.films[0]!;
  expect(hall.launch).toEqual({ kind: 'new' }); expect(hall.options.deferEntry).toBe(true);
  expect(film.setSceneReady).not.toHaveBeenCalled();
  film.complete(); await pump();
  expect(hall.game.enterAfterIntro).not.toHaveBeenCalled();
  loading.resolve(); await pump();
  expect(film.setSceneReady).toHaveBeenCalledOnce();
  expect(film.reveal).toHaveBeenCalledOnce(); expect(hall.game.enterAfterIntro).toHaveBeenCalledOnce();

  const save = writeGameSave(window.localStorage, {
    experienceId: 'russian-stairwell', kind: 'manual', levelId: 'building', levelLabel: 'Immeuble', playTimeSeconds: 90,
    payload: { safePosition: { x: 1, y: 6.625, z: -2 }, quaternion: { x: 0, y: 1, z: 0, w: 0 },
      entranceDoor: { progress: .4, targetProgress: 1 }, apartmentLightOn: true },
  });
  expect(save.ok).toBe(true); if (!save.ok) throw new Error('Save failed');
  hall.callbacks.onRequestLoadGame(save.save.id); await pump();
  expect(state.films).toHaveLength(1);
  expect(state.halls[1]!.launch).toMatchObject({ kind: 'load', save: { payload: { safePosition: { x: 1, y: 6.625, z: -2 } } } });
  expect(state.halls[1]!.options.deferEntry).toBe(false);
});

it('disposes a cancelled cinematic and never re-enters its late-loading runtime', async () => {
  await import('../main'); await pump();
  const loading = state.nextGate = gate();
  state.menus[0]!.onRequestNewGame(); await pump();
  const hall = state.halls[0]!, film = state.films[0]!;
  hall.callbacks.onRequestMainMenu(); await pump();
  expect(film.dispose).toHaveBeenCalledOnce(); expect(hall.game.dispose).toHaveBeenCalled();
  loading.resolve(); await pump();
  expect(film.setSceneReady).not.toHaveBeenCalled();
  expect(hall.game.enterAfterIntro).not.toHaveBeenCalled();
  expect(state.menus).toHaveLength(2);
});
