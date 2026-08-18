import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three'
import { AssetLibrary } from '../assets/AssetLibrary'
import { CharacterModel } from '../character/CharacterModel'
import { heightCmFromMorph } from '../core/humanMeasurements'
import { StudioEnvironment } from '../viewport/EditorViewport'
import { CHARACTER_OPTIONS, type CharacterOption } from './characterOptions'

export interface PreviewExportProgress {
  completed: number
  total: number
  current: string
  percent: number
}

interface PreviewFile {
  name: string
  bytes: Uint8Array
}

const textEncoder = new TextEncoder()

function dataUrlToBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Capture WebP invalide')
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[n] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function zipDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
  }
}

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function makeStoredZip(files: PreviewFile[]) {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  const { time, date } = zipDateTime()
  let localOffset = 0

  for (const file of files) {
    const name = textEncoder.encode(file.name)
    const crc = crc32(file.bytes)
    const localHeader = new Uint8Array(30)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0, true)
    localView.setUint16(8, 0, true) // stored: previews are already WebP-compressed
    localView.setUint16(10, time, true)
    localView.setUint16(12, date, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, file.bytes.byteLength, true)
    localView.setUint32(22, file.bytes.byteLength, true)
    localView.setUint16(26, name.byteLength, true)
    localView.setUint16(28, 0, true)
    localChunks.push(localHeader, name, file.bytes)

    const centralHeader = new Uint8Array(46)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, time, true)
    centralView.setUint16(14, date, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, file.bytes.byteLength, true)
    centralView.setUint32(24, file.bytes.byteLength, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, localOffset, true)
    centralChunks.push(centralHeader, name)

    localOffset += localHeader.byteLength + name.byteLength + file.bytes.byteLength
  }

  const localData = concatBytes(localChunks)
  const centralData = concatBytes(centralChunks)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralData.byteLength, true)
  endView.setUint32(16, localData.byteLength, true)
  endView.setUint16(20, 0, true)

  return new Blob([localData, centralData, end], { type: 'application/zip' })
}

function PortraitCamera({ option }: { option: CharacterOption }) {
  const { camera } = useThree()
  const target = useMemo(() => {
    const heightM = heightCmFromMorph(option.config.body.height ?? 0, option.config.body.gender ?? -1) / 100
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

function CaptureFrame({ ready, onCapture, onError }: { ready: boolean; onCapture: (dataUrl: string) => void; onError: (message: string) => void }) {
  const { gl, scene, camera } = useThree()
  const captured = useRef(false)

  useEffect(() => {
    captured.current = false
  }, [ready])

  useEffect(() => {
    if (!ready || captured.current) return
    let cancelled = false
    // Intentionally generous: this export is an explicit developer operation.
    // It gives hair, wardrobe, skin textures and GPU uploads time to settle so
    // the saved image is the exact final runtime character, not a half-loaded frame.
    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (cancelled || captured.current) return
        try {
          gl.render(scene, camera)
          const image = gl.domElement.toDataURL('image/webp', 0.94)
          if (image.length <= 128) throw new Error('Capture WebP vide')
          captured.current = true
          onCapture(image)
        } catch (error) {
          onError(error instanceof Error ? error.message : 'Impossible de capturer le canvas')
        }
      }))
    }, 1600)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [camera, gl, onCapture, onError, ready, scene])

  return null
}

function CaptureScene({ option, onCapture, onError }: { option: CharacterOption; onCapture: (dataUrl: string) => void; onError: (message: string) => void }) {
  const [ready, setReady] = useState(false)
  const handleReady = useCallback(() => setReady(true), [])

  return <>
    <StudioEnvironment />
    <Suspense fallback={null}>
      <CharacterModel key={option.id} config={option.config} animationMode="breathing-pose" onReady={handleReady} />
    </Suspense>
    <PortraitCamera option={option} />
    <CaptureFrame ready={ready} onCapture={onCapture} onError={onError} />
  </>
}

function ExportRenderer({
  onProgress,
  onComplete,
  onError,
}: {
  onProgress: (progress: PreviewExportProgress) => void
  onComplete: (zip: Blob) => void
  onError: (message: string) => void
}) {
  const [index, setIndex] = useState(0)
  const files = useRef<PreviewFile[]>([])
  const option = CHARACTER_OPTIONS[index]

  const handleCapture = useCallback((dataUrl: string) => {
    try {
      if (!option) return
      files.current.push({ name: `previews/${option.id}.webp`, bytes: dataUrlToBytes(dataUrl) })
      const completed = index + 1
      onProgress({
        completed,
        total: CHARACTER_OPTIONS.length,
        current: option.label,
        percent: Math.round((completed / CHARACTER_OPTIONS.length) * 100),
      })

      if (completed >= CHARACTER_OPTIONS.length) {
        const manifest = {
          generatedAt: new Date().toISOString(),
          renderer: 'MakeHuman runtime / breathing-pose',
          files: CHARACTER_OPTIONS.map((entry) => ({ id: entry.id, name: entry.label, file: `previews/${entry.id}.webp` })),
        }
        files.current.push({ name: 'previews/manifest.json', bytes: textEncoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) })
        onComplete(makeStoredZip(files.current))
        return
      }

      window.setTimeout(() => setIndex(completed), 80)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Erreur pendant la capture')
    }
  }, [index, onComplete, onError, onProgress, option])

  useEffect(() => {
    if (!option) {
      onError('Preset introuvable')
      return
    }
    onProgress({
      completed: index,
      total: CHARACTER_OPTIONS.length,
      current: `Rendu : ${option.label}`,
      percent: Math.round((index / CHARACTER_OPTIONS.length) * 100),
    })
  }, [index, onError, onProgress, option])

  useEffect(() => {
    if (!option) return
    const watchdog = window.setTimeout(() => onError(`Timeout pendant le rendu de ${option.label}`), 45_000)
    return () => window.clearTimeout(watchdog)
  }, [index, onError, option])

  if (!option) return null

  return <div className="preview-export-renderer" aria-hidden="true">
    <Canvas
      key={option.id}
      camera={{ position: [0, 1.55, 0.88], fov: 27, near: 0.03, far: 20 }}
      dpr={1}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping
        gl.toneMappingExposure = 0.94
        gl.outputColorSpace = SRGBColorSpace
        gl.setClearAlpha(0)
      }}
    >
      <CaptureScene option={option} onCapture={handleCapture} onError={onError} />
    </Canvas>
  </div>
}

export function PresetPreviewExporter({
  active,
  onProgress,
  onComplete,
  onError,
}: {
  active: boolean
  onProgress: (progress: PreviewExportProgress) => void
  onComplete: (zip: Blob) => void
  onError: (message: string) => void
}) {
  if (!active) return null
  return <AssetLibrary>
    <ExportRenderer onProgress={onProgress} onComplete={onComplete} onError={onError} />
  </AssetLibrary>
}
