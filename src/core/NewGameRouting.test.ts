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
interface RuntimeStub { initialize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; enterAfterIntro: ReturnType<typeof vi.fn>; startArrivalCinematic: ReturnType<typeof vi.fn> }
interface FilmStub { wasSkipped: boolean; finished: Promise<void>; complete(): void; setSceneReady: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; reveal: ReturnType<typeof vi.fn> }
const state = vi.hoisted(() => ({
  menus: [] as MenuOptions[],
  halls: [] as { game: RuntimeStub; launch: unknown; options: { deferEntry?: boolean }; callbacks: MenuOptions }[],
  films: [] as FilmStub[],
  nextGate: null as Gate | null,
  preloads: [] as { dispose: ReturnType<typeof vi.fn> }[],
  oldRuntimes: [] as { suspendForTransition: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
  hallImports: 0,
}));
vi.mock('../apartment/ApartmentPreload', () => ({ ApartmentPreload: class {
  dispose = vi.fn(); constructor() { state.preloads.push(this); }
} }));
vi.mock('./EntryAssetPreload', () => ({ preloadEntryAssets: vi.fn(() => vi.fn()) }));
vi.mock('./Game', () => ({ Game: class {
  static async create(root: HTMLElement, options: MenuOptions) { return new this(root, options); }
  constructor(_root: HTMLElement, options: MenuOptions) { state.menus.push(options); state.oldRuntimes.push(this); }
  initialize = vi.fn(async (progress: (n: number) => void) => { progress(1); });
  suspendForTransition = vi.fn();
  dispose = vi.fn();
} }));
vi.mock('./RussianStairwellGame', () => { state.hallImports++; return { RussianStairwellGame: class {
  private gate = state.nextGate;
  constructor(_root: HTMLElement, launch: unknown, callbacks: MenuOptions, options: { deferEntry?: boolean }) {
    state.halls.push({ game: this, launch, callbacks, options }); state.nextGate = null;
  }
  initialize = vi.fn(async (progress: (n: number) => void) => { progress(.5); await this.gate?.promise; progress(1); });
  dispose = vi.fn();
  suspendForTransition = vi.fn();
  enterAfterIntro = vi.fn();
  startArrivalCinematic = vi.fn();
} }; });
vi.mock('../ui/NewGameIntro', () => ({ NewGameIntro: class {
  wasSkipped = false;
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
  state.menus = []; state.halls = []; state.films = []; state.nextGate = null; state.preloads = [];
  state.oldRuntimes = []; state.hallImports = 0;
  frames = new Map(); sequence = 0; visibilityListeners = [];
  window.localStorage.clear(); document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++sequence, fn); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('scheduler', { yield: async () => {} });
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

it('downloads during photos, then paints the loader before disposal, runtime import and scene construction', async () => {
  await import('../main'); await pump();
  expect(state.films).toHaveLength(0);
  const loading = state.nextGate = gate();
  state.menus[0]!.onRequestNewGame(); await pump();
  const film = state.films[0]!;
  expect(state.halls).toHaveLength(0); expect(state.preloads).toHaveLength(1);
  expect(state.hallImports).toBe(0);
  expect(state.oldRuntimes[0]!.suspendForTransition).toHaveBeenCalledOnce();
  expect(state.oldRuntimes[0]!.dispose).not.toHaveBeenCalled();
  expect(film.setSceneReady).not.toHaveBeenCalled();
  await pump();
  expect(state.halls).toHaveLength(0);
  film.complete(); await settle();
  expect(state.oldRuntimes[0]!.dispose).not.toHaveBeenCalled();
  expect(state.hallImports).toBe(0);
  await pump();
  expect(state.oldRuntimes[0]!.dispose).toHaveBeenCalledOnce();
  const hall = state.halls[0]!;
  expect(hall.launch).toEqual({ kind: 'new' }); expect(hall.options.deferEntry).toBe(true);
  expect(hall.game.startArrivalCinematic).not.toHaveBeenCalled();
  expect(hall.game.enterAfterIntro).not.toHaveBeenCalled();
  loading.resolve(); await pump();
  expect(film.setSceneReady).toHaveBeenCalledOnce();
  expect(film.reveal).toHaveBeenCalledOnce(); expect(hall.game.startArrivalCinematic).toHaveBeenCalledOnce();
  expect(hall.game.enterAfterIntro).not.toHaveBeenCalled();

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

it('cancels a film and its downloads without ever importing or constructing its 3D scene', async () => {
  await import('../main'); await pump();
  state.menus[0]!.onRequestNewGame(); await pump();
  const film = state.films[0]!;
  state.menus[0]!.onRequestMainMenu(); await pump();
  expect(film.dispose).toHaveBeenCalledOnce();
  expect(state.preloads[0]!.dispose).toHaveBeenCalledOnce();
  expect(state.hallImports).toBe(0); expect(state.halls).toHaveLength(0);
  film.complete(); await pump();
  expect(state.halls).toHaveLength(0); expect(state.menus).toHaveLength(2);
});

it('disposes a cancelled cinematic and never re-enters its late-loading runtime', async () => {
  await import('../main'); await pump();
  const loading = state.nextGate = gate();
  state.menus[0]!.onRequestNewGame(); await pump();
  state.films[0]!.complete(); await pump();
  const hall = state.halls[0]!, film = state.films[0]!;
  hall.callbacks.onRequestMainMenu(); await pump();
  expect(film.dispose).toHaveBeenCalledOnce(); expect(hall.game.dispose).toHaveBeenCalled();
  loading.resolve(); await pump();
  expect(film.setSceneReady).not.toHaveBeenCalled();
  expect(hall.game.enterAfterIntro).not.toHaveBeenCalled();
  expect(state.menus).toHaveLength(2);
});

it('runs ten successive launches with duplicate requests, early/late downloads and whole-prologue skips',async()=>{
 await import('../main');await pump();
 for(let run=0;run<10;run++){
  const preparation=state.nextGate=gate();const menu=state.menus.at(-1)!;
  menu.onRequestNewGame();menu.onRequestNewGame();menu.onRequestNewGame();await pump();
  expect(state.halls).toHaveLength(run);expect(state.films).toHaveLength(run+1);
  const film=state.films[run]!;film.wasSkipped=run%3!==0;
  if(run%2===0){preparation.resolve();await pump();expect(film.reveal).not.toHaveBeenCalled();}
  film.complete();await pump();
  expect(state.halls).toHaveLength(run+1);const hall=state.halls[run]!;
  if(run%2!==0){expect(film.reveal).not.toHaveBeenCalled();preparation.resolve();}
  await pump();expect(film.reveal).toHaveBeenCalledOnce();
  expect(hall.game.enterAfterIntro).toHaveBeenCalledTimes(film.wasSkipped?1:0);
  expect(hall.game.startArrivalCinematic).toHaveBeenCalledTimes(film.wasSkipped?0:1);
  hall.callbacks.onRequestMainMenu();await pump();expect(hall.game.dispose).toHaveBeenCalledOnce();
 }
});
