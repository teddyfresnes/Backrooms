import { SRGBColorSpace, type Texture } from 'three'
import type { CharacterConfig } from '../core/types'
import type { MakeHumanInstance } from '../makehuman/MakeHumanRuntime'
import type { LoadedMhmat } from '../makehuman/MhmatRuntime'

export function applySkinSurface(instance: MakeHumanInstance, config: CharacterConfig, skinDetail: Texture, skin: LoadedMhmat | null): void {
  const appearance = config.appearance
    const material = instance.skinMaterial
    skinDetail.flipY = false
    skinDetail.colorSpace = SRGBColorSpace
    skinDetail.anisotropy = 4

    material.roughness = 0.88
    material.metalness = 0
    material.clearcoat = 0.015
    material.clearcoatRoughness = 0.65
    material.sheen = 0.08
    material.sheenRoughness = 0.86

    if (skin?.textures.diffuseTexture) {
      material.map = skin.textures.diffuseTexture
      material.normalMap = skin.textures.normalmapTexture ?? null
      material.bumpMap = skin.textures.bumpmapTexture ?? (skin.textures.normalmapTexture ? null : skinDetail)
      material.roughnessMap = skin.textures.roughnessmapTexture ?? null
      material.metalnessMap = skin.textures.metallicmapTexture ?? null
      material.aoMap = skin.textures.aomapTexture ?? null
      material.specularIntensityMap = skin.textures.specularmapTexture ?? null
      material.bumpScale = skin.textures.bumpmapTexture ? 0.0012 : 0.00045
      material.normalScale.setScalar(skin.textures.normalmapTexture ? (skin.definition.normalmapIntensity ?? 1) : 1)
      const diffuse = skin.definition.diffuseColor ?? [1, 1, 1]
      material.color.setRGB(diffuse[0], diffuse[1], diffuse[2])
    } else {
      material.map = skinDetail
      material.normalMap = null
      material.roughnessMap = null
      material.metalnessMap = null
      material.aoMap = null
      material.specularIntensityMap = null
      material.bumpMap = skinDetail
      material.bumpScale = 0.00045
      material.color.set(appearance.skinColor)
    }

    material.transparent = false
    material.opacity = 1
    material.alphaTest = 0
    material.depthWrite = true
    material.needsUpdate = true
}
