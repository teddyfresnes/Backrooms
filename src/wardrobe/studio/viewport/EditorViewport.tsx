import { Component, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type PropsWithChildren } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Html, Lightformer } from '@react-three/drei'
import { ACESFilmicToneMapping, Group, MathUtils, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three'
import { CharacterModel } from '../character/CharacterModel'
import { useAssetLibrary } from '../assets/AssetLibrary'

export type WardrobeCameraFocus =
  | 'overview' | 'general' | 'skin' | 'eyes' | 'hair' | 'eyebrows' | 'eyelashes' | 'beard' | 'nails' | 'top' | 'bottom' | 'shoes'
  | 'head' | 'nose' | 'mouth' | 'jaw' | 'cheeks' | 'chin' | 'forehead' | 'brows' | 'ears'
  | 'breast' | 'shoulders' | 'torso' | 'stomach' | 'waist' | 'hips' | 'buttocks'
  | 'arms' | 'legs' | 'hands' | 'feet' | 'neck'

interface CameraProfile {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

const MEDIUM: CameraProfile = { position: [0, 1.17, 3.25], target: [0, 1.04, 0], fov: 34 }
const HEAD: CameraProfile = { position: [0, 1.58, 1.02], target: [0, 1.56, 0], fov: 27 }
const EYES: CameraProfile = { position: [0, 1.62, 0.70], target: [0, 1.61, 0], fov: 23 }
const TORSO: CameraProfile = { position: [0, 1.18, 1.85], target: [0, 1.13, 0], fov: 32 }
const HIPS: CameraProfile = { position: [0, 0.78, 1.95], target: [0, 0.76, 0], fov: 32 }
const LEGS: CameraProfile = { position: [0, 0.53, 2.12], target: [0, 0.50, 0], fov: 32 }
const FEET: CameraProfile = { position: [0, 0.18, 1.46], target: [0, 0.16, 0], fov: 30 }
const ARMS: CameraProfile = { position: [0, 1.05, 2.24], target: [0, 1.00, 0], fov: 33 }
const HANDS: CameraProfile = { position: [0, 0.93, 1.62], target: [0, 0.91, 0], fov: 29 }

const CAMERA_BY_FOCUS: Readonly<Partial<Record<WardrobeCameraFocus, CameraProfile>>> = {
  overview: MEDIUM,
  general: MEDIUM,
  skin: HEAD,
  eyes: EYES,
  hair: HEAD,
  eyebrows: EYES,
  eyelashes: EYES,
  beard: HEAD,
  nails: HANDS,
  head: HEAD,
  nose: EYES,
  mouth: HEAD,
  jaw: HEAD,
  cheeks: HEAD,
  chin: HEAD,
  forehead: HEAD,
  brows: EYES,
  ears: HEAD,
  neck: HEAD,
  top: TORSO,
  breast: TORSO,
  shoulders: TORSO,
  torso: TORSO,
  stomach: TORSO,
  waist: TORSO,
  bottom: HIPS,
  hips: HIPS,
  buttocks: HIPS,
  arms: ARMS,
  hands: HANDS,
  legs: LEGS,
  shoes: FEET,
  feet: FEET,
}

const EYE_FOCUSES = new Set<WardrobeCameraFocus>(['eyes', 'eyebrows', 'eyelashes', 'brows'])
const HEAD_FOCUSES = new Set<WardrobeCameraFocus>(['skin', 'hair', 'head', 'nose', 'mouth', 'jaw', 'cheeks', 'chin', 'forehead', 'ears', 'neck', ...EYE_FOCUSES])
const INSPECTION_FOCUSES = new Set<WardrobeCameraFocus>([...HEAD_FOCUSES, 'hands', 'nails'])

class ViewportErrorBoundary extends Component<PropsWithChildren, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack) }
  render() { return this.state.error ? <Html center><div className="viewport-message">Personnage indisponible</div></Html> : this.props.children }
}

function CameraRig({ focus }: { focus: WardrobeCameraFocus }) {
  const { camera, scene } = useThree()
  const lookTarget = useRef(new Vector3(...MEDIUM.target))
  const desiredTarget = useRef(new Vector3(...MEDIUM.target))
  const leftEye = useRef(new Vector3())
  const rightEye = useRef(new Vector3())
  const profile = useMemo(() => CAMERA_BY_FOCUS[focus] ?? MEDIUM, [focus])

  useFrame((_, dt) => {
    const lambda = 8.5
    desiredTarget.current.set(...profile.target)
    let dynamicY = false

    if (EYE_FOCUSES.has(focus)) {
      const left = scene.getObjectByName('LeftEye')
      const right = scene.getObjectByName('RightEye')
      if (left && right) {
        left.getWorldPosition(leftEye.current)
        right.getWorldPosition(rightEye.current)
        desiredTarget.current.copy(leftEye.current).add(rightEye.current).multiplyScalar(0.5)
        dynamicY = true
      }
    } else if (HEAD_FOCUSES.has(focus)) {
      const head = scene.getObjectByName('mixamorigHead') ?? scene.getObjectByName('Head')
      if (head) {
        head.getWorldPosition(desiredTarget.current)
        desiredTarget.current.y += focus === 'skin' || focus === 'hair' ? 0.035 : 0.015
        dynamicY = true
      }
    }

    const cameraYOffset = profile.position[1] - profile.target[1]
    const cameraY = dynamicY ? desiredTarget.current.y + cameraYOffset : profile.position[1]
    camera.position.x = MathUtils.damp(camera.position.x, profile.position[0], lambda, dt)
    camera.position.y = MathUtils.damp(camera.position.y, cameraY, lambda, dt)
    camera.position.z = MathUtils.damp(camera.position.z, profile.position[2], lambda, dt)
    lookTarget.current.x = MathUtils.damp(lookTarget.current.x, desiredTarget.current.x, lambda, dt)
    lookTarget.current.y = MathUtils.damp(lookTarget.current.y, desiredTarget.current.y, lambda, dt)
    lookTarget.current.z = MathUtils.damp(lookTarget.current.z, desiredTarget.current.z, lambda, dt)
    if (camera instanceof PerspectiveCamera) {
      camera.fov = MathUtils.damp(camera.fov, profile.fov, lambda, dt)
      camera.updateProjectionMatrix()
    }
    camera.lookAt(lookTarget.current)
  })
  return null
}

function CharacterTurntable({ visible = true, onReady, animationMode = 'sequence' }: { visible?: boolean; onReady?: () => void; animationMode?: 'sequence' | 'breathing-loop' }) {
  const group = useRef<Group>(null)
  const dragging = useRef(false)
  const pointerX = useRef(0)
  const startRotation = useRef(0)
  const returnAt = useRef(0)
  const { gl } = useThree()

  useFrame((_, dt) => {
    if (!group.current || dragging.current) return
    if (performance.now() < returnAt.current) return
    group.current.rotation.y = MathUtils.damp(group.current.rotation.y, 0, 8.5, dt)
  })

  useEffect(() => {
    const canvas = gl.domElement
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragging.current = true
      returnAt.current = Number.POSITIVE_INFINITY
      pointerX.current = event.clientX
      startRotation.current = group.current?.rotation.y ?? 0
      canvas.setPointerCapture?.(event.pointerId)
      canvas.classList.add('dragging-character')
    }
    const pointerMove = (event: PointerEvent) => {
      if (!dragging.current || !group.current) return
      const dx = event.clientX - pointerX.current
      group.current.rotation.y = MathUtils.clamp(startRotation.current + dx * 0.009, -1.25, 1.25)
    }
    const pointerUp = (event: PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      returnAt.current = performance.now() + 4000
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      canvas.classList.remove('dragging-character')
    }

    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointercancel', pointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerUp)
      canvas.classList.remove('dragging-character')
    }
  }, [gl])

  return <group ref={group} visible={visible}>
    <CharacterModel onReady={onReady} animationMode={animationMode} />
  </group>
}

export function StudioEnvironment() {
  const { manifest } = useAssetLibrary()
  const hdri = manifest?.environment?.studioHDRI
  return <>
    <ambientLight intensity={0.38} />
    <directionalLight position={[4, 6, 4]} intensity={2.0} />
    <directionalLight position={[-4, 3, 2]} intensity={1.1} />
    {hdri ? <Environment files={hdri} /> : <Environment resolution={64}><group rotation={[0, -0.4, 0]}><Lightformer intensity={2.2} position={[0, 4, -4]} scale={[10, 1, 1]} /><Lightformer intensity={1.6} position={[-4, 2, 1]} rotation={[0, Math.PI / 2, 0]} scale={[8, 1.5, 1]} /></group></Environment>}
  </>
}

function Scene({ focus, ready, onReady, animationMode, modelKey }: { focus: WardrobeCameraFocus; ready: boolean; onReady: () => void; animationMode: 'sequence' | 'breathing-loop'; modelKey: number }) {
  return <>
    <StudioEnvironment />
    <Suspense fallback={<Html center><div className="viewport-message">Chargement…</div></Html>}>
      <ViewportErrorBoundary><CharacterTurntable key={modelKey} visible={ready} onReady={onReady} animationMode={animationMode} /></ViewportErrorBoundary>
    </Suspense>
    <ContactShadows position={[0, 0.005, 0]} opacity={0.42} scale={4} blur={2.2} far={3} />
    <CameraRig focus={focus} />
  </>
}

export function EditorViewport({ focus = 'overview', externalLoading = false, onCharacterReady, modelKey = 0 }: { focus?: WardrobeCameraFocus; externalLoading?: boolean; onCharacterReady?: () => void; modelKey?: number }) {
  const [ready, setReady] = useState(false)
  const activeModelKey = useRef(modelKey)

  useEffect(() => {
    activeModelKey.current = modelKey
    setReady(false)
  }, [modelKey])

  useEffect(() => { if (externalLoading) setReady(false) }, [externalLoading])

  const handleReady = () => {
    if (activeModelKey.current !== modelKey) return
    setReady(true)
    onCharacterReady?.()
  }

  const showLoading = externalLoading || !ready
  const animationMode: 'sequence' | 'breathing-loop' = INSPECTION_FOCUSES.has(focus) ? 'breathing-loop' : 'sequence'
  return <main className={`viewport-shell viewport-shell-studio${showLoading ? ' is-loading' : ''}`}>
    <div className="viewport-studio-bg" aria-hidden="true" />
    <Canvas shadows camera={{ position: MEDIUM.position, fov: MEDIUM.fov, near: 0.05, far: 100 }} dpr={[1, 1.25]} gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => { gl.toneMapping = ACESFilmicToneMapping; gl.toneMappingExposure = 0.94; gl.outputColorSpace = SRGBColorSpace; gl.setClearAlpha(0) }}>
      <Scene focus={focus} ready={ready} onReady={handleReady} animationMode={animationMode} modelKey={modelKey} />
    </Canvas>
    {showLoading ? <div className="viewport-loading-overlay" aria-live="polite">
      <div className="viewport-loading-badge">Chargement du personnage…</div>
    </div> : null}
  </main>
}
