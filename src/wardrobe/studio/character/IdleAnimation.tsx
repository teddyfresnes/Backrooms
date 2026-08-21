import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  LoopOnce,
  LoopRepeat,
  Object3D,
  Quaternion,
  type SkinnedMesh,
  Vector3,
} from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { refitMakeHumanEyes, type MakeHumanInstance } from '../makehuman/MakeHumanRuntime'

const MOTIONS = [
  { id: 'offensive', url: '/assets/characters/animations/OffensiveIdle.fbx', label: 'Offensive Idle' },
  { id: 'breathing-a', url: '/assets/characters/animations/BreathingIdle.fbx', label: 'Breathing Idle' },
  { id: 'looking', url: '/assets/characters/animations/LookingAround.fbx', label: 'Looking Around' },
  { id: 'breathing-b', url: '/assets/characters/animations/BreathingIdle.fbx', label: 'Breathing Idle' },
] as const

const CROSS_FADE = 0.32

type LoadedMotion = {
  id: string
  label: string
  root: Object3D
  clip: AnimationClip
  bonesByKey: Map<string, Bone>
}

type TargetRest = {
  bone: Bone
  worldPosition: Vector3
}

export type CharacterAnimationMode = 'sequence' | 'breathing-pose' | 'breathing-loop'
export type AnimatedPoseSnapshot = Map<Bone, Quaternion>

let motionsPromise: Promise<LoadedMotion[]> | null = null

function boneKey(name: string) {
  return name
    .toLowerCase()
    .replace(/^.*mixamorig[:_]?/, '')
    .replace(/[^a-z0-9]/g, '')
}

function isFingerBone(name: string) {
  const key = boneKey(name)
  return /(thumb|index|middle|ring|pinky)/.test(key)
}

function collectBones(root: Object3D) {
  const map = new Map<string, Bone>()
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    const bone = object as Bone
    if (!bone.isBone) return
    map.set(boneKey(bone.name), bone)
  })
  return map
}

function loadMotion(entry: (typeof MOTIONS)[number]): Promise<LoadedMotion | null> {
  return new Promise((resolve) => {
    new FBXLoader().load(
      entry.url,
      (fbx) => {
        const source = fbx.animations[0]
        if (!source) { resolve(null); return }
        const bonesByKey = collectBones(fbx)
        if (!bonesByKey.size) { resolve(null); return }
        resolve({ id: entry.id, label: entry.label, root: fbx, clip: source, bonesByKey })
      },
      undefined,
      () => resolve(null),
    )
  })
}

function loadMotions() {
  if (motionsPromise) return motionsPromise
  motionsPromise = Promise.all(MOTIONS.map(loadMotion)).then((items) => items.filter((item): item is LoadedMotion => Boolean(item)))
  return motionsPromise
}

function targetBonesInHierarchy(instance: MakeHumanInstance) {
  const result: Bone[] = []
  instance.root.traverse((object) => {
    const bone = object as Bone
    if (bone.isBone) result.push(bone)
  })
  return result
}

/**
 * The MPFB "mixamo" rig and the actual Mixamo auto-rigger share bone names and
 * hierarchy, but not necessarily the same local bone axes. Mixamo animation
 * quaternions are absolute local rotations, so blindly copying them onto the
 * MPFB rest axes can twist the body badly.
 *
 * We use the auto-rigged FBX itself as the orientation reference. For every
 * matched bone we copy Mixamo's local rest quaternion while preserving the
 * MakeHuman joint's current WORLD position. Recalculating inverse bind matrices
 * afterward keeps the current mesh shape intact while making future Mixamo
 * quaternion tracks live in the correct local coordinate system.
 */
function calibrateTargetRig(instance: MakeHumanInstance, reference: LoadedMotion) {
  instance.root.updateMatrixWorld(true)

  const targetBones = targetBonesInHierarchy(instance)
  const rest: TargetRest[] = targetBones.map((bone) => ({
    bone,
    worldPosition: bone.getWorldPosition(new Vector3()),
  }))

  // Parents appear before children in Object3D.traverse(), which is important:
  // each child's local position is recomputed against the already-calibrated
  // parent transform so its world-space joint pivot stays exactly where the
  // MakeHuman morph system placed it.
  for (const { bone, worldPosition } of rest) {
    const sourceBone = reference.bonesByKey.get(boneKey(bone.name))
    if (!sourceBone) continue

    const parent = bone.parent
    if (parent) {
      parent.updateWorldMatrix(true, false)
      bone.position.copy(parent.worldToLocal(worldPosition.clone()))
    } else {
      bone.position.copy(worldPosition)
    }

    bone.quaternion.copy(sourceBone.quaternion)
    bone.scale.set(1, 1, 1)
    bone.updateMatrix()
    bone.updateWorldMatrix(false, false)

    // Keep the MakeHuman rest metadata coherent with the new calibrated bind
    // pose. morphMakeHuman() will overwrite these again whenever proportions
    // change, then this calibration is run again for the new body shape.
    bone.userData.mhRestPosition = bone.position.toArray()
    bone.userData.mhRestQuaternion = bone.quaternion.toArray()
    bone.userData.mhRestScale = bone.scale.toArray()
  }

  instance.root.updateMatrixWorld(true)
  instance.skeleton.calculateInverses()

  // The body and every MHCLO asset are authored in CharacterRoot-local space.
  // Never capture matrixWorld here: it also contains the interactive turntable
  // yaw, so recalibrating while viewed from the side made the body and newly
  // mounted clothes use different bind spaces. Keep every mesh sharing this
  // skeleton on the same root-local identity bind.
  instance.root.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh || mesh.skeleton !== instance.skeleton) return
    mesh.bindMatrix.identity()
    mesh.bindMatrixInverse.identity()
  })
  instance.root.updateMatrixWorld(true)
}

export function captureAnimatedPose(instance: MakeHumanInstance): AnimatedPoseSnapshot {
  return new Map(instance.bones.map((bone) => [bone, bone.quaternion.clone()]))
}

/**
 * Refit the Mixamo-oriented bind skeleton after a MakeHuman morph while keeping
 * the currently visible animation pose. This prevents the one-frame T-pose
 * flash that used to happen on every slider movement.
 */
export async function recalibrateAfterMorph(instance: MakeHumanInstance, pose?: AnimatedPoseSnapshot | null) {
  const motions = await loadMotions()
  const reference = motions[0]
  if (!reference) return
  calibrateTargetRig(instance, reference)
  refitMakeHumanEyes(instance)
  if (pose) {
    for (const [bone, quaternion] of pose) bone.quaternion.copy(quaternion)
    instance.root.updateMatrixWorld(true)
  }
}

function makeTargetClip(instance: MakeHumanInstance, motion: LoadedMotion) {
  const targetByKey = new Map(instance.bones.map((bone) => [boneKey(bone.name), bone]))

  const tracks = motion.clip.tracks.flatMap((track) => {
    // Deliberately keep rotations only. Position/scale channels from an FBX are
    // expressed in Mixamo's own centimeter-sized rig and would fight the live
    // MakeHuman proportions. The result is motion only, never body reshaping.
    if (!track.name.endsWith('.quaternion')) return []

    const sourceName = track.name.slice(0, -'.quaternion'.length)

    // The body retarget is stable, but Mixamo finger chains have tiny axis/rest
    // differences that can turn into explosive curls on some clips (especially
    // Offensive Idle). Keep fingers in their MakeHuman neutral bind pose while
    // preserving the wrist/hand/arm animation.
    if (motion.id === 'offensive' && isFingerBone(sourceName)) return []

    const targetBone = targetByKey.get(boneKey(sourceName))
    if (!targetBone) return []

    const next = track.clone()
    next.name = `${targetBone.name}.quaternion`
    return [next]
  })

  return tracks.length
    ? new AnimationClip(`Wardrobe_${motion.id}`, motion.clip.duration, tracks)
    : null
}

function stopAction(action: AnimationAction | null) {
  if (!action) return
  action.stop()
}

export function IdleAnimation({
  instance,
  mode = 'sequence',
  onReady,
}: {
  instance: MakeHumanInstance
  mode?: CharacterAnimationMode
  onReady?: () => void
}) {
  const mixerRef = useRef<AnimationMixer | null>(null)
  const currentActionRef = useRef<AnimationAction | null>(null)
  const clipsRef = useRef<AnimationClip[]>([])
  const breathingClipRef = useRef<AnimationClip | null>(null)
  const sequenceIndexRef = useRef(0)
  const modeRef = useRef<CharacterAnimationMode>(mode)
  const readyCallbackRef = useRef(onReady)

  useEffect(() => { readyCallbackRef.current = onReady }, [onReady])

  const playModeRef = useRef<(nextMode: CharacterAnimationMode, firstStart?: boolean) => void>(() => {})
  playModeRef.current = (nextMode, firstStart = false) => {
    const mixer = mixerRef.current
    const clips = clipsRef.current
    if (!mixer || !clips.length) return
    modeRef.current = nextMode

    const previous = currentActionRef.current
    if (previous) previous.paused = false

    if (nextMode === 'breathing-pose') {
      const clip = breathingClipRef.current ?? clips[0]
      const next = mixer.clipAction(clip)
      next.reset().setLoop(LoopRepeat, Infinity).play()
      const portraitTime = Math.min(Math.max(clip.duration * 0.22, 0.55), 1.2)
      mixer.setTime(portraitTime)
      next.paused = true
      currentActionRef.current = next
      return
    }

    if (nextMode === 'breathing-loop') {
      const clip = breathingClipRef.current ?? clips[0]
      const next = mixer.clipAction(clip)
      next.reset().setLoop(LoopRepeat, Infinity)
      next.enabled = true
      next.paused = false
      next.setEffectiveTimeScale(0.82)
      next.setEffectiveWeight(1)
      next.play()
      if (previous && previous !== next && !firstStart) next.crossFadeFrom(previous, 0.18, true)
      currentActionRef.current = next
      return
    }

    sequenceIndexRef.current = 0
    const next = mixer.clipAction(clips[0])
    next.reset().setLoop(LoopOnce, 1)
    next.clampWhenFinished = true
    next.enabled = true
    next.paused = false
    next.setEffectiveTimeScale(1)
    next.setEffectiveWeight(1)
    next.play()
    if (previous && previous !== next && !firstStart) next.crossFadeFrom(previous, CROSS_FADE, true)
    currentActionRef.current = next
  }

  useEffect(() => {
    let cancelled = false
    let mixer: AnimationMixer | null = null

    const onFinished = () => {
      if (cancelled || modeRef.current !== 'sequence') return
      const activeMixer = mixerRef.current
      const clips = clipsRef.current
      if (!activeMixer || !clips.length) return
      const previous = currentActionRef.current
      sequenceIndexRef.current = (sequenceIndexRef.current + 1) % clips.length
      const next = activeMixer.clipAction(clips[sequenceIndexRef.current])
      next.reset().setLoop(LoopOnce, 1)
      next.clampWhenFinished = true
      next.enabled = true
      next.paused = false
      next.setEffectiveTimeScale(1)
      next.setEffectiveWeight(1)
      next.play()
      if (previous && previous !== next) next.crossFadeFrom(previous, CROSS_FADE, true)
      currentActionRef.current = next
    }

    void loadMotions().then((motions) => {
      if (cancelled || !motions.length) return

      clipsRef.current = MOTIONS.flatMap((entry) => {
        const motion = motions.find((candidate) => candidate.id === entry.id)
        if (!motion) return []
        const clip = makeTargetClip(instance, motion)
        return clip ? [clip] : []
      })
      if (!clipsRef.current.length || cancelled) return

      const breathingMotion = motions.find((entry) => entry.id === 'breathing-a')
      breathingClipRef.current = breathingMotion ? makeTargetClip(instance, breathingMotion) : null

      mixer = new AnimationMixer(instance.root)
      mixerRef.current = mixer
      mixer.addEventListener('finished', onFinished)
      playModeRef.current(modeRef.current, true)
      readyCallbackRef.current?.()
    })

    return () => {
      cancelled = true
      if (mixer) {
        mixer.removeEventListener('finished', onFinished)
        stopAction(currentActionRef.current)
        mixer.stopAllAction()
        for (const clip of clipsRef.current) mixer.uncacheClip(clip)
        if (breathingClipRef.current) mixer.uncacheClip(breathingClipRef.current)
        mixer.uncacheRoot(instance.root)
      }
      mixerRef.current = null
      currentActionRef.current = null
      clipsRef.current = []
      breathingClipRef.current = null
    }
  }, [instance])

  useEffect(() => {
    modeRef.current = mode
    if (mixerRef.current) playModeRef.current(mode)
  }, [mode])

  useFrame((_, dt) => mixerRef.current?.update(Math.min(dt, 0.05)))
  return null
}
