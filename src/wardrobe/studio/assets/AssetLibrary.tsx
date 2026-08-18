import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { AssetDefinition, AssetManifest } from '../core/types'
import { EXTRA_EYEBROWS, EXTRA_EYELASHES, EXTRA_SKINS } from './extraAppearanceAssets'

interface AssetLibraryValue {
  manifest: AssetManifest | null
  loading: boolean
  error: string | null
  find: (id: string | null | undefined) => AssetDefinition | null
  bySlot: (slot: 'top' | 'bottom' | 'shoes' | 'hair' | 'beard' | 'eyebrows' | 'eyelashes' | 'accessory') => AssetDefinition[]
}

const AssetLibraryContext = createContext<AssetLibraryValue | null>(null)

export function AssetLibrary({ children }: PropsWithChildren) {
  const [manifest, setManifest] = useState<AssetManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/assets/characters/assets-manifest.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`)
        return response.json() as Promise<AssetManifest>
      })
      .then(setManifest)
      .catch((reason: unknown) => {
        if ((reason as DOMException)?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Manifest introuvable')
      })
    return () => controller.abort()
  }, [])

  const mergedManifest = useMemo<AssetManifest | null>(() => manifest ? ({
    ...manifest,
    skins: [...manifest.skins, ...EXTRA_SKINS],
    eyebrows: EXTRA_EYEBROWS,
    eyelashes: EXTRA_EYELASHES,
  }) : null, [manifest])

  const value = useMemo<AssetLibraryValue>(() => ({
    manifest: mergedManifest,
    loading: !mergedManifest && !error,
    error,
    find: (id: string | null | undefined) => {
      if (!id || !mergedManifest) return null
      const all = [
        ...mergedManifest.baseCharacters,
        ...mergedManifest.hair,
        ...mergedManifest.beards,
        ...(mergedManifest.eyebrows ?? []),
        ...(mergedManifest.eyelashes ?? []),
        ...mergedManifest.clothes.tops,
        ...mergedManifest.clothes.bottoms,
        ...mergedManifest.clothes.shoes,
        ...mergedManifest.accessories,
      ]
      return all.find((asset) => asset.id === id) ?? null
    },
    bySlot: (slot: 'top' | 'bottom' | 'shoes' | 'hair' | 'beard' | 'eyebrows' | 'eyelashes' | 'accessory') => {
      if (!mergedManifest) return []
      if (slot === 'hair') return mergedManifest.hair
      if (slot === 'beard') return mergedManifest.beards
      if (slot === 'eyebrows') return mergedManifest.eyebrows ?? []
      if (slot === 'eyelashes') return mergedManifest.eyelashes ?? []
      if (slot === 'accessory') return mergedManifest.accessories
      if (slot === 'top') return mergedManifest.clothes.tops
      if (slot === 'bottom') return mergedManifest.clothes.bottoms
      return mergedManifest.clothes.shoes
    },
  }), [mergedManifest, error])

  return <AssetLibraryContext.Provider value={value}>{children}</AssetLibraryContext.Provider>
}

export function useAssetLibrary() {
  const context = useContext(AssetLibraryContext)
  if (!context) throw new Error('useAssetLibrary must be used within AssetLibrary')
  return context
}
