import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTexture } from '@react-three/drei'
import type { CharacterConfig } from '../core/types'
import type { FacialExpressionId } from '../core/expressions'
import { useAssetLibrary } from '../assets/AssetLibrary'
import { useCharacterState } from '../state/CharacterState'
import { WardrobeManager } from './WardrobeManager'
import { captureAnimatedPose, IdleAnimation, recalibrateAfterMorph, type AnimatedPoseSnapshot, type CharacterAnimationMode } from './IdleAnimation'
import { createMakeHumanInstance, disposeMakeHumanMouth, morphMakeHuman, type MakeHumanInstance } from '../makehuman/MakeHumanRuntime'
import { loadMhmat } from '../makehuman/MhmatRuntime'
import { loadMakeHumanBase } from '../makehuman/TargetLoader'

import { applySkinSurface } from './SkinSurface'

const NO_MHMAT = Promise.resolve(null)

function SkinSurface({ instance, config, revision }: { instance: MakeHumanInstance; config: CharacterConfig; revision: number }) {
  const { manifest } = useAssetLibrary()
  const appearance = config.appearance
  const skinDetail = useTexture('/assets/mpfb/textures/skin_detail.jpg')
  const selected = manifest?.skins.find((skin) => skin.id === appearance.skinMaterialId)
  const skin = use(selected?.materialUrl ? loadMhmat(selected.materialUrl) : NO_MHMAT)

  useEffect(() => {
    applySkinSurface(instance, config, skinDetail, skin)
  }, [appearance.skinColor, instance.skinMaterial, skin, skinDetail, revision])

  return null
}

export interface CharacterModelProps {
  config?: CharacterConfig
  animationMode?: CharacterAnimationMode
  expression?: FacialExpressionId
  onReady?: () => void
  revision?: number
}

export function CharacterModel({ config: configOverride, animationMode = 'sequence', expression = 'neutral', onReady, revision = 0 }: CharacterModelProps = {}) {
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
  const [fittedConfig, setFittedConfig] = useState(config)
  const [bodyRevision, setBodyRevision] = useState(0)
  const [faceRevision, setFaceRevision] = useState(0)
  const animationReady = useRef(false)
  const completed = useRef({ selection: -1, morph: 0, wardrobe: -1 })
  const requestedRevision = useRef(revision)
  requestedRevision.current = revision
  const readyReported = useRef(-1)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => () => { morphVersion.current++; disposeMakeHumanMouth(instance) }, [instance])

  const reportReady = useCallback(() => {
    const current = requestedRevision.current, ready = completed.current
    if (readyReported.current === current || !animationReady.current || ready.selection !== current || ready.morph !== ready.wardrobe) return
    readyReported.current = current
    onReadyRef.current?.()
  }, [])
  const handleAnimationReady = useCallback(() => {
    animationReady.current = true
    reportReady()
  }, [reportReady])
  const handleWardrobeReady = useCallback(() => {
    if (completed.current.selection !== revision || completed.current.morph !== morphRevision) return
    completed.current.wardrobe = morphRevision
    reportReady()
  }, [reportReady, revision, morphRevision])

  // Material-only changes must never refit the skeleton. Previously changing an
  // eye colour or skin texture ran the entire MakeHuman morph pipeline.
  useEffect(() => {
    instance.irisMaterial.color.set(config.appearance.eyeColor)
    instance.irisMaterial.needsUpdate = true
  }, [instance, config.appearance.eyeColor, morphRevision])

  useEffect(() => {
    const version = ++morphVersion.current
    const bodyChanged = lastBodyRef.current !== config.body
    const faceChanged = lastFaceRef.current !== config.face
    const expressionChanged = lastExpressionRef.current !== expression
    const isCurrent = () => version === morphVersion.current && requestedRevision.current === revision
    const timer = window.setTimeout(() => {
      let pose: AnimatedPoseSnapshot | null = null
      void morphMakeHuman(instance, config, isCurrent, expression, () => {
        // Capture the pose at commit, not before network/cooperative work.
        pose = completed.current.morph > 0 ? captureAnimatedPose(instance) : null
      })
        .then(async () => {
          if (!isCurrent()) return
          await recalibrateAfterMorph(instance, pose, isCurrent)
          if (!isCurrent()) return
          // Compare against the last completed fit, not a cancelled request.
          // Otherwise an expression change during a body load can suppress the
          // garment refit that the new proportions still require.
          lastBodyRef.current = config.body
          lastFaceRef.current = config.face
          lastExpressionRef.current = expression
          if (bodyChanged || morphRevision === 0) setBodyRevision((current) => current + 1)
          if (faceChanged || expressionChanged || morphRevision === 0) setFaceRevision((current) => current + 1)
          completed.current.selection = revision
          completed.current.wardrobe = -1
          const serial = ++completed.current.morph
          setFittedConfig(config)
          setMorphRevision(serial)
        })
        .catch((error) => {
          if (isCurrent() && error?.name !== 'AbortError') addAssetError(`Morph MakeHuman: ${error instanceof Error ? error.message : String(error)}`)
        })
    }, 38)
    return () => { window.clearTimeout(timer); morphVersion.current++ }
  }, [instance, config.body, config.face, expression, addAssetError, revision])

  return <group>
    <SkinSurface instance={instance} config={config} revision={morphRevision} />
    {morphRevision > 0 ? <IdleAnimation instance={instance} mode={animationMode} onReady={handleAnimationReady} /> : null}
    <primitive object={instance.root} />
    {morphRevision > 0 ? <WardrobeManager instance={instance} bodyRevision={bodyRevision} faceRevision={faceRevision} config={completed.current.selection === revision ? config : fittedConfig} onReady={handleWardrobeReady} /> : null}
  </group>
}
