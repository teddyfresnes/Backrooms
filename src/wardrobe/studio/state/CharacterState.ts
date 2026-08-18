import { create } from 'zustand'
import { MORPHS, morphDefaults } from '../core/morphs'
import {
  clampMorphValue,
  estimatedWeightKg,
  footMorphFromShoeSizeEu,
  genderMorphForSex,
  handLengthCmFromMorph,
  handMorphFromLengthCm,
  heightBoundsCm,
  heightCmFromMorph,
  heightMorphFromCm,
  sanitizeSkinTone,
  sexFromGenderMorph,
  shoeSizeBoundsEu,
  shoeSizeEuFromMorph,
  weightMorphFromKg,
  type BiologicalSex,
} from '../core/humanMeasurements'
import type { CharacterConfig, ClothingSlot, MorphSection } from '../core/types'
import { makeDefaultCharacter } from './defaults'

const AUTOSAVE_KEY = 'character-studio/current/v4'
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const DEFS_BY_KEY = new Map(MORPHS.map((definition) => [definition.key, definition]))
const LEGACY_HAIR_IDS: Readonly<Record<string, string>> = {
  'hair-short': 'mh-hair-cortu_short_messy_hair',
  'hair-crop': 'mh-hair-culturalibre_hair_02',
  // Removed in v14.18; keep old Custom/autosave characters from becoming bald.
  'mh-hair-learning_anime_hair': 'mh-hair-cortu_short_messy_hair',
}
const LEGACY_CLOTHING_IDS: Readonly<Record<string, string>> = {
  'top-tshirt': 'mh-top-toigo_basic_tucked_t-shirt',
  'top-hoodie': 'mh-top-elvs_male_boho_top1',
  'top-jacket': 'mh-top-mindfront_knitted_sweater_01',
  'top-shirt': 'mh-top-namuhekam_male_polo_shirt',
  'bottom-pants': 'mh-bottom-cortu_cargo_pants',
  'bottom-jeans': 'mh-bottom-punkduck_male_classic_jeans',
  'bottom-cargo': 'mh-bottom-cortu_cargo_pants',
  'bottom-shorts': 'mh-bottom-cortu_jeans_shorts',
  'shoes-sneakers': 'mh-shoes-toigo_mj_cloth_shoes',
  'shoes-boots': 'mh-shoes-culturalibre_male_boots',
  'shoes-mpfb-socks': 'mh-shoes-toigo_mj_cloth_shoes',
  // Hero/Heroine boots were intentionally removed from the catalogue. Migrate
  // saved characters instead of leaving an invalid footwear id behind.
  'mh-shoes-culturalibre_hero_boots_1': 'mh-shoes-toigo_mj_cloth_shoes',
  'mh-shoes-culturalibre_hero_boots_2': 'mh-shoes-toigo_mj_cloth_shoes',
  'mh-shoes-culturalibre_hero_boots_3': 'mh-shoes-toigo_mj_cloth_shoes',
  'mh-shoes-culturalibre_hero_boots_4': 'mh-shoes-toigo_mj_cloth_shoes',
  'mh-shoes-culturalibre_hero_boots_5': 'mh-shoes-toigo_mj_cloth_shoes',
  'mh-shoes-culturalibre_heroine_boots_1': 'mh-shoes-toigo_flats',
  'mh-shoes-culturalibre_heroine_boots_2': 'mh-shoes-toigo_flats',
  'mh-shoes-culturalibre_heroine_boots_3': 'mh-shoes-toigo_flats',
  'mh-shoes-culturalibre_heroine_boots_4': 'mh-shoes-toigo_flats',
}

interface EditorState {
  config: CharacterConfig
  cameraResetToken: number
  setMorph: (section: 'body' | 'face', key: string, value: number) => void
  setSex: (sex: BiologicalSex) => void
  setName: (name: string) => void
  setIdentity: (id: string, name: string, updatedAt?: number) => void
  restoreConfig: (config: CharacterConfig) => void
  commitSnapshot: () => void
  setAppearance: <K extends keyof CharacterConfig['appearance']>(key: K, value: CharacterConfig['appearance'][K]) => void
  setHair: (hairId: string | null) => void
  setWardrobe: (slot: ClothingSlot, assetId: string | null) => void
  setWardrobeColor: (slot: ClothingSlot, color: string) => void
  toggleAccessory: (assetId: string) => void
  replaceConfig: (config: CharacterConfig) => void
  resetCamera: () => void
  addAssetError: (message: string) => void
}

function safeSection(section: MorphSection, source: Record<string, number> | undefined) {
  const defaults = morphDefaults(section)
  const merged = { ...defaults, ...(source ?? {}) }
  const output: Record<string, number> = {}
  for (const def of MORPHS.filter((item) => item.section === section)) {
    output[def.key] = clampMorphValue(def, Number(merged[def.key]))
  }
  return output
}

function safeBody(source: Record<string, number> | undefined) {
  const body = safeSection('body', source)
  body.gender = genderMorphForSex(sexFromGenderMorph(body.gender))
  const gender = body.gender

  const heightBounds = heightBoundsCm(gender)
  const heightCm = clamp(heightCmFromMorph(body.height, gender), heightBounds.min, heightBounds.max)
  body.height = heightMorphFromCm(heightCm, gender)

  const shoeBounds = shoeSizeBoundsEu(gender)
  const shoe = clamp(shoeSizeEuFromMorph(body.feet, gender), shoeBounds.min, shoeBounds.max)
  body.feet = footMorphFromShoeSizeEu(shoe, gender)
  body.hands = handMorphFromLengthCm(handLengthCmFromMorph(body.hands, gender), gender)

  // Presets can carry hidden MakeHuman phenotype weights. They are not editor
  // sliders, but they must survive normalizeConfig()/setSex() so Asian presets
  // do not silently snap back to the Caucasian macro corner.
  body.raceAsian = clamp(Number(source?.raceAsian ?? 0), 0, 1)
  body.raceAfrican = clamp(Number(source?.raceAfrican ?? 0), 0, 1)
  const raceTotal = body.raceAsian + body.raceAfrican
  if (raceTotal > 1) {
    body.raceAsian /= raceTotal
    body.raceAfrican /= raceTotal
  }
  return body
}

function normalizeConfig(saved: CharacterConfig): CharacterConfig {
  const defaults = makeDefaultCharacter()
  return {
    ...defaults,
    ...saved,
    baseAssetId: 'makehuman-hm08',
    body: safeBody(saved.body),
    face: safeSection('face', saved.face),
    appearance: {
      ...defaults.appearance,
      ...(saved.appearance ?? {}),
      hairId: saved.appearance?.hairId
        ? (LEGACY_HAIR_IDS[saved.appearance.hairId] ?? saved.appearance.hairId)
        : defaults.appearance.hairId,
      hairMaterialId: saved.appearance?.hairMaterialId ?? null,
      skinColor: sanitizeSkinTone(saved.appearance?.skinColor),
      skinMaterialId: saved.appearance?.skinMaterialId ?? null,
      eyebrowsId: saved.appearance?.eyebrowsId ?? defaults.appearance.eyebrowsId,
      eyelashesId: saved.appearance?.eyelashesId ?? defaults.appearance.eyelashesId,
    },
    wardrobe: {
      ...defaults.wardrobe,
      ...(saved.wardrobe ?? {}),
      top: saved.wardrobe?.top ? (LEGACY_CLOTHING_IDS[saved.wardrobe.top] ?? saved.wardrobe.top) : defaults.wardrobe.top,
      bottom: saved.wardrobe?.bottom ? (LEGACY_CLOTHING_IDS[saved.wardrobe.bottom] ?? saved.wardrobe.bottom) : defaults.wardrobe.bottom,
      shoes: saved.wardrobe?.shoes ? (LEGACY_CLOTHING_IDS[saved.wardrobe.shoes] ?? saved.wardrobe.shoes) : defaults.wardrobe.shoes,
      colors: { ...defaults.wardrobe.colors, ...(saved.wardrobe?.colors ?? {}) },
    },
    // Accessories/chapeaux are intentionally out of the current wardrobe UI.
    // Do not resurrect old hidden accessories from previous development saves.
    accessories: [],
    updatedAt: Date.now(),
  }
}

function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    return raw ? normalizeConfig(JSON.parse(raw) as CharacterConfig) : null
  } catch {
    return null
  }
}

const updated = (config: CharacterConfig): CharacterConfig => ({ ...config, updatedAt: Date.now() })

export const useCharacterState = create<EditorState>((set, get) => ({
  config: readAutosave() ?? makeDefaultCharacter(),
  cameraResetToken: 0,
  commitSnapshot: () => {},
  setName: (name) => set((state) => ({ config: updated({ ...state.config, name: name.slice(0, 32) }) })),
  // Identity-only updates deliberately preserve the existing body/face/object
  // references. Promoting a preset to Custom must not be mistaken for a body
  // morph, otherwise the rig is recalibrated while a new hair mesh is mounting.
  setIdentity: (id, name, updatedAt = Date.now()) => set((state) => ({
    config: { ...state.config, id, name: name.slice(0, 32), updatedAt },
  })),
  // Used when cancelling the first Custom edit. The supplied config already
  // comes from the normalized live store, so restoring it directly avoids an
  // unnecessary normalize/clone/remorph cycle for appearance-only edits.
  restoreConfig: (config) => set({ config }),
  setMorph: (section, key, value) => {
    const def = DEFS_BY_KEY.get(key)
    if (!def || def.section !== section) return
    set((state) => ({ config: updated({ ...state.config, [section]: { ...state.config[section], [key]: clampMorphValue(def, value) } }) }))
  },
  setSex: (sex) => {
    const current = get().config
    const oldBody = current.body
    const oldGender = oldBody.gender ?? -1
    const oldHeightCm = heightCmFromMorph(oldBody.height ?? 0, oldGender)
    const oldWeightKg = estimatedWeightKg(oldBody.weight ?? 0, oldHeightCm)
    const oldShoe = shoeSizeEuFromMorph(oldBody.feet ?? 0, oldGender)
    const oldHand = handLengthCmFromMorph(oldBody.hands ?? 0, oldGender)
    const gender = genderMorphForSex(sex)
    const newHeight = heightMorphFromCm(oldHeightCm, gender)
    const newHeightCm = heightCmFromMorph(newHeight, gender)
    const body = safeBody({
      ...oldBody,
      gender,
      height: newHeight,
      weight: weightMorphFromKg(oldWeightKg, newHeightCm),
      feet: footMorphFromShoeSizeEu(oldShoe, gender),
      hands: handMorphFromLengthCm(oldHand, gender),
    })
    set({ config: updated({ ...current, body }) })
  },
  setAppearance: (key, value) => set((state) => ({
    config: updated({
      ...state.config,
      appearance: { ...state.config.appearance, [key]: key === 'skinColor' ? sanitizeSkinTone(String(value)) : value },
    }),
  })),
  // Hair id + material reset are one atomic store update. The old UI performed
  // two consecutive updates, briefly rendering a new mesh with the previous
  // hair material and making rapid changes much harder to reason about.
  setHair: (hairId) => set((state) => ({
    config: updated({
      ...state.config,
      appearance: { ...state.config.appearance, hairId, hairMaterialId: null },
    }),
  })),
  setWardrobe: (slot, assetId) => set((state) => ({ config: updated({ ...state.config, wardrobe: { ...state.config.wardrobe, [slot]: assetId } }) })),
  setWardrobeColor: (slot, color) => set((state) => ({ config: updated({ ...state.config, wardrobe: { ...state.config.wardrobe, colors: { ...state.config.wardrobe.colors, [slot]: color } } }) })),
  toggleAccessory: (assetId) => set((state) => ({
    config: updated({
      ...state.config,
      accessories: state.config.accessories.includes(assetId)
        ? state.config.accessories.filter((id) => id !== assetId)
        : [...state.config.accessories, assetId],
    }),
  })),
  replaceConfig: (config) => set({ config: normalizeConfig(structuredClone(config)) }),
  resetCamera: () => set((state) => ({ cameraResetToken: state.cameraResetToken + 1 })),
  addAssetError: (message) => { console.warn(`[wardrobe] ${message}`) },
}))

let autosaveTimer: number | undefined
useCharacterState.subscribe((state) => {
  window.clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.config)) } catch { /* quota/private mode */ }
  }, 250)
})
