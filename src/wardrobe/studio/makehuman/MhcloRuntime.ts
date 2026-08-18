import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
} from 'three'
import type { MakeHumanInstance } from './MakeHumanRuntime'

export interface MhcloVertexMatch {
  verts: [number, number, number]
  weights: [number, number, number]
  offsets: [number, number, number]
}

export interface MhcloDefinition {
  name: string
  uuid?: string
  material?: string
  deleteVertices: number[]
  xScale?: [number, number, number]
  yScale?: [number, number, number]
  zScale?: [number, number, number]
  matches: MhcloVertexMatch[]
}

export interface MhcloTopology {
  vertexCount: number
  renderSource: Uint32Array
  uv: Float32Array
  indices: Uint32Array
}

export interface MhcloAssetData {
  definition: MhcloDefinition
  topology: MhcloTopology
  materialUrl?: string
}

const assetCache = new Map<string, Promise<MhcloAssetData>>()

async function decodeTextResponse(response: Response, url: string) {
  if (!response.ok) throw new Error(`MHCLO indisponible (${response.status}) : ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // Some dev/prod servers transparently decode .gz resources while preserving
  // the .gz URL. Detect the actual payload instead of blindly decompressing it.
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  if (!isGzip) return new TextDecoder().decode(bytes)
  if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne supporte pas la décompression gzip des assets MakeHuman')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

async function fetchText(url: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, attempt ? { cache: 'reload' } : undefined)
      return await decodeTextResponse(response, url)
    } catch (error) {
      lastError = error
      if (!attempt) await new Promise((resolve) => window.setTimeout(resolve, 60))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Asset MakeHuman illisible : ${url}`)
}

export function loadMhcloAsset(mhcloUrl: string, objUrl: string) {
  const key = `${mhcloUrl}|${objUrl}`
  let pending = assetCache.get(key)
  if (!pending) {
    pending = Promise.all([fetchText(mhcloUrl), fetchText(objUrl)])
      .then(([mhclo, obj]) => {
        const definition = parseMhclo(mhclo)
        const materialUrl = definition.material ? new URL(definition.material, new URL(mhcloUrl, window.location.href)).toString() : undefined
        return { definition, topology: parseObjTopology(obj), materialUrl }
      })
      .then((asset) => {
        if (asset.definition.matches.length !== asset.topology.vertexCount) {
          throw new Error(`MHCLO/OBJ incompatibles : ${asset.definition.matches.length} mappings pour ${asset.topology.vertexCount} sommets`)
        }
        return asset
      })
    assetCache.set(key, pending)
    // A transient fetch/decompression failure must not poison this asset for the
    // rest of the browser session. Allow a later preset switch to retry it.
    void pending.catch(() => {
      if (assetCache.get(key) === pending) assetCache.delete(key)
    })
  }
  return pending
}

export function parseMhclo(text: string): MhcloDefinition {
  const definition: MhcloDefinition = { name: 'MakeHuman clothing', matches: [], deleteVertices: [] }
  let readingVerts = false
  let readingDelete = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) { readingVerts = false; readingDelete = false; continue }
    if (line.startsWith('#') || line.startsWith('//')) continue
    const words = line.split(/\s+/)

    if (readingVerts && /^\d+$/.test(words[0])) {
      if (words.length === 1) {
        const v = Number(words[0])
        definition.matches.push({ verts: [v, v, v], weights: [1, 0, 0], offsets: [0, 0, 0] })
      } else if (words.length >= 9) {
        definition.matches.push({
          verts: [Number(words[0]), Number(words[1]), Number(words[2])],
          weights: [Number(words[3]), Number(words[4]), Number(words[5])],
          // File-space offsets become direct Three.js X/Y/Z offsets after the
          // same axis conversion used by MPFB's Blender fitting code.
          offsets: [Number(words[6]), Number(words[7]), Number(words[8])],
        })
      }
      continue
    }
    if (readingDelete && /^\d+$/.test(words[0])) {
      let previous: number | undefined
      let range = false
      for (const token of words) {
        if (token === '-') { range = true; continue }
        if (!/^\d+$/.test(token)) continue
        const current = Number(token)
        if (range && previous !== undefined) {
          for (let vertex = previous; vertex <= current; vertex++) definition.deleteVertices.push(vertex)
        } else definition.deleteVertices.push(current)
        previous = current
        range = false
      }
      continue
    }

    readingVerts = false
    readingDelete = false
    const key = words[0]
    if (key === 'verts') readingVerts = true
    else if (key === 'delete_verts') readingDelete = true
    else if (key === 'name' && words[1]) definition.name = words.slice(1).join(' ')
    else if (key === 'uuid' && words[1]) definition.uuid = words[1]
    else if (key === 'material' && words[1]) definition.material = words[1]
    else if (key === 'x_scale' && words.length >= 4) definition.xScale = [Number(words[1]), Number(words[2]), Number(words[3])]
    else if (key === 'y_scale' && words.length >= 4) definition.yScale = [Number(words[1]), Number(words[2]), Number(words[3])]
    else if (key === 'z_scale' && words.length >= 4) definition.zScale = [Number(words[1]), Number(words[2]), Number(words[3])]
  }

  return definition
}

export function parseObjTopology(text: string): MhcloTopology {
  const uvs: Array<[number, number]> = []
  const triangles: Array<Array<[number, number]>> = []
  let vertexCount = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('v ')) { vertexCount++; continue }
    if (line.startsWith('vt ')) {
      const [, us, vs] = line.split(/\s+/)
      uvs.push([Number(us), 1 - Number(vs)])
      continue
    }
    if (!line.startsWith('f ')) continue
    const face = line.split(/\s+/).slice(1).map((token) => {
      const [viRaw, tiRaw] = token.split('/')
      let vi = Number(viRaw)
      vi = vi > 0 ? vi - 1 : vertexCount + vi
      let ti = tiRaw ? Number(tiRaw) : 0
      ti = ti > 0 ? ti - 1 : (ti < 0 ? uvs.length + ti : -1)
      return [vi, ti] as [number, number]
    })
    for (let i = 1; i < face.length - 1; i++) triangles.push([face[0], face[i], face[i + 1]])
  }

  const renderSource: number[] = []
  const renderUv: number[] = []
  const indices: number[] = []
  const byPair = new Map<string, number>()
  for (const triangle of triangles) for (const [source, uvIndex] of triangle) {
    const key = `${source}/${uvIndex}`
    let render = byPair.get(key)
    if (render === undefined) {
      render = renderSource.length
      byPair.set(key, render)
      renderSource.push(source)
      const uv = uvIndex >= 0 ? uvs[uvIndex] : undefined
      renderUv.push(uv?.[0] ?? 0, uv?.[1] ?? 0)
    }
    indices.push(render)
  }

  return {
    vertexCount,
    renderSource: Uint32Array.from(renderSource),
    uv: Float32Array.from(renderUv),
    indices: Uint32Array.from(indices),
  }
}

function axisScale(full: Float32Array, spec: [number, number, number] | undefined, axis: 0 | 1 | 2, fallback: number) {
  if (!spec || Math.abs(spec[2]) < 1e-8) return fallback
  const a = spec[0] * 3 + axis
  const b = spec[1] * 3 + axis
  if (a >= full.length || b >= full.length) return fallback
  return Math.abs(full[a] - full[b]) / spec[2]
}

function addSurfaceClearance(
  asset: MhcloAssetData,
  positions: Float32Array,
  clearance: number,
  lowerRadialClearance = 0,
  upperRadialClearance = 0,
) {
  if (clearance <= 0 && Math.abs(lowerRadialClearance) <= 1e-9 && Math.abs(upperRadialClearance) <= 1e-9) return positions

  // MHCLO fitting gives the correct morphed garment shape, but close-fitting
  // community clothes can still punch through when elbows/hips bend because
  // their interpolated skin weights are only an approximation of the body.
  // Inflate the garment by a few millimetres along its OWN source-vertex
  // normals. Doing this before UV-split render vertices are created avoids
  // cracks along texture seams.
  const normals = new Float32Array(positions.length)
  const { indices, renderSource } = asset.topology

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = renderSource[indices[i]]
    const b = renderSource[indices[i + 1]]
    const c = renderSource[indices[i + 2]]
    if (a === b || b === c || c === a) continue

    const ao = a * 3; const bo = b * 3; const co = c * 3
    const abx = positions[bo] - positions[ao]
    const aby = positions[bo + 1] - positions[ao + 1]
    const abz = positions[bo + 2] - positions[ao + 2]
    const acx = positions[co] - positions[ao]
    const acy = positions[co + 1] - positions[ao + 1]
    const acz = positions[co + 2] - positions[ao + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx

    for (const o of [ao, bo, co]) {
      normals[o] += nx
      normals[o + 1] += ny
      normals[o + 2] += nz
    }
  }

  // Community OBJ winding is normally consistent, but some packs are flipped.
  // Pick the global sign whose normals mostly point away from the character's
  // vertical centre line. This keeps the safety offset outward for both cases.
  let orientation = 0
  for (let i = 0; i < positions.length; i += 3) {
    orientation += normals[i] * positions[i] + normals[i + 2] * positions[i + 2]
  }
  const sign = orientation < 0 ? -1 : 1

  for (let i = 0; i < positions.length; i += 3) {
    let nx = normals[i] * sign
    let ny = normals[i + 1] * sign
    let nz = normals[i + 2] * sign
    const length = Math.hypot(nx, ny, nz)
    if (length < 1e-10) continue
    nx /= length; ny /= length; nz /= length
    positions[i] += nx * clearance
    positions[i + 1] += ny * clearance
    positions[i + 2] += nz * clearance
  }

  // A uniform normal offset is not enough where two independently-authored
  // garments meet at the waist: their surfaces can still cross as the skeleton
  // bends, producing the noisy shirt/waistband strip visible on some presets.
  // Add a *radial* separation only in a soft band at the garment edge. This is
  // intentionally independent of triangle normals, so a hem vertex whose normal
  // points downwards is still moved away from the torso rather than into the
  // trousers. Untucked tops use the lower band; tucked tops can instead make the
  // trousers' upper waistband the outer layer.
  if (Math.abs(lowerRadialClearance) > 1e-9 || Math.abs(upperRadialClearance) > 1e-9) {
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < positions.length; i += 3) {
      minY = Math.min(minY, positions[i])
      maxY = Math.max(maxY, positions[i])
    }
    const height = Math.max(1e-6, maxY - minY)
    const lowerBand = 0.22
    const upperBand = 0.14

    const smooth = (t: number) => {
      const c = Math.max(0, Math.min(1, t))
      return c * c * (3 - 2 * c)
    }

    for (let i = 0; i < positions.length; i += 3) {
      const y01 = (positions[i + 1] - minY) / height
      let extra = 0
      if (Math.abs(lowerRadialClearance) > 1e-9 && y01 < lowerBand) {
        extra += lowerRadialClearance * smooth(1 - y01 / lowerBand)
      }
      if (Math.abs(upperRadialClearance) > 1e-9 && y01 > 1 - upperBand) {
        extra += upperRadialClearance * smooth((y01 - (1 - upperBand)) / upperBand)
      }
      if (Math.abs(extra) <= 1e-9) continue

      const x = positions[i]
      const z = positions[i + 2]
      const radial = Math.hypot(x, z)
      if (radial < 1e-7) continue
      positions[i] += (x / radial) * extra
      positions[i + 2] += (z / radial) * extra
    }
  }

  return positions
}

export function fitMhcloSourcePositions(
  asset: MhcloAssetData,
  instance: MakeHumanInstance,
  clearance = 0,
  lowerRadialClearance = 0,
  upperRadialClearance = 0,
) {
  const full = instance.currentPositions
  const scale = instance.data.scaleFactor || 0.1
  const xSize = axisScale(full, asset.definition.xScale, 0, scale)
  const ySize = axisScale(full, asset.definition.yScale, 1, scale)
  const zSize = axisScale(full, asset.definition.zScale, 2, scale)
  const out = new Float32Array(asset.definition.matches.length * 3)

  asset.definition.matches.forEach((match, i) => {
    let x = 0; let y = 0; let z = 0
    for (let k = 0; k < 3; k++) {
      const source = match.verts[k] * 3
      const w = match.weights[k]
      if (source + 2 >= full.length) continue
      x += full[source] * w
      y += full[source + 1] * w
      z += full[source + 2] * w
    }
    out[i * 3] = x + match.offsets[0] * xSize
    out[i * 3 + 1] = y + match.offsets[1] * ySize
    out[i * 3 + 2] = z + match.offsets[2] * zSize
  })
  return addSurfaceClearance(asset, out, clearance, lowerRadialClearance, upperRadialClearance)
}

function sourceSkinForMhclo(asset: MhcloAssetData, instance: MakeHumanInstance) {
  const indices = new Uint16Array(asset.definition.matches.length * 4)
  const weights = new Float32Array(asset.definition.matches.length * 4)
  const sourceIndices = instance.data.sourceSkinIndex
  const sourceWeights = instance.data.sourceSkinWeight

  asset.definition.matches.forEach((match, i) => {
    const merged = new Map<number, number>()
    const matchWeightSum = match.weights.reduce((sum, value) => sum + value, 0) || 1
    for (let k = 0; k < 3; k++) {
      const human = match.verts[k]
      const factor = match.weights[k] / matchWeightSum
      for (let influence = 0; influence < 4; influence++) {
        const offset = human * 4 + influence
        if (offset >= sourceIndices.length) continue
        const bone = sourceIndices[offset]
        const weight = sourceWeights[offset] * factor
        merged.set(bone, (merged.get(bone) ?? 0) + weight)
      }
    }
    const top = [...merged.entries()].filter(([, value]) => value > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 4)
    const total = top.reduce((sum, [, value]) => sum + value, 0) || 1
    for (let influence = 0; influence < 4; influence++) {
      const entry = top[influence]
      indices[i * 4 + influence] = entry?.[0] ?? 0
      weights[i * 4 + influence] = (entry?.[1] ?? 0) / total
    }
  })
  return { indices, weights }
}

function writeSmoothMhcloNormals(asset: MhcloAssetData, sourcePositions: Float32Array, geometry: BufferGeometry) {
  const sourceNormals = new Float32Array(sourcePositions.length)
  const { indices, renderSource } = asset.topology
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = renderSource[indices[i]]
    const b = renderSource[indices[i + 1]]
    const c = renderSource[indices[i + 2]]
    if (a === b || b === c || c === a) continue
    const ao = a * 3; const bo = b * 3; const co = c * 3
    const abx = sourcePositions[bo] - sourcePositions[ao]
    const aby = sourcePositions[bo + 1] - sourcePositions[ao + 1]
    const abz = sourcePositions[bo + 2] - sourcePositions[ao + 2]
    const acx = sourcePositions[co] - sourcePositions[ao]
    const acy = sourcePositions[co + 1] - sourcePositions[ao + 1]
    const acz = sourcePositions[co + 2] - sourcePositions[ao + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    for (const o of [ao, bo, co]) { sourceNormals[o] += nx; sourceNormals[o + 1] += ny; sourceNormals[o + 2] += nz }
  }
  for (let i = 0; i < sourceNormals.length; i += 3) {
    const x = sourceNormals[i]; const y = sourceNormals[i + 1]; const z = sourceNormals[i + 2]
    const length = Math.hypot(x, y, z) || 1
    sourceNormals[i] = x / length; sourceNormals[i + 1] = y / length; sourceNormals[i + 2] = z / length
  }
  const renderNormals = new Float32Array(renderSource.length * 3)
  for (let i = 0; i < renderSource.length; i++) {
    const source = renderSource[i] * 3
    renderNormals[i * 3] = sourceNormals[source]
    renderNormals[i * 3 + 1] = sourceNormals[source + 1]
    renderNormals[i * 3 + 2] = sourceNormals[source + 2]
  }
  geometry.setAttribute('normal', new Float32BufferAttribute(renderNormals, 3))
}

export function createMhcloGeometry(
  asset: MhcloAssetData,
  instance: MakeHumanInstance,
  clearance = 0,
  lowerRadialClearance = 0,
  upperRadialClearance = 0,
) {
  const topology = asset.topology
  const sourcePositions = fitMhcloSourcePositions(asset, instance, clearance, lowerRadialClearance, upperRadialClearance)
  const renderPositions = new Float32Array(topology.renderSource.length * 3)
  const { indices: sourceSkinIndex, weights: sourceSkinWeight } = sourceSkinForMhclo(asset, instance)
  const renderSkinIndex = new Uint16Array(topology.renderSource.length * 4)
  const renderSkinWeight = new Float32Array(topology.renderSource.length * 4)

  for (let render = 0; render < topology.renderSource.length; render++) {
    const source = topology.renderSource[render]
    renderPositions.set(sourcePositions.subarray(source * 3, source * 3 + 3), render * 3)
    renderSkinIndex.set(sourceSkinIndex.subarray(source * 4, source * 4 + 4), render * 4)
    renderSkinWeight.set(sourceSkinWeight.subarray(source * 4, source * 4 + 4), render * 4)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(renderPositions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(topology.uv, 2))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(renderSkinIndex, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(renderSkinWeight, 4))
  geometry.setIndex(Array.from(topology.indices))
  writeSmoothMhcloNormals(asset, sourcePositions, geometry)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function updateMhcloGeometry(
  geometry: BufferGeometry,
  asset: MhcloAssetData,
  instance: MakeHumanInstance,
  clearance = 0,
  lowerRadialClearance = 0,
  upperRadialClearance = 0,
) {
  const sourcePositions = fitMhcloSourcePositions(asset, instance, clearance, lowerRadialClearance, upperRadialClearance)
  const position = geometry.getAttribute('position') as Float32BufferAttribute
  for (let render = 0; render < asset.topology.renderSource.length; render++) {
    const source = asset.topology.renderSource[render] * 3
    position.setXYZ(render, sourcePositions[source], sourcePositions[source + 1], sourcePositions[source + 2])
  }
  position.needsUpdate = true
  writeSmoothMhcloNormals(asset, sourcePositions, geometry)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
}
