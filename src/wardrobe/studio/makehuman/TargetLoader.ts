import type { MakeHumanBaseData, SparseTarget } from './types'

const BASE_URL = '/assets/mpfb/base.runtime.json.gz'
const TARGET_ROOT = '/assets/mpfb/targets'
const SCALE = 0.1
const MAX_TARGET_CACHE = 160

let basePromise: Promise<MakeHumanBaseData> | null = null
const targetCache = new Map<string, Promise<SparseTarget>>()

async function responseTextMaybeGzip(response: Response) {
  if (!response.ok) throw new Error(`Asset MakeHuman indisponible (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  if (!isGzip) return new TextDecoder().decode(bytes)
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Ce navigateur ne prend pas en charge DecompressionStream (gzip), requis pour les morphs MPFB.')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function touchCache(key: string, value: Promise<SparseTarget>) {
  targetCache.delete(key)
  targetCache.set(key, value)
  while (targetCache.size > MAX_TARGET_CACHE) {
    const oldest = targetCache.keys().next().value as string | undefined
    if (!oldest) break
    targetCache.delete(oldest)
  }
}

export function loadMakeHumanBase() {
  if (!basePromise) {
    const pending = fetch(BASE_URL)
      .then(responseTextMaybeGzip)
      .then((text) => JSON.parse(text) as MakeHumanBaseData)
    basePromise = pending
    void pending.catch(() => { if (basePromise === pending) basePromise = null })
  }
  return basePromise
}

export function loadSparseTarget(path: string) {
  const normalized = path.replace(/^\/+/, '').replace(/\.target(?:\.gz)?$/, '')
  let pending = targetCache.get(normalized)
  if (pending) {
    touchCache(normalized, pending)
    return pending
  }
  pending = fetch(`${TARGET_ROOT}/${normalized}.target.gz`)
    .then(responseTextMaybeGzip)
    .then(parseTarget)
  touchCache(normalized, pending)
  void pending.catch(() => {
    if (targetCache.get(normalized) === pending) targetCache.delete(normalized)
  })
  return pending
}

function parseTarget(text: string): SparseTarget {
  const indices: number[] = []
  const delta: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('"')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue
    const index = Number.parseInt(parts[0], 10)
    if (!Number.isFinite(index)) continue
    // MakeHuman target files use source mesh axes (X, height/Y, depth/Z). Once
    // HM08 is brought to Three.js' Y-up frame the three delta fields map directly.
    indices.push(index)
    delta.push(Number(parts[1]) * SCALE, Number(parts[2]) * SCALE, Number(parts[3]) * SCALE)
  }
  return { indices: Uint32Array.from(indices), delta: Float32Array.from(delta) }
}

export function clearTargetCache() { targetCache.clear() }
