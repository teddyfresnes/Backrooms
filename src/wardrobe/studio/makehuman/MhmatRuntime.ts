import {
  Color,
  DoubleSide,
  FrontSide,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'

export interface MhmatDefinition {
  name: string
  diffuseColor?: [number, number, number]
  diffuseIntensity?: number
  metallic?: number
  roughness?: number
  opacity?: number
  transparent?: boolean
  backfaceCull?: boolean
  alphaToCoverage?: boolean
  normalmapIntensity?: number
  bumpmapIntensity?: number
  textures: Partial<Record<MhmatTextureKind, string>>
}

export type MhmatTextureKind =
  | 'diffuseTexture'
  | 'normalmapTexture'
  | 'bumpmapTexture'
  | 'roughnessmapTexture'
  | 'metallicmapTexture'
  | 'aomapTexture'
  | 'opacitymapTexture'
  | 'specularmapTexture'
  | 'displacementmapTexture'

export interface LoadedMhmat {
  definition: MhmatDefinition
  textures: Partial<Record<MhmatTextureKind, Texture>>
}

const loader = new TextureLoader()
const cache = new Map<string, Promise<LoadedMhmat>>()

const TEXTURE_KEYS = new Set<MhmatTextureKind>([
  'diffuseTexture', 'normalmapTexture', 'bumpmapTexture', 'roughnessmapTexture',
  'metallicmapTexture', 'aomapTexture', 'opacitymapTexture', 'specularmapTexture', 'displacementmapTexture',
])

const numberOr = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const boolOr = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback
  return !['false', '0', 'no', 'off'].includes(value.toLowerCase())
}

export function parseMhmat(text: string): MhmatDefinition {
  const result: MhmatDefinition = { name: 'MakeHuman material', textures: {} }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const words = line.split(/\s+/)
    const key = words[0]
    if (key === 'name' && words[1]) result.name = words.slice(1).join(' ')
    else if (key === 'diffuseColor' && words.length >= 4) result.diffuseColor = [numberOr(words[1], 1), numberOr(words[2], 1), numberOr(words[3], 1)]
    else if (key === 'diffuseIntensity') result.diffuseIntensity = numberOr(words[1], 1)
    else if (key === 'metallic') result.metallic = numberOr(words[1], 0)
    else if (key === 'roughness') result.roughness = numberOr(words[1], .7)
    else if (key === 'opacity') result.opacity = numberOr(words[1], 1)
    else if (key === 'transparent') result.transparent = boolOr(words[1], false)
    else if (key === 'backfaceCull') result.backfaceCull = boolOr(words[1], true)
    else if (key === 'alphaToCoverage') result.alphaToCoverage = boolOr(words[1], false)
    else if (key === 'bumpTexture' && words[1]) result.textures.bumpmapTexture = words[1]
    else if (key === 'specularTexture' && words[1]) result.textures.specularmapTexture = words[1]
    else if (key === 'displacementTexture' && words[1]) result.textures.displacementmapTexture = words[1]
    else if (key === 'normalmapIntensity') result.normalmapIntensity = numberOr(words[1], 1)
    else if (key === 'bumpmapIntensity') result.bumpmapIntensity = numberOr(words[1], 1)
    else if (TEXTURE_KEYS.has(key as MhmatTextureKind) && words[1]) result.textures[key as MhmatTextureKind] = words[1]
  }
  return result
}

function resolveRelative(baseUrl: string, relative: string) {
  const base = new URL(baseUrl, window.location.href)
  return new URL(relative, base).toString()
}

async function optionalTexture(url: string, srgb = false) {
  try {
    const texture = await loader.loadAsync(url)
    texture.flipY = false
    texture.channel = 0
    // Wardrobe assets are viewed at modest screen size. Keep anisotropy low to
    // reduce sampling cost on integrated GPUs; mipmaps remain enabled by Three.
    texture.anisotropy = 8
    if (srgb) texture.colorSpace = SRGBColorSpace
    return texture
  } catch (error) {
    console.warn(`Texture MHMAT ignorée: ${url}`, error)
    return undefined
  }
}

export function loadMhmat(url: string) {
  let pending = cache.get(url)
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`MHMAT indisponible (${response.status}) : ${url}`)
      const definition = parseMhmat(await response.text())
      const entries = await Promise.all(Object.entries(definition.textures).map(async ([key, relative]) => {
        const kind = key as MhmatTextureKind
        const texture = await optionalTexture(resolveRelative(url, relative), kind === 'diffuseTexture')
        return [kind, texture] as const
      }))
      return {
        definition,
        textures: Object.fromEntries(entries.filter(([, texture]) => Boolean(texture))) as Partial<Record<MhmatTextureKind, Texture>>,
      }
    })
    cache.set(url, pending)
    void pending.catch(() => {
      if (cache.get(url) === pending) cache.delete(url)
    })
  }
  return pending
}

export function createMhmatMaterial(source: LoadedMhmat | null, tint?: string) {
  const definition = source?.definition
  const diffuse = definition?.diffuseColor ?? [.55, .55, .55]
  const base = new Color(diffuse[0], diffuse[1], diffuse[2])
  if (tint) base.set(tint)
  else if (definition?.diffuseIntensity !== undefined) base.multiplyScalar(definition.diffuseIntensity)

  // Older MakeHuman materials frequently write `opacity 0` for fully visible
  // clothing/hair. Treat that legacy zero as opaque; otherwise entire bob cuts,
  // cardigans and tank tops disappear in Three.js. Alpha cutouts still come from
  // the texture/transparent flags below.
  const declaredOpacity = definition?.opacity ?? 1
  const opacity = declaredOpacity <= 0.0001 ? 1 : Math.max(0, Math.min(1, declaredOpacity))
  const material = new MeshPhysicalMaterial({
    name: definition?.name ?? 'MakeHuman_MHCLO_Material',
    color: base,
    roughness: Math.max(0, Math.min(1, definition?.roughness ?? .72)),
    metalness: Math.max(0, Math.min(1, definition?.metallic ?? 0)),
    opacity,
    transparent: definition?.transparent ?? (opacity < 1),
    alphaTest: declaredOpacity <= 0.0001 ? .025 : 0,
    side: definition?.backfaceCull === false ? DoubleSide : FrontSide,
  })
  if (!source) return material

  material.map = source.textures.diffuseTexture ?? null
  material.normalMap = source.textures.normalmapTexture ?? null
  material.bumpMap = source.textures.bumpmapTexture ?? null
  material.roughnessMap = source.textures.roughnessmapTexture ?? null
  material.metalnessMap = source.textures.metallicmapTexture ?? null
  material.aoMap = source.textures.aomapTexture ?? null
  material.alphaMap = source.textures.opacitymapTexture ?? null
  material.specularIntensityMap = source.textures.specularmapTexture ?? null
  material.displacementMap = source.textures.displacementmapTexture ?? null
  material.displacementScale = material.displacementMap ? .002 : 0
  material.normalScale.setScalar((definition?.normalmapIntensity ?? 1) * .35)
  material.bumpScale = (definition?.bumpmapIntensity ?? 1) * .0007
  material.alphaToCoverage = definition?.alphaToCoverage ?? false
  if (material.transparent) material.depthWrite = false
  if (material.alphaMap) { material.transparent = true; material.alphaTest = Math.max(material.alphaTest, .1) }
  material.needsUpdate = true
  return material
}
