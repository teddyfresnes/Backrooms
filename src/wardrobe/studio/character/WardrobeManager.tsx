import { Component, use, useEffect, useMemo, type ErrorInfo, type PropsWithChildren } from 'react'
import { useGLTF } from '@react-three/drei'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
import { SkinnedMesh, Vector3, type Object3D } from 'three'
import type { AssetDefinition, CharacterConfig } from '../core/types'
import { useAssetLibrary } from '../assets/AssetLibrary'
import { rebindSkinnedMeshes, tintAsset } from '../assets/assetUtils'
import { HumanoidRig } from './HumanoidRig'
import { useCharacterState } from '../state/CharacterState'
import { setMakeHumanBodyDeleteMask, type MakeHumanInstance } from '../makehuman/MakeHumanRuntime'
import { createMhcloGeometry, loadMhcloAsset, updateMhcloGeometry } from '../makehuman/MhcloRuntime'
import { loadMhmat } from '../makehuman/MhmatRuntime'

import { createWardrobeMaterial, createWardrobeMesh, getWardrobeEntries } from './WardrobeAssets'

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
    return createWardrobeMaterial(asset, mhmat, color, waistPriority)
  }, [asset.slot, mhmat, color, materialUrl, waistPriority])
  const mesh = useMemo(() => {
    return createWardrobeMesh(asset, instance, geometry, material, source, waistPriority)
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


export function WardrobeManager({ instance, bodyRevision, faceRevision, config: configOverride, onReady }: { instance: MakeHumanInstance; bodyRevision: number; faceRevision: number; config?: CharacterConfig; onReady?: () => void }) {
  const { find } = useAssetLibrary()
  const liveConfig = useCharacterState((s) => s.config)
  const config = configOverride ?? liveConfig
  const addAssetError = useCharacterState((s) => s.addAssetError)

  const entries = getWardrobeEntries(config, find, bodyRevision, faceRevision)

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
