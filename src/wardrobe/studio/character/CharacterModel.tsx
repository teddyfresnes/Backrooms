import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTexture } from '@react-three/drei'
import type { CharacterConfig } from '../core/types'
import type { FacialExpressionId } from '../core/expressions'
import { useAssetLibrary } from '../assets/AssetLibrary'
import { useCharacterState } from '../state/CharacterState'
import { WardrobeManager } from './WardrobeManager'
import { captureAnimatedPose, IdleAnimation, recalibrateAfterMorph, type CharacterAnimationMode } from './IdleAnimation'
import { createMakeHumanInstance, disposeMakeHumanMouth, morphMakeHuman, type MakeHumanInstance } from '../makehuman/MakeHumanRuntime'
import { loadMhmat } from '../makehuman/MhmatRuntime'
import { loadMakeHumanBase } from '../makehuman/TargetLoader'

import { applySkinSurface } from './SkinSurface'

const NO_MHMAT = Promise.resolve(null)

function SkinSurface({ instance, config }: { instance: MakeHumanInstance; config: CharacterConfig }) {
  const { manifest } = useAssetLibrary()
  const appearance = config.appearance
  const skinDetail = useTexture('/assets/mpfb/textures/skin_detail.jpg')
  const selected = manifest?.skins.find((skin) => skin.id === appearance.skinMaterialId)
  const skin = use(selected?.materialUrl ? loadMhmat(selected.materialUrl) : NO_MHMAT)

  useEffect(() => {
    applySkinSurface(instance, config, skinDetail, skin)
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
