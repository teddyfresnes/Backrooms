import { Component, use, useEffect, useMemo, type ErrorInfo, type PropsWithChildren } from 'react'
import { useGLTF } from '@react-three/drei'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { DoubleSide, Matrix4, MeshBasicMaterial, SkinnedMesh, Vector3, type Object3D } from 'three'
import type { AssetDefinition, CharacterConfig } from '../core/types'
import { useAssetLibrary } from '../assets/AssetLibrary'
import { rebindSkinnedMeshes, tintAsset } from '../assets/assetUtils'
import { HumanoidRig } from './HumanoidRig'
import { useCharacterState } from '../state/CharacterState'
import { setMakeHumanBodyDeleteMask, type MakeHumanInstance } from '../makehuman/MakeHumanRuntime'
import { createMhcloGeometry, loadMhcloAsset, updateMhcloGeometry } from '../makehuman/MhcloRuntime'
import { createMhmatMaterial, loadMhmat } from '../makehuman/MhmatRuntime'

const NO_MHMAT = Promise.resolve(null)

class AssetErrorBoundary extends Component<PropsWithChildren<{ label: string; onError: (message: string) => void }>, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError(`${this.props.label}: ${error.message}`); console.error(info.componentStack) }
  render() { return this.state.failed ? null : this.props.children }
}

function hasSkinnedMesh(root: Object3D) {
  let found = false
  root.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) found = true })
  return found
}

function MhcloSlotAsset({ asset, instance, color, materialUrl, morphRevision, clearance = 0, lowerRadialClearance = 0, upperRadialClearance = 0, waistPriority = 'normal' }: { asset: AssetDefinition; instance: MakeHumanInstance; color?: string; materialUrl?: string; morphRevision: number; clearance?: number; lowerRadialClearance?: number; upperRadialClearance?: number; waistPriority?: 'outer' | 'inner' | 'normal' }) {
  if (!asset.mhcloUrl || !asset.objUrl) throw new Error(`Asset MHCLO incomplet: ${asset.id}`)
  const source = use(loadMhcloAsset(asset.mhcloUrl, asset.objUrl))
  const geometry = useMemo(() => createMhcloGeometry(source, instance, clearance, lowerRadialClearance, upperRadialClearance), [source, instance, clearance, lowerRadialClearance, upperRadialClearance])
  const mhmat = use(materialUrl ? loadMhmat(materialUrl) : source.materialUrl ? loadMhmat(source.materialUrl) : NO_MHMAT)
  const material = useMemo(() => {
    const result = createMhmatMaterial(mhmat, color)

    // Hair/eyebrow/eyelash assets are thin alpha cards. Even with shadows
    // disabled, lit PBR shading still creates moving dark blotches as the cards
    // overlap and rotate. Render them as stable cutout sheets instead.
    if (asset.slot === 'hair' || asset.slot === 'beard' || asset.slot === 'eyebrows' || asset.slot === 'eyelashes' || asset.tags?.includes('alpha-cards')) {
      const flat = new MeshBasicMaterial({
        name: `${result.name}_Cutout`,
        color: result.color.clone(),
        map: result.map,
        alphaMap: result.alphaMap,
        side: DoubleSide,
        alphaTest: Math.max(result.alphaTest, .42),
        transparent: false,
        opacity: 1,
        depthWrite: true,
        toneMapped: true,
        fog: true,
      })
      flat.needsUpdate = true
      return flat
    }

    // A number of community clothing MHMATs ship noisy normal/specular/AO maps
    // authored for a different renderer/tangent basis. On an animated skinned
    // mesh they show up as thin black lines that crawl over the shirt/pants.
    // Keep the diffuse texture, but use a deliberately calm cloth response.
    if (asset.slot === 'top' || asset.slot === 'bottom' || asset.slot === 'shoes') {
      result.normalMap = null
      result.bumpMap = null
      result.aoMap = null
      result.roughnessMap = null
      result.metalnessMap = null
      result.specularIntensityMap = null
      result.displacementMap = null
      result.displacementScale = 0
      result.normalScale.setScalar(0)
      result.bumpScale = 0
      result.metalness = 0
      result.roughness = Math.max(.88, result.roughness)
      result.clearcoat = 0
      result.clearcoatRoughness = 1
      result.sheen = 0
      result.envMapIntensity = 0
      result.flatShading = false
    }

    // Clothes from different community packs sometimes occupy almost the same
    // surface at the waist/cuffs. Give outer wardrobe layers a tiny depth bias
    // so they do not flicker through one another without visibly inflating them.
    if (asset.slot === 'top' || asset.slot === 'bottom' || asset.slot === 'shoes') {
      result.polygonOffset = true
      // Depth bias is only a final anti-flicker layer; the actual separation is
      // geometric. "outer" wins cleanly where shirt and waistband are almost
      // coplanar, while "inner" stays behind. This also lets tucked shirts put
      // the trousers outside instead of forcing every top over every bottom.
      const layerBias = waistPriority === 'outer' ? -4 : waistPriority === 'inner' ? -0.5 : asset.slot === 'shoes' ? -1.5 : -1
      result.polygonOffsetFactor = layerBias
      result.polygonOffsetUnits = layerBias
    }
    result.needsUpdate = true
    return result
  }, [asset.slot, mhmat, color, materialUrl, waistPriority])
  const mesh = useMemo(() => {
    const result = new SkinnedMesh(geometry, material)
    result.name = asset.label.replace(/\s+/g, '_')
    result.castShadow = false
    result.receiveShadow = false
    result.frustumCulled = false

    // Geometry clearance is now applied along garment surface normals in
    // MhcloRuntime. Avoid scaling around the world origin here: that old trick
    // moved sleeves/waists differently depending on body proportions.
    result.scale.set(1, 1, 1)
    result.renderOrder = waistPriority === 'outer' ? 32 : waistPriority === 'inner' ? 18 : asset.slot === 'top' ? 30 : asset.slot === 'bottom' ? 20 : asset.slot === 'shoes' ? 40 : asset.slot === 'hair' ? 50 : asset.slot === 'eyelashes' ? 48 : asset.slot === 'eyebrows' ? 47 : 45
    result.userData.makeHumanAsset = { source: 'mhclo', id: asset.id, uuid: source.definition.uuid }
    result.bind(instance.skeleton, new Matrix4())
    return result
  }, [asset.id, asset.label, asset.slot, geometry, instance.skeleton, material, source.definition.uuid, waistPriority])

  useEffect(() => { updateMhcloGeometry(geometry, source, instance, clearance, lowerRadialClearance, upperRadialClearance) }, [geometry, source, instance, morphRevision, clearance, lowerRadialClearance, upperRadialClearance])
  useEffect(() => {
    // Community top/bottom delete masks are not reliable enough to enable
    // globally (some erase visible cleavage/waist skin). Surface-normal
    // clearance handles ordinary cloth punch-through instead. Keep masking only
    // for closed boots, where the hidden body region is unambiguous.
    const closedBoot = asset.slot === 'shoes' && /boot/i.test(asset.id)
    const deleteVertices = closedBoot ? source.definition.deleteVertices : null
    setMakeHumanBodyDeleteMask(instance, asset.id, deleteVertices)
    return () => setMakeHumanBodyDeleteMask(instance, asset.id, null)
  }, [asset.id, asset.slot, instance, source.definition.deleteVertices])
  useEffect(() => {
    instance.root.add(mesh)
    return () => { instance.root.remove(mesh) }
  }, [instance.root, mesh])
  // Clothing/hair geometry and material objects are rebuilt when the selected
  // asset changes. Explicitly dispose the old GPU resources instead of waiting
  // for GC, otherwise browsing many wardrobe entries steadily grows VRAM use.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return null
}

function GlbSlotAsset({ asset, characterRoot, color, defaultBone, fitScale }: { asset: AssetDefinition; characterRoot: Object3D; color?: string; defaultBone?: string; fitScale?: [number, number, number] }) {
  const gltf = useGLTF(asset.url)
  const fitKey = (fitScale ?? [1, 1, 1]).join(',')
  const object = useMemo(() => skeletonClone(gltf.scene), [gltf.scene, fitKey, color])

  useEffect(() => {
    const rig = new HumanoidRig(characterRoot)
    if (color) tintAsset(object, color)
    const fit = new Vector3(...(fitScale ?? [1, 1, 1]))
    object.scale.multiply(fit)

    if (hasSkinnedMesh(object)) {
      rebindSkinnedMeshes(object, characterRoot)
      characterRoot.add(object)
      return () => { characterRoot.remove(object) }
    }

    const attachable = object.children.filter((child) => typeof child.userData.attachBone === 'string')
    if (attachable.length) {
      const attached: Array<{ bone: Object3D; node: Object3D }> = []
      for (const node of attachable) {
        const bone = rig.findBone(node.userData.attachBone as string)
        if (!bone) continue
        object.remove(node)
        node.scale.multiply(fit)
        bone.add(node)
        attached.push({ bone, node })
      }
      return () => attached.forEach(({ bone, node }) => bone.remove(node))
    }

    const target = rig.findBone(asset.attachBone ?? defaultBone ?? 'Hips') ?? characterRoot
    target.add(object)
    return () => { target.remove(object) }
  }, [asset.attachBone, characterRoot, color, defaultBone, fitKey, object])
  return null
}

function SlotAsset(props: { asset: AssetDefinition; instance: MakeHumanInstance; color?: string; materialUrl?: string; defaultBone?: string; fitScale?: [number, number, number]; morphRevision: number; clearance?: number; lowerRadialClearance?: number; upperRadialClearance?: number; waistPriority?: 'outer' | 'inner' | 'normal' }) {
  if (props.asset.sourceType === 'mhclo') {
    return <MhcloSlotAsset asset={props.asset} instance={props.instance} color={props.color} materialUrl={props.materialUrl} morphRevision={props.morphRevision} clearance={props.clearance} lowerRadialClearance={props.lowerRadialClearance} upperRadialClearance={props.upperRadialClearance} waistPriority={props.waistPriority} />
  }
  return <GlbSlotAsset asset={props.asset} characterRoot={props.instance.root} color={props.color} defaultBone={props.defaultBone} fitScale={props.fitScale} />
}

interface WardrobeEntry {
  asset: AssetDefinition
  revision: number
  color: string | undefined
  materialUrl: string | undefined
  bone: string | undefined
  clearance: number
  lowerRadialClearance: number
  upperRadialClearance: number
  waistPriority: 'outer' | 'inner' | 'normal'
  fit: [number, number, number]
}

type PendingWardrobeEntry = Omit<WardrobeEntry, 'asset'> & { asset: AssetDefinition | null }

export function WardrobeManager({ instance, bodyRevision, faceRevision, config: configOverride, onReady }: { instance: MakeHumanInstance; bodyRevision: number; faceRevision: number; config?: CharacterConfig; onReady?: () => void }) {
  const { find } = useAssetLibrary()
  const liveConfig = useCharacterState((s) => s.config)
  const config = configOverride ?? liveConfig
  const addAssetError = useCharacterState((s) => s.addAssetError)

  const body = config.body
  const face = config.face
  const hairAsset = find(config.appearance.hairId)
  const eyebrowAsset = find(config.appearance.eyebrowsId)
  const eyelashAsset = find(config.appearance.eyelashesId)
  const hairMaterialUrl = hairAsset?.materials?.find((material) => material.id === config.appearance.hairMaterialId)?.materialUrl

  // Extra safety grows only slightly for extreme morphs. Values are metres.
  // The important v13.1 change is the waist layer rule: two community garments
  // are no longer allowed to share the same shell at the belt line. Untucked
  // tops get a soft radial flare only at their lower hem; explicitly tucked
  // tops stay under the trousers and the waistband becomes the outer layer.
  const topAsset = find(config.wardrobe.top)
  const bottomAsset = find(config.wardrobe.bottom)
  const shoesAsset = find(config.wardrobe.shoes)
  const topIsTucked = Boolean(topAsset && /tucked|bodysuit/i.test(`${topAsset.id} ${topAsset.label}`))

  const topStress = Math.min(1, Math.abs(body.weight ?? 0) + Math.abs(body.chest ?? 0) + Math.abs(body.shoulders ?? 0) + Math.abs(body.muscle ?? 0))
  const bottomStress = Math.min(1, Math.abs(body.weight ?? 0) + Math.abs(body.hips ?? 0) + Math.abs(body.waist ?? 0) + Math.abs(body.legLength ?? 0))
  const topClearance = 0.0060 + topStress * 0.0020
  const bottomClearance = 0.0026 + bottomStress * 0.0013
  const shoeClearance = 0.0015 + Math.min(1, Math.abs(body.feet ?? 0)) * 0.0008

  // About 3.5-5 mm of additional radial separation at the garment edge. The
  // smooth band means the shirt does not look globally inflated; only its hem
  // clears the jeans/belt as the torso and hips animate.
  const untuckedHemClearance = topIsTucked ? 0 : 0.0095 + topStress * 0.0017
  const bottomWaistClearance = topIsTucked
    ? 0.0042 + bottomStress * 0.0014
    : -(0.0010 + bottomStress * 0.00035)

  const headRevision = bodyRevision * 100000 + faceRevision
  const pendingEntries: PendingWardrobeEntry[] = [
    { asset: hairAsset, revision: headRevision, color: undefined, materialUrl: hairMaterialUrl, bone: 'Head', clearance: 0, lowerRadialClearance: 0, upperRadialClearance: 0, waistPriority: 'normal' as const, fit: [1 + (face.faceShape ?? 0) * .04, 1 + (face.forehead ?? 0) * .04, 1 + (face.faceShape ?? 0) * .04] as [number, number, number] },
    { asset: eyebrowAsset, revision: headRevision, color: undefined, materialUrl: undefined, bone: 'Head', clearance: 0, lowerRadialClearance: 0, upperRadialClearance: 0, waistPriority: 'normal' as const, fit: [1 + (face.faceShape ?? 0) * .015, 1 + (face.brows ?? 0) * .015, 1 + (face.faceShape ?? 0) * .015] as [number, number, number] },
    { asset: eyelashAsset, revision: headRevision, color: undefined, materialUrl: undefined, bone: 'Head', clearance: 0, lowerRadialClearance: 0, upperRadialClearance: 0, waistPriority: 'normal' as const, fit: [1 + (face.eyeSize ?? 0) * .02, 1 + (face.eyeHeight ?? 0) * .01, 1 + (face.eyeSize ?? 0) * .02] as [number, number, number] },
    { asset: find(config.appearance.beardId), revision: headRevision, color: undefined, materialUrl: undefined, bone: 'Head', clearance: 0, lowerRadialClearance: 0, upperRadialClearance: 0, waistPriority: 'normal' as const, fit: [1 + (face.jaw ?? 0) * .05, 1, 1 + (face.chin ?? 0) * .04] as [number, number, number] },
    { asset: topAsset, revision: bodyRevision, materialUrl: undefined, color: topAsset?.colors?.length ? config.wardrobe.colors.top : undefined, bone: 'Chest', clearance: topClearance, lowerRadialClearance: untuckedHemClearance, upperRadialClearance: 0, waistPriority: topIsTucked ? 'inner' as const : 'outer' as const, fit: [1 + (body.shoulders ?? 0) * .08 + (body.weight ?? 0) * .05, 1 + (body.height ?? 0) * .025, 1 + (body.chest ?? 0) * .08 + (body.weight ?? 0) * .04] as [number, number, number] },
    { asset: bottomAsset, revision: bodyRevision, materialUrl: undefined, color: bottomAsset?.colors?.length ? config.wardrobe.colors.bottom : undefined, bone: 'Hips', clearance: bottomClearance, lowerRadialClearance: 0, upperRadialClearance: bottomWaistClearance, waistPriority: topIsTucked ? 'outer' as const : 'inner' as const, fit: [1 + (body.hips ?? 0) * .09 + (body.weight ?? 0) * .05, 1 + (body.legLength ?? 0) * .04, 1 + (body.weight ?? 0) * .04] as [number, number, number] },
    { asset: shoesAsset, revision: bodyRevision, materialUrl: undefined, color: shoesAsset?.colors?.length ? config.wardrobe.colors.shoes : undefined, bone: 'Hips', clearance: shoeClearance, lowerRadialClearance: 0, upperRadialClearance: 0, waistPriority: 'normal' as const, fit: [1 + (body.feet ?? 0) * .08, 1 + (body.feet ?? 0) * .04, 1 + (body.feet ?? 0) * .10] as [number, number, number] },
  ]
  const entries = pendingEntries.filter((entry): entry is WardrobeEntry => entry.asset !== null)

  // This component only commits after all suspended MHCLO/material promises have
  // resolved. Wait one frame so child effects have attached their meshes before
  // telling the viewport to remove its loading cover.
  useEffect(() => {
    if (!onReady) return
    const frame = window.requestAnimationFrame(onReady)
    return () => window.cancelAnimationFrame(frame)
  }, [instance, onReady])

  return <>
    {entries.map(({ asset, revision, color, materialUrl, bone, fit, clearance, lowerRadialClearance, upperRadialClearance, waistPriority }) => (
      <AssetErrorBoundary key={`${asset.slot}:${asset.id}:${materialUrl ?? color ?? ''}`} label={asset.label} onError={addAssetError}>
        <SlotAsset asset={asset} instance={instance} color={color} materialUrl={materialUrl} defaultBone={bone} fitScale={fit} morphRevision={revision} clearance={clearance} lowerRadialClearance={lowerRadialClearance} upperRadialClearance={upperRadialClearance} waistPriority={waistPriority} />
      </AssetErrorBoundary>
    ))}
  </>
}
