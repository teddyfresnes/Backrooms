import type { AssetDefinition, AssetManifest } from '../core/types'
import { EXTRA_EYEBROWS, EXTRA_EYELASHES, EXTRA_SKINS } from './extraAppearanceAssets'

export function mergeAssetManifest(manifest: AssetManifest): AssetManifest {
  return { ...manifest, skins: [...manifest.skins, ...EXTRA_SKINS], eyebrows: EXTRA_EYEBROWS, eyelashes: EXTRA_EYELASHES }
}

export function findManifestAsset(manifest: AssetManifest, id: string | null | undefined): AssetDefinition | null {
  if (!id) return null
  return [
    ...manifest.baseCharacters, ...manifest.hair, ...manifest.beards,
    ...(manifest.nails ?? []), ...(manifest.eyebrows ?? []), ...(manifest.eyelashes ?? []),
    ...manifest.clothes.tops, ...manifest.clothes.bottoms, ...manifest.clothes.shoes, ...manifest.accessories,
  ].find(asset => asset.id === id) ?? null
}
