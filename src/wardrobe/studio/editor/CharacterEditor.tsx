import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AssetLibrary, useAssetLibrary } from '../assets/AssetLibrary'
import { MORPHS } from '../core/morphs'
import { morphUiModel, sexFromGenderMorph } from '../core/humanMeasurements'
import type { AssetDefinition, ClothingSlot, MaterialVariantDefinition, MorphSection } from '../core/types'
import { useCharacterState } from '../state/CharacterState'
import { EditorViewport } from '../viewport/EditorViewport'
import { loadMhcloAsset } from '../makehuman/MhcloRuntime'
import { loadMhmat } from '../makehuman/MhmatRuntime'
import { ColorSwatches } from '../ui/components/ColorSwatches'
import { MorphPad } from '../ui/components/MorphPad'
import { CHARACTER_OPTIONS, type CharacterOption } from './characterOptions'
import { PresetThumbnailGenerator } from './PresetThumbnailGenerator'

const EYES = ['#6c8da8', '#5f7d55', '#7a5a42', '#3c4a57', '#2d2622']

const CUSTOM_CHARACTER_KEY = 'backrooms/wardrobe/custom-character/v1'
const CUSTOM_PREVIEW_KEY = 'backrooms/wardrobe/custom-preview/v1'
const CUSTOM_PREVIEW_STAMP_KEY = 'backrooms/wardrobe/custom-preview-stamp/v1'

interface StoredCustomCharacter {
  config: import('../core/types').CharacterConfig
  sourcePresetId: string | null
}

function readCustomCharacter(): StoredCustomCharacter | null {
  try {
    const raw = localStorage.getItem(CUSTOM_CHARACTER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCustomCharacter
    return parsed?.config ? parsed : null
  } catch { return null }
}

function writeCustomCharacter(value: StoredCustomCharacter | null) {
  try {
    if (!value) localStorage.removeItem(CUSTOM_CHARACTER_KEY)
    else localStorage.setItem(CUSTOM_CHARACTER_KEY, JSON.stringify(value))
  } catch { /* storage unavailable */ }
}

function readCustomPreview() {
  try { return localStorage.getItem(CUSTOM_PREVIEW_KEY) ?? '' } catch { return '' }
}

function writeCustomPreview(dataUrl: string, updatedAt: number) {
  try {
    localStorage.setItem(CUSTOM_PREVIEW_KEY, dataUrl)
    localStorage.setItem(CUSTOM_PREVIEW_STAMP_KEY, String(updatedAt))
  } catch { /* storage unavailable */ }
}

function customPreviewMatches(config: import('../core/types').CharacterConfig | undefined) {
  if (!config) return false
  try { return localStorage.getItem(CUSTOM_PREVIEW_STAMP_KEY) === String(config.updatedAt) && Boolean(localStorage.getItem(CUSTOM_PREVIEW_KEY)) } catch { return false }
}
export type WardrobeScreen = 'select' | 'edit'

export interface WardrobeNavigationBridge {
  back?: () => boolean
  reset?: () => void
  screen?: WardrobeScreen
}

type SimpleCategory = 'general' | 'skin' | 'eyes' | 'hair' | 'eyebrows' | 'eyelashes' | 'top' | 'bottom' | 'shoes'
type AdvancedCategory =
  | 'head' | 'nose' | 'mouth' | 'jaw' | 'cheeks' | 'chin' | 'forehead' | 'brows' | 'ears'
  | 'breast' | 'shoulders' | 'torso' | 'stomach' | 'waist' | 'hips' | 'buttocks'
  | 'arms' | 'legs' | 'hands' | 'feet' | 'neck'
type EditorCategory = SimpleCategory | AdvancedCategory

const SIMPLE_CATEGORIES: Array<{ id: SimpleCategory; label: string }> = [
  { id: 'general', label: 'Général' },
  { id: 'skin', label: 'Peau' },
  { id: 'eyes', label: 'Yeux' },
  { id: 'hair', label: 'Coiffure' },
  { id: 'eyebrows', label: 'Sourcils' },
  { id: 'eyelashes', label: 'Cils' },
  { id: 'top', label: 'Haut' },
  { id: 'bottom', label: 'Bas' },
  { id: 'shoes', label: 'Chaussures' },
]

const ADVANCED_CATEGORIES: Array<{ id: AdvancedCategory; label: string }> = [
  { id: 'head', label: 'Tête' },
  { id: 'nose', label: 'Nez' },
  { id: 'mouth', label: 'Bouche' },
  { id: 'jaw', label: 'Mâchoire' },
  { id: 'cheeks', label: 'Joues' },
  { id: 'chin', label: 'Menton' },
  { id: 'forehead', label: 'Front' },
  { id: 'brows', label: 'Sourcils' },
  { id: 'ears', label: 'Oreilles' },
  { id: 'breast', label: 'Poitrine' },
  { id: 'shoulders', label: 'Épaules' },
  { id: 'torso', label: 'Torse' },
  { id: 'stomach', label: 'Ventre' },
  { id: 'waist', label: 'Taille' },
  { id: 'hips', label: 'Hanches' },
  { id: 'buttocks', label: 'Fesses' },
  { id: 'arms', label: 'Bras' },
  { id: 'legs', label: 'Jambes' },
  { id: 'hands', label: 'Mains' },
  { id: 'feet', label: 'Pieds' },
  { id: 'neck', label: 'Cou' },
]

function ChoiceThumb({ option }: { option: (typeof CHARACTER_OPTIONS)[number] }) {
  return <span className="choice-thumb ready">
    <img src={option.previewImage} alt="" loading="lazy" decoding="async" draggable={false} />
  </span>
}

function AssetButtons({ assets, selected, onSelect, allowNone = false }: { assets: AssetDefinition[]; selected: string | null; onSelect: (id: string | null) => void; allowNone?: boolean }) {
  return <div className="simple-assets">
    {allowNone && <button type="button" className={selected === null ? 'selected' : ''} onClick={() => onSelect(null)}><span className="empty-asset" /><small>Aucun</small></button>}
    {assets.map((asset) => <button key={asset.id} type="button" className={selected === asset.id ? 'selected' : ''} onClick={() => onSelect(asset.id)}>
      <span className="simple-asset-thumb">{asset.thumbnail ? <img src={asset.thumbnail} alt="" loading="lazy" decoding="async" /> : null}</span>
      <small>{asset.label}</small>
    </button>)}
  </div>
}

function MaterialButtons({ materials, selected, onSelect, originalLabel = 'Originale' }: { materials: MaterialVariantDefinition[]; selected: string | null; onSelect: (id: string | null) => void; originalLabel?: string }) {
  return <div className="simple-assets material-assets">
    <button type="button" className={selected === null ? 'selected' : ''} onClick={() => onSelect(null)}><span className="empty-asset material-original" /><small>{originalLabel}</small></button>
    {materials.map((material) => <button key={material.id} type="button" className={selected === material.id ? 'selected' : ''} onClick={() => onSelect(material.id)}>
      <span className="simple-asset-thumb">{material.thumbnail ? <img src={material.thumbnail} alt="" loading="lazy" decoding="async" /> : null}</span>
      <small>{material.label}</small>
    </button>)}
  </div>
}

function ClothingCategory({ title, slot, assets }: { title: string; slot: ClothingSlot; assets: AssetDefinition[] }) {
  const wardrobe = useCharacterState((s) => s.config.wardrobe)
  const setWardrobe = useCharacterState((s) => s.setWardrobe)
  const setWardrobeColor = useCharacterState((s) => s.setWardrobeColor)
  const selected = wardrobe[slot]
  const selectedAsset = assets.find((asset) => asset.id === selected)
  return <div className="simple-content">
    <h3>{title}</h3>
    <AssetButtons assets={assets} selected={selected} onSelect={(id) => { if (id) setWardrobe(slot, id) }} />
    {selectedAsset?.colors?.length ? <ColorSwatches colors={selectedAsset.colors} value={wardrobe.colors[slot] ?? selectedAsset.colors[0]} onChange={(color) => setWardrobeColor(slot, color)} /> : null}
  </div>
}

function CompactSlider({ morphKey, section = 'body' }: { morphKey: string; section?: MorphSection }) {
  const config = useCharacterState((s) => s.config)
  const setMorph = useCharacterState((s) => s.setMorph)
  const commitSnapshot = useCharacterState((s) => s.commitSnapshot)
  const def = MORPHS.find((morph) => morph.section === section && morph.key === morphKey)
  if (!def) return null
  const ui = morphUiModel(def, config[section][morphKey] ?? def.default, config.body)
  return <label className="compact-slider">
    <span><b>{def.label}</b><output>{ui.valueLabel}</output></span>
    <input type="range" min={ui.min} max={ui.max} step={ui.step} value={ui.value} onPointerDown={commitSnapshot} onChange={(event) => setMorph(section, morphKey, ui.toMorph(Number(event.target.value)))} />
  </label>
}

interface PadProps {
  title: string
  section?: MorphSection
  xKey: string
  yKey: string
  xStart: string
  xEnd: string
  yStart: string
  yEnd: string
}

function MorphPadControl({ title, section = 'face', xKey, yKey, xStart, xEnd, yStart, yEnd }: PadProps) {
  const config = useCharacterState((s) => s.config)
  const setMorph = useCharacterState((s) => s.setMorph)
  const commitSnapshot = useCharacterState((s) => s.commitSnapshot)
  const x = MORPHS.find((morph) => morph.section === section && morph.key === xKey)
  const y = MORPHS.find((morph) => morph.section === section && morph.key === yKey)
  if (!x || !y) return null
  return <MorphPad
    title={title}
    x={config[section][xKey] ?? x.default}
    y={config[section][yKey] ?? y.default}
    xMin={x.min} xMax={x.max} yMin={y.min} yMax={y.max}
    xStart={xStart} xEnd={xEnd} yStart={yStart} yEnd={yEnd}
    onBegin={commitSnapshot}
    onChange={(xValue, yValue) => { setMorph(section, xKey, xValue); setMorph(section, yKey, yValue) }}
  />
}

function PadGrid({ children }: { children: ReactNode }) {
  return <div className="face-pad-grid">{children}</div>
}

function GeneralEditor() {
  const body = useCharacterState((s) => s.config.body)
  const name = useCharacterState((s) => s.config.name)
  const setName = useCharacterState((s) => s.setName)
  const setSex = useCharacterState((s) => s.setSex)
  const sex = sexFromGenderMorph(body.gender)
  return <div className="simple-content">
    <h3>Général</h3>
    <label className="character-name-field">
      <span>Nom du personnage</span>
      <input type="text" maxLength={32} value={name} placeholder="Custom" onChange={(event) => setName(event.target.value)} />
    </label>
    <div className="sex-row">
      <button type="button" className={sex === 'female' ? 'selected' : ''} onClick={() => setSex('female')}>Femme</button>
      <button type="button" className={sex === 'male' ? 'selected' : ''} onClick={() => setSex('male')}>Homme</button>
    </div>
    {['age', 'height', 'weight', 'muscle', 'bodyFat', 'proportions'].map((key) => <CompactSlider key={key} morphKey={key} />)}
  </div>
}

function HairEditor() {
  const { manifest } = useAssetLibrary()
  const appearance = useCharacterState((s) => s.config.appearance)
  const setHair = useCharacterState((s) => s.setHair)
  const setAppearance = useCharacterState((s) => s.setAppearance)
  const addAssetError = useCharacterState((s) => s.addAssetError)
  const requestRef = useRef(0)
  const [loadingHairId, setLoadingHairId] = useState<string | null>(null)

  if (!manifest) return null
  const selectedHair = manifest.hair.find((asset) => asset.id === appearance.hairId)
  const loadingHair = manifest.hair.find((asset) => asset.id === loadingHairId)

  const selectHair = async (id: string | null) => {
    const request = ++requestRef.current
    if (!id) {
      setLoadingHairId(null)
      setHair(null)
      return
    }

    const asset = manifest.hair.find((item) => item.id === id)
    if (!asset) return
    setLoadingHairId(id)

    try {
      // Keep the currently visible hairstyle untouched until every source file
      // and its default MHMAT/textures are actually ready. Only then commit the
      // new id to Zustand. This turns hair selection into an atomic swap and
      // prevents suspended/stale hair renders from touching the live character.
      if (asset.sourceType === 'mhclo' && asset.mhcloUrl && asset.objUrl) {
        const source = await loadMhcloAsset(asset.mhcloUrl, asset.objUrl)
        if (source.materialUrl) await loadMhmat(source.materialUrl)
      } else if (asset.url) {
        const response = await fetch(asset.url, { cache: 'force-cache' })
        if (!response.ok) throw new Error(`Coiffure indisponible (${response.status})`)
        await response.arrayBuffer()
      }
      if (request !== requestRef.current) return
      setHair(id)
    } catch (error) {
      if (request !== requestRef.current) return
      addAssetError(`Coiffure ${asset.label}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (request === requestRef.current) setLoadingHairId(null)
    }
  }

  return <div className="simple-content">
    <h3>Coiffure</h3>
    {loadingHair ? <div className="hair-swap-status" aria-live="polite">Chargement de {loadingHair.label}…</div> : null}
    <AssetButtons assets={manifest.hair} selected={appearance.hairId} onSelect={(id) => { void selectHair(id) }} allowNone />
    {selectedHair?.materials?.length ? <><h4>Texture</h4><MaterialButtons materials={selectedHair.materials} selected={appearance.hairMaterialId} onSelect={(id) => setAppearance('hairMaterialId', id)} /></> : null}
  </div>
}

function EyeEditor({ advanced }: { advanced: boolean }) {
  const appearance = useCharacterState((s) => s.config.appearance)
  const setAppearance = useCharacterState((s) => s.setAppearance)
  return <div className="simple-content">
    <h3>Yeux</h3>
    <ColorSwatches colors={EYES} value={appearance.eyeColor} onChange={(value) => setAppearance('eyeColor', value)} />
    {advanced ? <div className="advanced-inline">
      <PadGrid>
        <MorphPadControl title="Position" xKey="eyeSpacing" yKey="eyeHeight" xStart="rapprochés" xEnd="écartés" yStart="bas" yEnd="haut" />
        <MorphPadControl title="Forme" xKey="eyeSize" yKey="eyeFold" xStart="petits" xEnd="grands" yStart="concave" yEnd="convexe" />
        <MorphPadControl title="Ouverture" xKey="eyeInnerHeight" yKey="eyeOuterHeight" xStart="interne −" xEnd="interne +" yStart="externe −" yEnd="externe +" />
        <MorphPadControl title="Contour" xKey="epicanthus" yKey="eyeBags" xStart="pli +" xEnd="pli −" yStart="lisse" yEnd="poches" />
      </PadGrid>
      <CompactSlider morphKey="eyeBagHeight" section="face" />
    </div> : null}
  </div>
}

function SimpleEditor({ category, advanced }: { category: SimpleCategory; advanced: boolean }) {
  const { manifest } = useAssetLibrary()
  const appearance = useCharacterState((s) => s.config.appearance)
  const setAppearance = useCharacterState((s) => s.setAppearance)
  if (!manifest) return null
  if (category === 'general') return <GeneralEditor />
  if (category === 'skin') return <div className="simple-content"><h3>Peau</h3><MaterialButtons materials={manifest.skins} selected={appearance.skinMaterialId} originalLabel="Standard" onSelect={(id) => setAppearance('skinMaterialId', id)} /></div>
  if (category === 'eyes') return <EyeEditor advanced={advanced} />
  if (category === 'hair') return <HairEditor />
  if (category === 'eyebrows') return <div className="simple-content"><h3>Sourcils</h3><AssetButtons assets={manifest.eyebrows ?? []} selected={appearance.eyebrowsId} onSelect={(id) => setAppearance('eyebrowsId', id)} allowNone /></div>
  if (category === 'eyelashes') return <div className="simple-content"><h3>Cils</h3><AssetButtons assets={manifest.eyelashes ?? []} selected={appearance.eyelashesId} onSelect={(id) => setAppearance('eyelashesId', id)} allowNone /></div>
  if (category === 'top') return <ClothingCategory title="Haut" slot="top" assets={manifest.clothes.tops} />
  if (category === 'bottom') return <ClothingCategory title="Bas" slot="bottom" assets={manifest.clothes.bottoms} />
  return <ClothingCategory title="Chaussures" slot="shoes" assets={manifest.clothes.shoes} />
}

function AdvancedEditor({ category }: { category: AdvancedCategory }) {
  const sex = sexFromGenderMorph(useCharacterState((s) => s.config.body.gender))
  if (category === 'head') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Dimensions" xKey="headWidth" yKey="headHeight" xStart="étroite" xEnd="large" yStart="basse" yEnd="haute" />
      <MorphPadControl title="Profil" xKey="headDepth" yKey="headBackDepth" xStart="plat" xEnd="profond" yStart="arrière −" yEnd="arrière +" />
    </PadGrid>
    <CompactSlider morphKey="faceShape" section="face" /><CompactSlider morphKey="headFat" section="face" />
  </div>
  if (category === 'nose') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Dimensions" xKey="noseWidth" yKey="noseLength" xStart="fin" xEnd="large" yStart="rentré" yEnd="projeté" />
      <MorphPadControl title="Pointe" xKey="noseTipWidth" yKey="noseTip" xStart="fine" xEnd="large" yStart="bas" yEnd="haut" />
      <MorphPadControl title="Narines" xKey="nostrilWidth" yKey="nostrilAngle" xStart="serrées" xEnd="larges" yStart="bas" yEnd="haut" />
      <MorphPadControl title="Profil" xKey="noseCurve" yKey="noseHump" xStart="concave" xEnd="convexe" yStart="lisse" yEnd="bosse" />
    </PadGrid>
    <CompactSlider morphKey="noseHeight" section="face" /><CompactSlider morphKey="noseSize" section="face" /><CompactSlider morphKey="noseFlare" section="face" /><CompactSlider morphKey="noseCompression" section="face" />
  </div>
  if (category === 'mouth') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Dimensions" xKey="mouthWidth" yKey="mouthHeight" xStart="étroite" xEnd="large" yStart="fine" yEnd="haute" />
      <MorphPadControl title="Position" xKey="mouthProjection" yKey="mouthPosition" xStart="rentrée" xEnd="projetée" yStart="bas" yEnd="haut" />
      <MorphPadControl title="Lèvres" xKey="upperLipVolume" yKey="lowerLipVolume" xStart="haute −" xEnd="haute +" yStart="basse −" yEnd="basse +" />
      <MorphPadControl title="Arc" xKey="cupidBowWidth" yKey="cupidBow" xStart="étroit" xEnd="large" yStart="doux" yEnd="marqué" />
    </PadGrid>
    <CompactSlider morphKey="upperLipHeight" section="face" /><CompactSlider morphKey="lowerLipHeight" section="face" /><CompactSlider morphKey="mouthCorners" section="face" /><CompactSlider morphKey="philtrum" section="face" /><CompactSlider morphKey="dimples" section="face" />
  </div>
  if (category === 'jaw') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Mâchoire" xKey="jaw" yKey="jawProjection" xStart="étroite" xEnd="large" yStart="rentrée" yEnd="avancée" /></PadGrid>
    <CompactSlider morphKey="jawHeight" section="face" />
  </div>
  if (category === 'cheeks') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Volume" xKey="cheekbones" yKey="cheekVolume" xStart="pommettes −" xEnd="pommettes +" yStart="creuses" yEnd="pleines" />
      <MorphPadControl title="Placement" xKey="cheekInner" yKey="cheekHeight" xStart="ouvert" xEnd="creusé" yStart="bas" yEnd="haut" />
    </PadGrid>
  </div>
  if (category === 'chin') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Menton" xKey="chin" yKey="chinHeight" xStart="rentré" xEnd="projeté" yStart="court" yEnd="haut" />
      <MorphPadControl title="Structure" xKey="chinBones" yKey="chinCleft" xStart="doux" xEnd="osseux" yStart="lisse" yEnd="fossette" />
    </PadGrid>
  </div>
  if (category === 'forehead') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Front" xKey="foreheadProjection" yKey="forehead" xStart="rentré" xEnd="projeté" yStart="bas" yEnd="haut" />
      <MorphPadControl title="Forme" xKey="foreheadTemple" yKey="foreheadNubian" xStart="tempes −" xEnd="tempes +" yStart="courbe −" yEnd="courbe +" />
    </PadGrid>
  </div>
  if (category === 'brows') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Sourcils" xKey="browProjection" yKey="brows" xStart="rentrés" xEnd="projetés" yStart="bas" yEnd="haut" /></PadGrid>
    <CompactSlider morphKey="browAngle" section="face" />
  </div>
  if (category === 'ears') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Dimensions" xKey="earDepth" yKey="earHeight" xStart="plates" xEnd="profondes" yStart="basses" yEnd="hautes" />
      <MorphPadControl title="Pavillon" xKey="earWing" yKey="earFlap" xStart="collé" xEnd="décollé" yStart="fin" yEnd="marqué" />
    </PadGrid>
    <CompactSlider morphKey="ears" section="face" /><CompactSlider morphKey="earLobe" section="face" /><CompactSlider morphKey="earRotation" section="face" />
  </div>
  if (category === 'breast') return <div className="advanced-content">
    {sex === 'female' ? <>
      <PadGrid>
        <MorphPadControl title="Seins" section="body" xKey="breastSize" yKey="breastFirmness" xStart="petits" xEnd="grands" yStart="souples" yEnd="fermes" />
        <MorphPadControl title="Placement" section="body" xKey="breastSeparation" yKey="breastHeight" xStart="rapprochés" xEnd="écartés" yStart="bas" yEnd="haut" />
      </PadGrid>
      <CompactSlider morphKey="breastProjection" /><CompactSlider morphKey="breastVerticalShape" />
    </> : null}
    <CompactSlider morphKey="bustCirc" /><CompactSlider morphKey="underBust" /><CompactSlider morphKey="pectoralMuscle" />
  </div>
  if (category === 'shoulders') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Épaules" section="body" xKey="shoulders" yKey="shoulderMuscle" xStart="étroites" xEnd="larges" yStart="fines" yEnd="musclées" /></PadGrid>
  </div>
  if (category === 'torso') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Dimensions" section="body" xKey="torsoWidth" yKey="chest" xStart="étroit" xEnd="large" yStart="plat" yEnd="profond" />
      <MorphPadControl title="Muscles" section="body" xKey="pectoralMuscle" yKey="backMuscle" xStart="pectoraux −" xEnd="pectoraux +" yStart="dos −" yEnd="dos +" />
    </PadGrid>
    <CompactSlider morphKey="torsoHeight" /><CompactSlider morphKey="torsoVShape" /><CompactSlider morphKey="frontChest" />
  </div>
  if (category === 'stomach') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Ventre" section="body" xKey="bellyProjection" yKey="stomachTone" xStart="plat" xEnd="projeté" yStart="souple" yEnd="tonique" /></PadGrid>
  </div>
  if (category === 'waist') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Taille" section="body" xKey="waist" yKey="waistHeight" xStart="fine" xEnd="large" yStart="basse" yEnd="haute" /></PadGrid>
  </div>
  if (category === 'hips') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Hanches" section="body" xKey="hips" yKey="hipDepth" xStart="étroites" xEnd="larges" yStart="plates" yEnd="profondes" /></PadGrid>
    <CompactSlider morphKey="hipHeight" />
  </div>
  if (category === 'buttocks') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Fesses" section="body" xKey="buttocks" yKey="pelvisTone" xStart="petites" xEnd="volumineuses" yStart="souples" yEnd="toniques" /></PadGrid>
  </div>
  if (category === 'arms') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Bras" section="body" xKey="upperArmCirc" yKey="upperArmMuscle" xStart="fins" xEnd="épais" yStart="souples" yEnd="musclés" />
      <MorphPadControl title="Avant-bras" section="body" xKey="armFullness" yKey="forearmMuscle" xStart="secs" xEnd="pleins" yStart="fins" yEnd="musclés" />
    </PadGrid>
    <CompactSlider morphKey="armLength" />
  </div>
  if (category === 'legs') return <div className="advanced-content">
    <PadGrid>
      <MorphPadControl title="Volumes" section="body" xKey="thighCirc" yKey="calfCirc" xStart="cuisses fines" xEnd="cuisses larges" yStart="mollets fins" yEnd="mollets larges" />
      <MorphPadControl title="Muscles" section="body" xKey="thighMuscle" yKey="calfMuscle" xStart="cuisses −" xEnd="cuisses +" yStart="mollets −" yEnd="mollets +" />
    </PadGrid>
    <CompactSlider morphKey="legLength" /><CompactSlider morphKey="legFullness" /><CompactSlider morphKey="kneeCirc" />
  </div>
  if (category === 'hands') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Doigts" section="body" xKey="fingerLength" yKey="fingerThickness" xStart="courts" xEnd="longs" yStart="fins" yEnd="épais" /></PadGrid>
    <CompactSlider morphKey="hands" /><CompactSlider morphKey="fingerSpread" /><CompactSlider morphKey="wristCirc" />
  </div>
  if (category === 'feet') return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Pied" section="body" xKey="footWidth" yKey="footDepth" xStart="étroit" xEnd="large" yStart="court" yEnd="long" /></PadGrid>
    <CompactSlider morphKey="feet" /><CompactSlider morphKey="footHeight" /><CompactSlider morphKey="ankleCirc" />
  </div>
  return <div className="advanced-content">
    <PadGrid><MorphPadControl title="Cou" section="body" xKey="neckWidth" yKey="neckDepth" xStart="fin" xEnd="large" yStart="plat" yEnd="profond" /></PadGrid>
    <CompactSlider morphKey="neckCirc" /><CompactSlider morphKey="neckHeight" />
  </div>
}

function CategoryEditor({ category, advanced }: { category: EditorCategory; advanced: boolean }) {
  if (SIMPLE_CATEGORIES.some((item) => item.id === category)) return <SimpleEditor category={category as SimpleCategory} advanced={advanced} />
  return <AdvancedEditor category={category as AdvancedCategory} />
}

function EditorSurface({ navigationBridge }: { navigationBridge?: WardrobeNavigationBridge }) {
  const { loading, error } = useAssetLibrary()
  const replaceConfig = useCharacterState((s) => s.replaceConfig)
  const setIdentity = useCharacterState((s) => s.setIdentity)
  const restoreConfig = useCharacterState((s) => s.restoreConfig)
  const currentConfig = useCharacterState((s) => s.config)
  const [screen, setScreen] = useState<WardrobeScreen>('select')
  const [customCharacter, setCustomCharacter] = useState<StoredCustomCharacter | null>(() => readCustomCharacter())
  const [customPreview, setCustomPreview] = useState(() => readCustomPreview())
  const [customPreviewDirty, setCustomPreviewDirty] = useState(() => {
    const custom = readCustomCharacter()
    return Boolean(custom && !customPreviewMatches(custom.config))
  })
  const [selectedOption, setSelectedOption] = useState(() => {
    const storedCustom = readCustomCharacter()
    if (storedCustom && currentConfig.id === 'custom') return 'custom'
    return CHARACTER_OPTIONS.find((option) => option.label === currentConfig.name)?.id ?? CHARACTER_OPTIONS[0]?.id ?? ''
  })
  const [category, setCategory] = useState<EditorCategory>('general')
  const [advanced, setAdvanced] = useState(false)
  const [switchingPreset, setSwitchingPreset] = useState<string | null>(null)
  const [runtimeEpoch, setRuntimeEpoch] = useState(0)
  const [customPreviewBakeReady, setCustomPreviewBakeReady] = useState(false)
  const lastConfigRef = useRef(currentConfig)
  const suppressCustomTracking = useRef(false)

  const simpleCategories = SIMPLE_CATEGORIES

  const customOption = useMemo<CharacterOption | null>(() => customCharacter ? ({
    id: 'custom',
    label: customCharacter.config.name.trim() || 'Custom',
    previewImage: customPreview,
    config: customCharacter.config,
  }) : null, [customCharacter, customPreview])

  const resetNavigation = useCallback(() => {
    setScreen('select')
    setCategory('general')
    setAdvanced(false)
  }, [])

  const navigateBack = useCallback(() => {
    if (screen === 'edit') {
      setScreen('select')
      setCategory('general')
      setAdvanced(false)
      return true
    }
    return false
  }, [screen])

  useEffect(() => {
    if (!navigationBridge) return
    navigationBridge.back = navigateBack
    navigationBridge.reset = resetNavigation
    navigationBridge.screen = screen
    return () => {
      if (navigationBridge.back === navigateBack) navigationBridge.back = undefined
      if (navigationBridge.reset === resetNavigation) navigationBridge.reset = undefined
      if (navigationBridge.screen === screen) navigationBridge.screen = undefined
    }
  }, [navigateBack, navigationBridge, resetNavigation, screen])

  // The first actual edit of a built-in preset promotes it to the single
  // browser-local Custom slot. If another Custom already exists, ask before
  // replacing it; cancelling restores the exact value from before the edit.
  useEffect(() => {
    const previous = lastConfigRef.current
    lastConfigRef.current = currentConfig

    if (suppressCustomTracking.current) {
      suppressCustomTracking.current = false
      return
    }
    if (screen !== 'edit' || currentConfig.updatedAt === previous.updatedAt) return

    if (selectedOption === 'custom') {
      const next: StoredCustomCharacter = {
        config: { ...structuredClone(currentConfig), id: 'custom' },
        sourcePresetId: customCharacter?.sourcePresetId ?? null,
      }
      writeCustomCharacter(next)
      setCustomCharacter(next)
      setCustomPreviewDirty(true)
      return
    }

    const sourcePreset = CHARACTER_OPTIONS.find((option) => option.id === selectedOption)
    if (!sourcePreset) return

    if (customCharacter) {
      const oldName = customCharacter.config.name.trim() || 'Custom'
      const accepted = window.confirm(`Modifier ${sourcePreset.label} remplacera le personnage « ${oldName} » dès cette première modification. Continuer ?`)
      if (!accepted) {
        suppressCustomTracking.current = true
        lastConfigRef.current = previous
        restoreConfig(previous)
        return
      }
    }

    const typedName = currentConfig.name.trim()
    const keepTypedName = typedName.length > 0 && typedName !== sourcePreset.config.name
    const promotedAt = Date.now()
    const promotedName = keepTypedName ? typedName : 'Custom'
    // Preserve the live nested objects here. A Custom promotion is an identity
    // change, not a morphology change, and must never recalibrate the skeleton.
    const promotedConfig = {
      ...currentConfig,
      id: 'custom',
      name: promotedName,
      updatedAt: promotedAt,
    }
    const promoted: StoredCustomCharacter = { config: structuredClone(promotedConfig), sourcePresetId: sourcePreset.id }
    writeCustomCharacter(promoted)
    setCustomCharacter(promoted)
    setSelectedOption('custom')
    setCustomPreviewDirty(true)

    // Keep the live store aligned with the new Custom identity without cloning
    // body/face or invoking normalizeConfig(), which used to trigger a complete
    // rig recalibration on the first hair/skin/clothing edit.
    suppressCustomTracking.current = true
    lastConfigRef.current = promotedConfig
    setIdentity('custom', promotedName, promotedAt)
  }, [currentConfig, customCharacter, restoreConfig, screen, selectedOption, setIdentity])

  useEffect(() => {
    if (screen !== 'select' || !customOption || !customPreviewDirty) {
      setCustomPreviewBakeReady(false)
      return
    }
    const timer = window.setTimeout(() => setCustomPreviewBakeReady(true), 320)
    return () => window.clearTimeout(timer)
  }, [customOption, customPreviewDirty, screen])

  const toggleAdvanced = () => {
    setAdvanced((enabled) => {
      const next = !enabled
      if (!next && !simpleCategories.some((item) => item.id === category)) setCategory('general')
      return next
    })
  }

  const chooseBuiltIn = (option: CharacterOption) => {
    if (switchingPreset) return
    setSelectedOption(option.id)
    setSwitchingPreset(option.id)
    // Preset switches get a fresh MakeHuman runtime. This guarantees that
    // skeleton bind matrices, fitted MHCLO clothes and hair all belong to the
    // same character. Slider edits do NOT change runtimeEpoch, so animation
    // stays continuous while customizing.
    setRuntimeEpoch((current) => current + 1)
    replaceConfig(option.config)
  }

  const chooseCustom = () => {
    if (!customCharacter || switchingPreset) return
    setSelectedOption('custom')
    setSwitchingPreset('custom')
    setRuntimeEpoch((current) => current + 1)
    replaceConfig(customCharacter.config)
  }

  const handleCustomPreview = useCallback((_: string, dataUrl: string) => {
    if (!customCharacter) return
    writeCustomPreview(dataUrl, customCharacter.config.updatedAt)
    setCustomPreview(dataUrl)
    setCustomPreviewDirty(false)
  }, [customCharacter])

  if (loading) return <div className="wardrobe-state">Chargement…</div>
  if (error) return <div className="wardrobe-state">Impossible de charger le personnage.</div>

  return <div className="wardrobe-editor">
    {screen === 'select' && customOption && customPreviewDirty && customPreviewBakeReady ? <PresetThumbnailGenerator options={[customOption]} images={{}} onGenerated={handleCustomPreview} /> : null}
    <div className="wardrobe-editor-main">
      <EditorViewport modelKey={runtimeEpoch} focus={screen === 'edit' ? category : 'overview'} externalLoading={switchingPreset !== null} onCharacterReady={() => setSwitchingPreset(null)} />
      <aside className="wardrobe-controls">
        {screen === 'select' ? <>
          <div className="character-choice-grid">
            {customOption ? <button type="button" className={`custom-character-card${selectedOption === 'custom' ? ' selected' : ''}`} aria-label={`Choisir ${customOption.label}`} disabled={switchingPreset !== null} onClick={chooseCustom}>
              <span className="choice-thumb ready custom-choice-thumb">
                {customPreview ? <img src={customPreview} alt="" decoding="async" draggable={false} /> : <span className="custom-thumb-placeholder"><i /><small>Création de l’aperçu…</small></span>}
                {customPreviewDirty ? <span className="custom-thumb-refresh">Mise à jour…</span> : null}
              </span>
              <small>{customOption.label}</small>
            </button> : null}
            {CHARACTER_OPTIONS.map((option) => <button key={option.id} type="button" className={selectedOption === option.id ? 'selected' : ''} aria-label={`Choisir ${option.label}`} disabled={switchingPreset !== null} onClick={() => chooseBuiltIn(option)}>
              <ChoiceThumb option={option} /><small>{option.label}</small>
            </button>)}
          </div>
          <button className="wardrobe-primary" type="button" onClick={() => { setScreen('edit'); setCategory('general'); setAdvanced(false) }}>Modifier</button>
        </> : <>
          <div className="wardrobe-customize">
            <div className="wardrobe-tab-groups">
              <nav className="wardrobe-tabs wardrobe-category-tabs wardrobe-category-tabs-simple" aria-label="Personnalisation">
                {simpleCategories.map((item) => <button key={item.id} type="button" className={category === item.id ? 'selected' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}
              </nav>
              {advanced ? <>
                <div className="advanced-tabs-separator" aria-hidden="true" />
                <nav className="wardrobe-tabs wardrobe-category-tabs wardrobe-category-tabs-advanced" aria-label="Options avancées">
                  {ADVANCED_CATEGORIES.map((item) => <button key={item.id} type="button" className={category === item.id ? 'selected' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}
                </nav>
              </> : null}
            </div>
            <div className="wardrobe-panel-scroll"><CategoryEditor category={category} advanced={advanced} /></div>
          </div>
          <div className="wardrobe-footer">
            <button type="button" onClick={() => { setScreen('select'); setCategory('general'); setAdvanced(false) }}>Retour</button>
            <button type="button" className={`advanced-button${advanced ? ' selected' : ''}`} aria-pressed={advanced} onClick={toggleAdvanced}>Options avancées</button>
          </div>
        </>}
      </aside>
    </div>
  </div>
}

export function CharacterEditor({ navigationBridge }: { navigationBridge?: WardrobeNavigationBridge } = {}) {
  return <AssetLibrary><EditorSurface navigationBridge={navigationBridge} /></AssetLibrary>
}
