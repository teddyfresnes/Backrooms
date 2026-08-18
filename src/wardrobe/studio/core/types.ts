import type { Object3D } from 'three'

export type ClothingSlot = 'top' | 'bottom' | 'shoes'
export type AssetSlot = 'base' | 'hair' | 'beard' | 'eyebrows' | 'eyelashes' | ClothingSlot | 'accessory'
export type MorphSection = 'body' | 'face'

export interface MorphDefinition {
  key: string
  label: string
  section: MorphSection
  min: number
  max: number
  step: number
  default: number
  tooltip: string
  target?: string
}

export interface MaterialVariantDefinition {
  id: string
  label: string
  materialUrl: string
  thumbnail?: string
  tags?: string[]
}

export interface AssetDefinition {
  id: string
  label: string
  slot: AssetSlot
  url: string
  thumbnail?: string
  colors?: string[]
  attachBone?: string
  tags?: string[]
  sourceType?: 'glb' | 'mhclo'
  mhcloUrl?: string
  objUrl?: string
  materials?: MaterialVariantDefinition[]
}

export interface BaseCharacterAsset extends AssetDefinition {
  slot: 'base'
  rig: string
  morphTargets?: Record<string, string>
  skinMaterialNames?: string[]
}

export interface AssetManifest {
  version: number
  baseCharacters: BaseCharacterAsset[]
  skins: MaterialVariantDefinition[]
  hair: AssetDefinition[]
  beards: AssetDefinition[]
  eyebrows?: AssetDefinition[]
  eyelashes?: AssetDefinition[]
  environment?: { studioHDRI?: string | null }
  clothes: {
    tops: AssetDefinition[]
    bottoms: AssetDefinition[]
    shoes: AssetDefinition[]
  }
  accessories: AssetDefinition[]
}

export interface AppearanceConfig {
  skinColor: string
  skinMaterialId: string | null
  eyeColor: string
  hairId: string | null
  hairMaterialId: string | null
  hairColor: string
  eyebrowsId: string | null
  eyelashesId: string | null
  beardId: string | null
  beardColor: string
}

export interface WardrobeConfig {
  top: string | null
  bottom: string | null
  shoes: string | null
  colors: Partial<Record<ClothingSlot, string>>
}

export interface CharacterConfig {
  id: string
  name: string
  baseAssetId: string
  body: Record<string, number>
  face: Record<string, number>
  appearance: AppearanceConfig
  wardrobe: WardrobeConfig
  accessories: string[]
  updatedAt: number
}

export interface HumanoidBoneMap {
  hips?: Object3D
  spine?: Object3D
  chest?: Object3D
  neck?: Object3D
  head?: Object3D
  leftShoulder?: Object3D
  rightShoulder?: Object3D
  leftUpperArm?: Object3D
  rightUpperArm?: Object3D
  leftForeArm?: Object3D
  rightForeArm?: Object3D
  leftHand?: Object3D
  rightHand?: Object3D
  leftUpperLeg?: Object3D
  rightUpperLeg?: Object3D
  leftLowerLeg?: Object3D
  rightLowerLeg?: Object3D
  leftFoot?: Object3D
  rightFoot?: Object3D
}
