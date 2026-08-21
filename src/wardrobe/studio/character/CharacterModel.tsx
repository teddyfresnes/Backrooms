import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTexture } from '@react-three/drei'
import { SRGBColorSpace } from 'three'
import type { CharacterConfig } from '../core/types'
import type { FacialExpressionId } from '../core/expressions'
import { useAssetLibrary } from '../assets/AssetLibrary'
import { useCharacterState } from '../state/CharacterState'
import { WardrobeManager } from './WardrobeManager'
import { captureAnimatedPose, IdleAnimation, recalibrateAfterMorph, type CharacterAnimationMode } from './IdleAnimation'
import { createMakeHumanInstance, disposeMakeHumanMouth, morphMakeHuman, type MakeHumanInstance } from '../makehuman/MakeHumanRuntime'
import { loadMhmat } from '../makehuman/MhmatRuntime'
import { loadMakeHumanBase } from '../makehuman/TargetLoader'

const NO_MHMAT = Promise.resolve(null)

function SkinSurface({ instance, config }: { instance: MakeHumanInstance; config: CharacterConfig }) {
  const { manifest } = useAssetLibrary()
  const appearance = config.appearance
  const skinDetail = useTexture('/assets/mpfb/textures/skin_detail.jpg')
  const selected = manifest?.skins.find((skin) => skin.id === appearance.skinMaterialId)
  const skin = use(selected?.materialUrl ? loadMhmat(selected.materialUrl) : NO_MHMAT)

  useEffect(() => {
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
  }, [appearance.skinColor, instance.skinMaterial, skin, skinDetail])

  return null
}

export interface CharacterModelProps {
  config?: CharacterConfig
  animationMode?: CharacterAnimationMode
  expression?: FacialExpressionId
  onReady?: () => void
}

export function CharacterModel({ config: configOverride, animationMode = 'sequence', expression = 'neutral', onReady }: CharacterModelProps = {}) {
  const data = use(loadMakeHumanBase())
  const liveConfig = useCharacterState((s) => s.config)
  const addAssetError = useCharacterState((s) => s.addAssetError)
  const config = configOverride ?? liveConfig
  const instance = useMemo(() => createMakeHumanInstance(data), [data])
  const morphVersion = useRef(0)
  const lastBodyRef = useRef(config.body)
  const lastFaceRef = useRef(config.face)
  const lastExpressionRef = useRef(expression)
  const [morphRevision, setMorphRevision] = useState(0)
  const [bodyRevision, setBodyRevision] = useState(0)
  const [faceRevision, setFaceRevision] = useState(0)
  const animationReady = useRef(false)
  const wardrobeReady = useRef(false)
  const readyReported = useRef(false)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => () => disposeMakeHumanMouth(instance), [instance])

  const reportReady = useCallback(() => {
    if (readyReported.current || !animationReady.current || !wardrobeReady.current) return
    readyReported.current = true
    onReadyRef.current?.()
  }, [])
  const handleAnimationReady = useCallback(() => {
    animationReady.current = true
    reportReady()
  }, [reportReady])
  const handleWardrobeReady = useCallback(() => {
    wardrobeReady.current = true
    reportReady()
  }, [reportReady])

  // Material-only changes must never refit the skeleton. Previously changing an
  // eye colour or skin texture ran the entire MakeHuman morph pipeline.
  useEffect(() => {
    instance.irisMaterial.color.set(config.appearance.eyeColor)
    instance.irisMaterial.needsUpdate = true
  }, [instance, config.appearance.eyeColor])

  useEffect(() => {
    const version = ++morphVersion.current
    const bodyChanged = lastBodyRef.current !== config.body
    const faceChanged = lastFaceRef.current !== config.face
    const expressionChanged = lastExpressionRef.current !== expression
    lastBodyRef.current = config.body
    lastFaceRef.current = config.face
    lastExpressionRef.current = expression
    const timer = window.setTimeout(() => {
      const pose = morphRevision > 0 ? captureAnimatedPose(instance) : null
      void morphMakeHuman(instance, config, () => version === morphVersion.current, expression)
        .then(async () => {
          if (version !== morphVersion.current) return
          await recalibrateAfterMorph(instance, pose)
          if (version !== morphVersion.current) return
          if (bodyChanged || morphRevision === 0) setBodyRevision((current) => current + 1)
          if (faceChanged || expressionChanged || morphRevision === 0) setFaceRevision((current) => current + 1)
          setMorphRevision((current) => current + 1)
        })
        .catch((error) => addAssetError(`Morph MakeHuman: ${error instanceof Error ? error.message : String(error)}`))
    }, 38)
    return () => window.clearTimeout(timer)
  }, [instance, config.body, config.face, expression, addAssetError])

  return <group>
    <SkinSurface instance={instance} config={config} />
    {morphRevision > 0 ? <IdleAnimation instance={instance} mode={animationMode} onReady={handleAnimationReady} /> : null}
    <primitive object={instance.root} />
    {morphRevision > 0 ? <WardrobeManager instance={instance} bodyRevision={bodyRevision} faceRevision={faceRevision} config={config} onReady={handleWardrobeReady} /> : null}
  </group>
}
