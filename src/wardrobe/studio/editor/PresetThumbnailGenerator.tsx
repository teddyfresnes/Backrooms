import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three'
import { CharacterModel } from '../character/CharacterModel'
import { heightCmFromMorph } from '../core/humanMeasurements'
import { StudioEnvironment } from '../viewport/EditorViewport'
import type { CharacterOption } from './characterOptions'

export type PresetThumbnailMap = Record<string, string>

export const PRESET_THUMB_CACHE_KEY = 'backrooms/wardrobe/preset-thumbnails/runtime-v3'

export function readPresetThumbnailCache(): PresetThumbnailMap {
  try {
    const raw = localStorage.getItem(PRESET_THUMB_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PresetThumbnailMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writePresetThumbnailCache(images: PresetThumbnailMap) {
  try { localStorage.setItem(PRESET_THUMB_CACHE_KEY, JSON.stringify(images)) } catch { /* private mode / quota */ }
}

function PortraitCamera({ option }: { option: CharacterOption }) {
  const { camera } = useThree()
  const target = useMemo(() => {
    const heightM = heightCmFromMorph(option.config.body.height ?? 0, option.config.body.gender ?? -1) / 100
    // A head-and-shoulders crop derived from the actual character height.
    return new Vector3(0, heightM - 0.225, 0)
  }, [option])

  useEffect(() => {
    camera.position.set(0, target.y + 0.015, 0.88)
    if (camera instanceof PerspectiveCamera) {
      camera.fov = 27
      camera.near = 0.03
      camera.far = 20
      camera.updateProjectionMatrix()
    }
    camera.lookAt(target)
  }, [camera, target])
  return null
}

function CaptureFrame({ ready, onCapture }: { ready: boolean; onCapture: (dataUrl: string) => void }) {
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    // Give wardrobe/hair useEffects and GPU uploads two frames plus a short
    // settle window after the exact MakeHuman morph + Mixamo pose are ready.
    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (cancelled) return
        gl.render(scene, camera)
        try {
          const image = gl.domElement.toDataURL('image/webp', 0.9)
          if (image.length > 128) onCapture(image)
        } catch { /* preserveDrawingBuffer can still be blocked by a bad texture; retry on next mount */ }
      }))
    }, 360)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [camera, gl, onCapture, ready, scene])
  return null
}

function PortraitScene({ option, onCapture }: { option: CharacterOption; onCapture: (dataUrl: string) => void }) {
  const [ready, setReady] = useState(false)
  const handleReady = useCallback(() => setReady(true), [])

  return <>
    <StudioEnvironment />
    <Suspense fallback={null}>
      <CharacterModel key={option.id} config={option.config} animationMode="breathing-pose" onReady={handleReady} />
    </Suspense>
    <PortraitCamera option={option} />
    <CaptureFrame ready={ready} onCapture={onCapture} />
  </>
}

export function PresetThumbnailGenerator({
  options,
  images,
  onGenerated,
}: {
  options: CharacterOption[]
  images: PresetThumbnailMap
  onGenerated: (id: string, dataUrl: string) => void
}) {
  const current = options.find((option) => !images[option.id])
  const handleCapture = useCallback((dataUrl: string) => {
    if (current) onGenerated(current.id, dataUrl)
  }, [current, onGenerated])

  if (!current) return null

  return <div className="preset-thumbnail-generator" aria-hidden="true">
    <Canvas
      key={current.id}
      camera={{ position: [0, 1.55, 0.88], fov: 27, near: 0.03, far: 20 }}
      dpr={2}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping
        gl.toneMappingExposure = 0.94
        gl.outputColorSpace = SRGBColorSpace
        gl.setClearAlpha(0)
      }}
    >
      <PortraitScene option={current} onCapture={handleCapture} />
    </Canvas>
  </div>
}
