import {reachPowerCut,gasTarget,gasOrigin} from '../../tests/support/gas-journey';
import { describe, expect, it } from 'vitest';
import { ApartmentQuest, RENT_MAIL_ID } from '../story/ApartmentQuest';
import {InventoryState}from '../apartment/InventoryState';
import {CorridorStory}from '../story/CorridorProgress';
import {
  GAME_SAVE_HISTORY_LIMIT,
  GAME_SAVE_HISTORY_SCHEMA_VERSION,
  GAME_SAVE_HISTORY_STORAGE_KEY,
  getGameSaveSummary,
  listGameSaves,
  loadGameSave,
  removeGameSave,
  writeGameSave,
  type BackroomsGameSaveInput,
  type GameSaveStorage,
  type RussianStairwellGameSaveInput,
} from './SaveHistory';

class MemoryStorage implements GameSaveStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const russianInput = (playTimeSeconds = 83): RussianStairwellGameSaveInput => ({
  experienceId: 'russian-stairwell',
  kind: 'manual',
  levelId: 'russian-building',
  levelLabel: 'Immeuble',
  playTimeSeconds,
  payload: {
    safePosition: { x: 3, y: 0.865, z: -4 },
    quaternion: { x: 0, y: 0.5, z: 0, w: 0.5 },
    entranceDoor: { progress: 0.4, targetProgress: 1 },
    apartmentLightOn: true,
  },
});

const backroomsInput = (playTimeSeconds = 120): BackroomsGameSaveInput => ({
  experienceId: 'backrooms',
  kind: 'autosave',
  levelId: 'backrooms-level-0',
  levelLabel: 'Niveau 0',
  playTimeSeconds,
  payload: {
    seed: 'TEST-SEED_01',
    chunk: { x: -2, z: 7, story: 1 },
    localPosition: { x: 14, y: 0.865, z: -22 },
    quaternion: { x: 0, y: 0, z: 0, w: 2 },
  },
});

it('keeps old saves compatible and round-trips inventory, the active world, objectives and every lighting/camera checkpoint',()=>{
  const store=new MemoryStorage(),quest=new ApartmentQuest();quest.reachHome();quest.setLight(true);quest.setGas(true);quest.setRadio(true);quest.setTelevision(true);quest.readMail(RENT_MAIL_ID);quest.checkBank();quest.finishGame('lost');quest.nextThought();reachPowerCut(quest);
  const old=writeGameSave(store,russianInput());expect(old.ok).toBe(true);
  const bag=new InventoryState();bag.acquireLamp();bag.toggleLamp();bag.store({id:'prop:test-small',label:'Petit objet'});
  const story=new CorridorStory();story.activate();
  for(const checkpoint of [0,1,3.2,8.2,17,42]){
    if(checkpoint>0&&!story.state.triggered)for(let i=0;i<205;i++)story.observe({x:-2+i*.1,y:9.535,z:-2.7},{x:-2,y:8.67,z:-2.7},true,Math.PI/2);
    while(story.state.elapsed<checkpoint)story.update(.05,true);
    const base=russianInput();const input={...base,payload:{...base.payload,computer:quest.snapshot(),inventory:bag.snapshot(),corridor:story.snapshot(),objective:story.objective(true)}};
    const saved=writeGameSave(store,input);expect(saved.ok).toBe(true);
    const latest=listGameSaves(store)[0]!;expect(latest.experienceId).toBe('russian-stairwell');if(latest.experienceId!=='russian-stairwell')throw Error();
    expect(latest.payload.inventory).toEqual(bag.snapshot());expect(latest.payload.corridor).toEqual(story.snapshot());expect(latest.payload.objective).toEqual(story.objective(true));expect(latest.payload.computer?.apartment?.outageTriggered).toBe(true);
    expect(new CorridorStory(latest.payload.corridor).snapshot()).toEqual(story.snapshot());
  }
});

describe('game save history', () => {
  it('round-trips all apartment device states, thoughts, a pending outage and the completed one', () => {
    const storage = new MemoryStorage(), input = russianInput(), quest = new ApartmentQuest();
    quest.reachHome(); quest.setLight(true); quest.setGas(true); quest.setTelevision(true); quest.setRadio(true); quest.useComputer(); quest.breakWhisky();
    quest.readMail(RENT_MAIL_ID); quest.checkBank(); quest.finishGame('won'); quest.nextThought(); quest.advanceNarration(.5,false);
    for (let phase = 0; phase < 2; phase++) {
      const computer = quest.snapshot();
      const result = writeGameSave(storage, { ...input, payload: { ...input.payload, apartmentLightOn: quest.devices.lightOn, computer } });
      expect(result.ok).toBe(true); if (!result.ok) throw new Error('Save rejected');
      const loaded = loadGameSave(storage, result.save.id);
      expect(loaded?.experienceId === 'russian-stairwell' && loaded.payload.computer).toEqual(computer);
      if (loaded?.experienceId !== 'russian-stairwell') throw new Error('Wrong save');
      const restored = new ApartmentQuest(loaded.payload.computer);
      expect(restored.devices).toMatchObject({ gasOn: true, pcUsed: true, whiskyBroken: true, firstGameFinished: true });
      if (phase === 0) { expect(restored.devices.outageLeadSeconds).toBeCloseTo(.5); expect(restored.devices.outageTriggered).toBe(false); }
      else { expect(restored.devices.outageTriggered).toBe(true); expect(restored.advanceOutage(gasOrigin,gasTarget,true)).toBe(false); expect(restored.nextThought()).toBeNull(); }
      reachPowerCut(quest);
    }
  });
  it('round-trips computer quests and read mail without rejecting older stairwell saves', () => {
    const storage = new MemoryStorage(), input = russianInput();
    const computer = { homeReached: true, stage: 'game' as const, readMailIds: ['maman', 'regie-prelevement'] };
    const result = writeGameSave(storage, { ...input, payload: { ...input.payload, computer } });
    expect(result.ok).toBe(true); if (!result.ok) throw new Error('Save rejected');
    const loaded = loadGameSave(storage, result.save.id);
    expect(loaded?.experienceId === 'russian-stairwell' && loaded.payload.computer).toEqual(computer);
    expect(writeGameSave(new MemoryStorage(), input).ok).toBe(true);
    expect(writeGameSave(new MemoryStorage(), { ...input, payload: { ...input.payload, computer: { ...computer, homeReached: false } } }).ok).toBe(false);
  });
  it('round-trips optional versioned surface anchors while accepting old payloads', () => {
    for (const height of [-.8, .225, .9, 1.8]) {
      const storage = new MemoryStorage(), input = backroomsInput();
      const surface = { version: 1, id: 'chunk--2:7:1/vertical/ramp-1', layer: 'chunk--2:7:1/ground' };
      const saved = writeGameSave(storage, { ...input, payload: { ...input.payload, localPosition: { x: 14, y: height + .865, z: -22 }, surface } });
      expect(saved.ok).toBe(true); if (!saved.ok) throw new Error('save rejected');
      const loaded = loadGameSave(storage, saved.save.id);
      expect(loaded?.experienceId === 'backrooms' ? loaded.payload.surface : undefined).toEqual(surface);
    }
    expect(writeGameSave(new MemoryStorage(), backroomsInput()).ok).toBe(true);
  });
  it('round-trips both strict payload variants and exposes compact summaries', () => {
    const storage = new MemoryStorage();
    const russian = writeGameSave(
      storage,
      russianInput(),
      new Date('2026-08-15T10:00:00.000Z'),
    );
    const backrooms = writeGameSave(
      storage,
      {
        ...backroomsInput(),
        previewImage: 'data:image/webp;base64,QUJDRA==',
      },
      new Date('2026-08-15T10:05:00.000Z'),
    );

    expect(russian.ok).toBe(true);
    expect(backrooms.ok).toBe(true);
    if (!russian.ok || !backrooms.ok) throw new Error('Expected valid saves.');

    expect(listGameSaves(storage).map((save) => save.id)).toEqual([
      backrooms.save.id,
      russian.save.id,
    ]);
    const loadedRussian = loadGameSave(storage, russian.save.id);
    expect(loadedRussian).toMatchObject({
      schemaVersion: 2,
      experienceId: 'russian-stairwell',
    });
    expect(loadedRussian?.payload.quaternion.y).toBeCloseTo(Math.SQRT1_2);
    expect(loadedRussian?.payload.quaternion.w).toBeCloseTo(Math.SQRT1_2);
    expect(loadedRussian?.experienceId === 'russian-stairwell'
      ? loadedRussian.payload.apartmentLightOn
      : undefined).toBe(true);
    expect(loadGameSave(storage, backrooms.save.id)).toMatchObject({
      experienceId: 'backrooms',
      payload: {
        seed: 'TEST-SEED_01',
        chunk: { x: -2, z: 7, story: 1 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
      },
    });
    expect(getGameSaveSummary(backrooms.save)).toEqual({
      id: backrooms.save.id,
      experienceId: 'backrooms',
      kind: 'autosave',
      levelId: 'backrooms-level-0',
      levelLabel: 'Niveau 0',
      savedAt: '2026-08-15T10:05:00.000Z',
      playTimeSeconds: 120,
      previewImage: 'data:image/webp;base64,QUJDRA==',
    });
  });

  it('creates collision-safe ids and keeps one current autosave beside manual saves', () => {
    const storage = new MemoryStorage();
    const sameInstant = new Date('2026-08-15T09:00:00.000Z');
    const first = writeGameSave(storage, russianInput(1), sameInstant);
    const second = writeGameSave(storage, russianInput(2), sameInstant);
    expect(first.ok && second.ok && first.save.id).not.toBe(second.ok && second.save.id);

    for (let index = 0; index < GAME_SAVE_HISTORY_LIMIT + 3; index += 1) {
      expect(writeGameSave(
        storage,
        backroomsInput(100 + index),
        new Date(Date.UTC(2026, 7, 15, 10, index)),
      ).ok).toBe(true);
    }

    const saves = listGameSaves(storage);
    expect(saves).toHaveLength(3);
    expect(saves.filter((save) => save.kind === 'autosave')).toHaveLength(1);
    expect(saves.map((save) => save.playTimeSeconds)).toEqual([114, 2, 1]);

    const manualStorage = new MemoryStorage();
    for (let index = 0; index < GAME_SAVE_HISTORY_LIMIT + 3; index += 1) {
      expect(writeGameSave(
        manualStorage,
        russianInput(index),
        new Date(Date.UTC(2026, 7, 16, 10, index)),
      ).ok).toBe(true);
    }
    expect(listGameSaves(manualStorage).map((save) => save.playTimeSeconds)).toEqual(
      Array.from({ length: GAME_SAVE_HISTORY_LIMIT }, (_, index) => 14 - index),
    );
  });

  it('filters corrupt entries, duplicate ids and malformed history envelopes', () => {
    const storage = new MemoryStorage();
    const valid = writeGameSave(
      storage,
      russianInput(),
      new Date('2026-08-15T10:00:00.000Z'),
    );
    if (!valid.ok) throw new Error('Expected valid save.');
    const stored = JSON.parse(storage.values.get(GAME_SAVE_HISTORY_STORAGE_KEY)!) as {
      schemaVersion: number;
      entries: Array<Record<string, unknown>>;
    };
    stored.entries.push(
      { ...stored.entries[0]!, id: 'duplicate-but-newer', savedAt: 'not-a-date' },
      { ...stored.entries[0]!, extra: true },
      { ...stored.entries[0]! },
      { nope: true },
    );
    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, JSON.stringify(stored));

    expect(listGameSaves(storage)).toEqual([valid.save]);

    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, JSON.stringify({
      schemaVersion: GAME_SAVE_HISTORY_SCHEMA_VERSION,
      entries: stored.entries,
      unexpected: true,
    }));
    expect(listGameSaves(storage)).toEqual([]);
    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, '{broken');
    expect(listGameSaves(storage)).toEqual([]);
  });

  it('keeps old stairwell history entries compatible with lights off by default', () => {
    const storage = new MemoryStorage();
    const written = writeGameSave(
      storage,
      russianInput(),
      new Date('2026-08-15T10:00:00.000Z'),
    );
    if (!written.ok) throw new Error('Expected valid save.');
    const history = JSON.parse(storage.getItem(GAME_SAVE_HISTORY_STORAGE_KEY)!) as {
      entries: Array<{ payload: Record<string, unknown> }>;
    };
    delete history.entries[0]!.payload.apartmentLightOn;
    delete history.entries[0]!.payload.windowBlindsOpen;
    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, JSON.stringify(history));

    expect(listGameSaves(storage)[0]?.payload).toMatchObject({
      apartmentLightOn: false,
      windowBlindsOpen: [true, true],
    });
  });

  it('round-trips the two independent apartment blind states', () => {
    const storage = new MemoryStorage();
    const input = russianInput();
    const written = writeGameSave(storage, {
      ...input,
      payload: { ...input.payload, windowBlindsOpen: [false, true] },
    });

    expect(written.ok).toBe(true);
    expect(listGameSaves(storage)[0]?.payload).toMatchObject({
      windowBlindsOpen: [false, true],
    });
  });

  it.each([
    ['extra input field', { ...russianInput(), extra: true }],
    ['unknown kind', { ...russianInput(), kind: 'quick' }],
    ['empty level id', { ...russianInput(), levelId: '' }],
    ['negative play time', { ...russianInput(), playTimeSeconds: -1 }],
    ['invalid preview image', { ...russianInput(), previewImage: 'https://example.com/save.webp' }],
    ['invalid door progress', {
      ...russianInput(),
      payload: { ...russianInput().payload, entranceDoor: { progress: 2, targetProgress: 1 } },
    }],
    ['zero quaternion', {
      ...russianInput(),
      payload: { ...russianInput().payload, quaternion: { x: 0, y: 0, z: 0, w: 0 } },
    }],
    ['unsafe chunk coordinate', {
      ...backroomsInput(),
      payload: {
        ...backroomsInput().payload,
        chunk: { x: Number.MAX_SAFE_INTEGER, z: 0, story: 0 },
      },
    }],
    ['invalid seed', {
      ...backroomsInput(),
      payload: { ...backroomsInput().payload, seed: 'seed with spaces' },
    }],
  ])('rejects an invalid save: %s', (_label, input) => {
    const storage = new MemoryStorage();
    expect(writeGameSave(
      storage,
      input as RussianStairwellGameSaveInput,
      new Date('2026-08-15T10:00:00.000Z'),
    )).toEqual({ ok: false, reason: 'invalid-save' });
    expect(listGameSaves(storage)).toEqual([]);
  });

  it('loads by stable id and removes only the selected entry', () => {
    const storage = new MemoryStorage();
    const first = writeGameSave(storage, russianInput(), new Date('2026-08-15T10:00:00.000Z'));
    const second = writeGameSave(storage, backroomsInput(), new Date('2026-08-15T10:01:00.000Z'));
    if (!first.ok || !second.ok) throw new Error('Expected valid saves.');

    expect(removeGameSave(storage, 'missing')).toEqual({ ok: true, removed: false });
    expect(removeGameSave(storage, first.save.id)).toEqual({ ok: true, removed: true });
    expect(loadGameSave(storage, first.save.id)).toBeNull();
    expect(loadGameSave(storage, second.save.id)).toEqual(second.save);
  });

  it('handles unavailable storage and invalid dates without throwing', () => {
    const throwingStorage: GameSaveStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(listGameSaves(throwingStorage)).toEqual([]);
    expect(writeGameSave(throwingStorage, russianInput())).toEqual({
      ok: false,
      reason: 'storage-error',
    });
    expect(removeGameSave(throwingStorage, 'save-id')).toEqual({
      ok: false,
      reason: 'storage-error',
    });

    const storage = new MemoryStorage();
    expect(writeGameSave(storage, russianInput(), new Date(Number.NaN))).toEqual({
      ok: false,
      reason: 'invalid-save',
    });
  });
});

it('round-trips every mail objective state while preserving old saves and rejecting unknown stages', () => {
  const storage = new MemoryStorage();
  for (const arrivalState of ['approach', 'mail', 'home', 'done'] as const) {
    const input = russianInput();
    const result = writeGameSave(storage, { ...input, payload: { ...input.payload, windowBlindsOpen: [true, false], arrivalState } });
    expect(result.ok).toBe(true);
    if(result.ok) expect(loadGameSave(storage,result.save.id)?.payload).toMatchObject({arrivalState});
  }
  const legacy=writeGameSave(storage,russianInput());expect(legacy.ok).toBe(true);
  if(legacy.ok) expect(loadGameSave(storage,legacy.save.id)?.payload).not.toHaveProperty('arrivalState');
  const invalid={...russianInput(),payload:{...russianInput().payload,windowBlindsOpen:[true,true],arrivalState:'unknown'}};
  expect(writeGameSave(storage,invalid as unknown as RussianStairwellGameSaveInput).ok).toBe(false);
});

it('persists one-time mail/door events, stable actors and neighbour variation without persisting timers',()=>{
 const storage=new MemoryStorage(),base=russianInput();
 const facts={specialDoorConsumed:true,attempts:{'west-neighbor-door-1-leaf':3},voices:{'west-neighbor-door-1-leaf':'karen' as const}};
 const saved=writeGameSave(storage,{...base,payload:{...base.payload,windowBlindsOpen:[true,true],arrivalState:'mail',mailGaspPlayed:true,neighbors:facts}});
 expect(saved.ok).toBe(true);expect(listGameSaves(storage)[0]?.payload).toMatchObject({mailGaspPlayed:true,neighbors:facts});
 const fresh=writeGameSave(storage,{...base,payload:{...base.payload,windowBlindsOpen:[true,true],arrivalState:'approach',mailGaspPlayed:false,neighbors:{specialDoorConsumed:false,attempts:{}}}});
 expect(fresh.ok).toBe(true);if(!fresh.ok)return;
 expect(loadGameSave(storage,fresh.save.id)?.payload).toMatchObject({mailGaspPlayed:false,neighbors:{specialDoorConsumed:false,attempts:{}}});
});
it.each(['approach','mail','home','done'] as const)('migrates the missing gasp flag from an old %s snapshot',arrivalState=>{
 const storage=new MemoryStorage(),base=russianInput();
 writeGameSave(storage,{...base,payload:{...base.payload,windowBlindsOpen:[true,true],arrivalState}});
 const raw=JSON.parse(storage.getItem(GAME_SAVE_HISTORY_STORAGE_KEY)!);delete raw.entries[0].payload.mailGaspPlayed;
 storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY,JSON.stringify(raw));
 expect(listGameSaves(storage)[0]?.payload).toMatchObject({mailGaspPlayed:arrivalState!=='approach'});
});
it('round-trips resident agitation and the last delivered line while rejecting malformed reaction state',()=>{
 const storage=new MemoryStorage(),base=russianInput(),id='west-neighbor-door-1-leaf';
 const neighbors={specialDoorConsumed:false,attempts:{[id]:1000},voices:{[id]:'ian' as const},reactions:{[id]:{annoyance:11.2,cursor:17,lastLine:22}}};
 const input={...base,payload:{...base.payload,windowBlindsOpen:[true,true] as const,arrivalState:'home' as const,neighbors}};
 const result=writeGameSave(storage,input);expect(result.ok).toBe(true);
 if(result.ok)expect(loadGameSave(storage,result.save.id)?.payload).toMatchObject({neighbors});
 for(const bad of [{annoyance:99,cursor:1,lastLine:1},{annoyance:1,cursor:-1,lastLine:1},{annoyance:1,cursor:1,lastLine:1000}]){
  expect(writeGameSave(storage,{...input,payload:{...input.payload,neighbors:{...neighbors,reactions:{[id]:bad}}}}).ok).toBe(false);
 }
});

it('keeps loose object poses, broken residue and independent fixtures in the existing history schema',()=>{
  const storage=new MemoryStorage(),input=russianInput();
  const objects={version:1 as const,bodies:{'prop:chess/pawn':{position:{x:-5,y:9.7,z:0},rotation:{x:0,y:0,z:0,w:1},sleeping:true}},broken:{'prop:flowerpot':{kind:'pot' as const,position:{x:-5,y:9.7,z:0},residuePending:true}},deposits:[{kind:'soil' as const,position:{x:-5,y:9.57,z:0},normal:{x:0,y:1,z:0},radius:.1}]};
  const fixtures={version:1 as const,tapOn:true,waterLevel:.8,fanOn:true,deskLampOn:false,closetDoor:.3};
  const result=writeGameSave(storage,{...input,payload:{...input.payload,objects,fixtures}});expect(result.ok).toBe(true);if(!result.ok)throw Error('Save rejected');
  const loaded=loadGameSave(storage,result.save.id);expect(loaded?.experienceId).toBe('russian-stairwell');if(loaded?.experienceId!=='russian-stairwell')throw Error('Wrong save');
  expect(loaded.payload.objects).toEqual(objects);expect(loaded.payload.fixtures).toEqual(fixtures);
  expect(writeGameSave(storage,{...input,payload:{...input.payload,fixtures:{...fixtures,waterLevel:2}}}).ok).toBe(false);
});
it('keeps old saves readable and round-trips all broken dishes and glass without changing the history key or version',()=>{
  const storage=new MemoryStorage(),input=russianInput();
  const old=writeGameSave(storage,input);expect(old.ok).toBe(true);
  const broken=Object.fromEntries(Array.from({length:24},(_,i)=>[`prop:KitchenStuff/dish-${i}`,{kind:i%2?'glass' as const:'ceramic' as const,position:{x:-5,y:9.4,z:0}}]));
  const objects={version:1 as const,bodies:{},broken,deposits:[]};
  const written=writeGameSave(storage,{...input,kind:'manual',payload:{...input.payload,objects}});expect(written.ok).toBe(true);
  if(written.ok){const loaded=loadGameSave(storage,written.save.id);expect(loaded?.payload).toMatchObject({objects});}
  if(old.ok)expect(loadGameSave(storage,old.save.id)).not.toBeNull();
});
it('restores PC transition recovery and accepts an already-consumed version-43 outage without replaying it',()=>{
  const storage=new MemoryStorage(),input=russianInput(),quest=new ApartmentQuest();quest.reachHome();quest.setLight(true);quest.setGas(true);quest.setTelevision(true);quest.setRadio(true);quest.readMail(RENT_MAIL_ID);quest.checkBank();quest.finishGame('lost');quest.nextThought();quest.advanceNarration(.75,false);
  const pcUse={version:1 as const,phase:'sitting' as const,safePosition:{x:-6.36,y:9.5363203,z:-4.3},chairOffset:.35};
  const result=writeGameSave(storage,{...input,payload:{...input.payload,computer:quest.snapshot(),pcUse}});expect(result.ok).toBe(true);if(!result.ok)throw Error('Save failed');const saved=loadGameSave(storage,result.save.id);
  expect(saved?.experienceId==='russian-stairwell'&&saved.payload.pcUse).toEqual(pcUse);
  reachPowerCut(quest);const legacy=quest.snapshot();legacy.apartment!.outageLeadSeconds=1.12;
  const old=writeGameSave(storage,{...input,payload:{...input.payload,computer:legacy}});expect(old.ok).toBe(true);const restored=new ApartmentQuest(legacy);expect(restored.isComputerBlocked).toBe(true);expect(restored.advanceOutage(gasOrigin,gasTarget,true)).toBe(false);
});
