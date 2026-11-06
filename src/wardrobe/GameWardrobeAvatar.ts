import { Group, Mesh, SkinnedMesh, Texture, TextureLoader, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import type { AssetManifest, CharacterConfig } from './studio/core/types'
import { findManifestAsset, mergeAssetManifest } from './studio/assets/Manifest'
import { rebindSkinnedMeshes, tintAsset } from './studio/assets/assetUtils'
import { createWardrobeMaterial, createWardrobeMesh, getWardrobeEntries } from './studio/character/WardrobeAssets'
import { HumanoidRig } from './studio/character/HumanoidRig'
import { calibrateMakeHumanRig, completeMakeHumanRig } from './studio/character/MakeHumanRig'
import { applySkinSurface } from './studio/character/SkinSurface'
import { createMakeHumanInstance, morphMakeHuman, refitMakeHumanEyes, setMakeHumanBodyDeleteMask } from './studio/makehuman/MakeHumanRuntime'
import { createMhcloGeometry, loadMhcloAsset } from './studio/makehuman/MhcloRuntime'
import { loadMhmat } from './studio/makehuman/MhmatRuntime'
import { loadMakeHumanBase } from './studio/makehuman/TargetLoader'
import { useCharacterState } from './studio/state/CharacterState'
import { disposeAvatarResources } from '../character/AvatarResources'

let manifestPending: Promise<AssetManifest> | undefined
function loadManifest(): Promise<AssetManifest> {
  if (!manifestPending) {
    manifestPending = fetch('/assets/characters/assets-manifest.json').then(async response => {
      if (!response.ok) throw new Error(`Garde-robe indisponible (${response.status}).`)
      return mergeAssetManifest(await response.json() as AssetManifest)
    })
    void manifestPending.catch(() => { manifestPending = undefined })
  }
  return manifestPending
}

/** Build the selected editor profile on the same animated rig used by gameplay. */
export async function loadWardrobeAvatar(reference: Group, selection?: CharacterConfig): Promise<Group> {
  const config = structuredClone(selection ?? useCharacterState.getState().config)
  const [base, manifest] = await Promise.all([loadMakeHumanBase(), loadManifest()])
  const instance = createMakeHumanInstance(base)
  let detail: Texture | undefined
  let ownsTextures = false
  try {
    await morphMakeHuman(instance, config)
    calibrateMakeHumanRig(instance, reference)
    completeMakeHumanRig(instance, reference)
    refitMakeHumanEyes(instance)
    instance.irisMaterial.color.set(config.appearance.eyeColor)

    const selectedSkin = manifest.skins.find(skin => skin.id === config.appearance.skinMaterialId)
    const [skinDetail, skin] = await Promise.all([
      new TextureLoader().loadAsync('/assets/mpfb/textures/skin_detail.jpg'),
      selectedSkin?.materialUrl ? loadMhmat(selectedSkin.materialUrl) : Promise.resolve(null),
    ])
    detail = skinDetail
    applySkinSurface(instance, config, skinDetail, skin)

    const entries = getWardrobeEntries(config, id => findManifestAsset(manifest, id))
    const jobs = await Promise.allSettled(entries.map(async entry => {
      const { asset, color, materialUrl, clearance, lowerRadialClearance, upperRadialClearance, waistPriority } = entry
      if (asset.sourceType === 'mhclo') {
        if (!asset.mhcloUrl || !asset.objUrl) throw new Error(`Vêtement incomplet : ${asset.label}`)
        const source = await loadMhcloAsset(asset.mhcloUrl, asset.objUrl)
        const materialSource = materialUrl ?? source.materialUrl
        const mhmat = materialSource ? await loadMhmat(materialSource) : null
        const geometry = createMhcloGeometry(source, instance, clearance, lowerRadialClearance, upperRadialClearance)
        const material = createWardrobeMaterial(asset, mhmat, color, waistPriority)
        const mesh = createWardrobeMesh(asset, instance, geometry, material, source, waistPriority)
        mesh.userData.wardrobeSlot = asset.slot
        instance.root.add(mesh)
        if (asset.slot === 'shoes' && /boot/i.test(asset.id)) setMakeHumanBodyDeleteMask(instance, asset.id, source.definition.deleteVertices)
      } else {
        const gltf = await new GLTFLoader().loadAsync(asset.url)
        const object = cloneSkeleton(gltf.scene)
        if (color) tintAsset(object, color)
        object.scale.multiply(new Vector3(...entry.fit))
        let skinned = false
        object.traverse(node => { if ((node as SkinnedMesh).isSkinnedMesh) skinned = true })
        if (skinned) { rebindSkinnedMeshes(object, instance.root); instance.root.add(object) }
        else (new HumanoidRig(instance.root).findBone(asset.attachBone ?? entry.bone ?? 'Hips') ?? instance.root).add(object)
      }
    }))
    const failed = jobs.find((job): job is PromiseRejectedResult => job.status === 'rejected')
    if (failed) throw failed.reason

    // Editor materials cache their textures. Gameplay owns separate GPU texture
    // objects so leaving a session cannot invalidate the editor's next preview.
    const privateTextures = new Map<Texture, Texture>()
    instance.root.traverse(object => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const properties = material as unknown as Record<string, unknown>
        for (const [key, texture] of Object.entries(properties)) if (texture instanceof Texture && texture !== skinDetail) {
          let own = privateTextures.get(texture)
          if (!own) { own = texture.clone(); privateTextures.set(texture, own) }
          properties[key] = own
        }
      }
    })
    ownsTextures = true
    instance.root.userData.wardrobeProfile = config
    instance.root.updateMatrixWorld(true)
    return instance.root
  } catch (error) {
    disposeAvatarResources([instance.root], ownsTextures)
    if (!ownsTextures) detail?.dispose()
    throw error
  }
}
