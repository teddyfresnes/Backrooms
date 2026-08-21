import {
  Bone,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import type { CharacterConfig } from '../core/types'
import { expressionMouthOpening, expressionTargets, type FacialExpressionId } from '../core/expressions'
import { calculateDetailTargets } from './DetailTargets'
import { calculateMacroTargets, macroInfoFromBody } from './MacroTargets'
import { loadSparseTarget } from './TargetLoader'
import type { EndpointStrategy, MakeHumanBaseData, WeightedTarget } from './types'

const UP = new Vector3(0, 1, 0)

export interface MakeHumanInstance {
  root: Group
  body: SkinnedMesh
  geometry: BufferGeometry
  skeleton: Skeleton
  bones: Bone[]
  boneByName: Map<string, Bone>
  skinMaterial: MeshPhysicalMaterial
  eyeMaterial: MeshPhysicalMaterial
  irisMaterial: MeshPhysicalMaterial
  eyeGroups: Group[]
  mouthGroup: Group
  basePositions: Float32Array
  currentPositions: Float32Array
  renderSource: Uint32Array
  baseIndices: Uint32Array
  bodyDeleteMasks: Map<string, Uint32Array>
  data: MakeHumanBaseData
}

function groundPositions(values: Float32Array, bodyVertexCount: number) {
  let minY = Number.POSITIVE_INFINITY
  for (let i = 0; i < bodyVertexCount; i++) minY = Math.min(minY, values[i * 3 + 1])
  const shift = Number.isFinite(minY) ? -minY : 0
  if (Math.abs(shift) > 1e-7) for (let i = 0; i < values.length / 3; i++) values[i * 3 + 1] += shift
  return shift
}

function averageVertices(full: Float32Array, indices: number[]) {
  const out = new Vector3()
  let count = 0
  for (const index of indices) {
    const o = index * 3
    if (o + 2 >= full.length) continue
    out.x += full[o]; out.y += full[o + 1]; out.z += full[o + 2]; count++
  }
  return count ? out.multiplyScalar(1 / count) : null
}

function endpointPosition(data: MakeHumanBaseData, full: Float32Array, endpoint: EndpointStrategy) {
  let result: Vector3 | null = null
  if (endpoint.strategy === 'CUBE' && endpoint.cube_name) result = averageVertices(full, data.jointGroups[endpoint.cube_name] ?? [])
  if (endpoint.strategy === 'VERTEX' && endpoint.vertex_index !== undefined) result = averageVertices(full, [endpoint.vertex_index])
  if (endpoint.strategy === 'MEAN' && endpoint.vertex_indices) result = averageVertices(full, endpoint.vertex_indices)
  if (endpoint.strategy === 'XYZ' && endpoint.vertex_indices?.length && endpoint.vertex_indices.length >= 3) {
    const points = endpoint.vertex_indices.slice(0, 3).map((index) => averageVertices(full, [index]))
    if (points.every(Boolean)) result = new Vector3(points[0]!.x, points[1]!.y, points[2]!.z)
  }
  if (!result) result = new Vector3(...endpoint.default_position)
  if (endpoint.offset) result.add(new Vector3(...endpoint.offset))
  return result
}

function boneWorldMatrix(head: Vector3, tail: Vector3, roll: number) {
  const direction = tail.clone().sub(head)
  if (direction.lengthSq() < 1e-10) direction.set(0, 0.01, 0)
  direction.normalize()
  const align = new Quaternion().setFromUnitVectors(UP, direction)
  const twist = new Quaternion().setFromAxisAngle(UP, roll)
  const rotation = align.multiply(twist)
  return new Matrix4().compose(head, rotation, new Vector3(1, 1, 1))
}

function calculateBoneMatrices(data: MakeHumanBaseData, full: Float32Array) {
  const world = new Map<string, Matrix4>()
  for (const name of data.boneNames) {
    const def = data.rig.bones[name]
    const head = endpointPosition(data, full, def.head)
    const tail = endpointPosition(data, full, def.tail)
    world.set(name, boneWorldMatrix(head, tail, def.roll ?? 0))
  }
  return world
}

function applyBoneMatrices(instance: MakeHumanInstance, full: Float32Array, initial = false) {
  const worlds = calculateBoneMatrices(instance.data, full)
  for (const name of instance.data.boneNames) {
    const bone = instance.boneByName.get(name)!
    const parentName = instance.data.rig.bones[name].parent
    const world = worlds.get(name)!
    const local = parentName && worlds.has(parentName)
      ? new Matrix4().copy(world).premultiply(new Matrix4().copy(worlds.get(parentName)!).invert())
      : world
    local.decompose(bone.position, bone.quaternion, bone.scale)
    bone.userData.mhRestPosition = bone.position.toArray()
    bone.userData.mhRestQuaternion = bone.quaternion.toArray()
    bone.userData.mhRestScale = bone.scale.toArray()
  }
  instance.root.updateMatrixWorld(true)
  if (!initial) instance.skeleton.calculateInverses()
  refitEyes(instance, full)
  refitMouthInterior(instance, full)
}

export function setMakeHumanBodyDeleteMask(instance: MakeHumanInstance, key: string, sourceVertices: number[] | Uint32Array | null) {
  if (sourceVertices?.length) instance.bodyDeleteMasks.set(key, Uint32Array.from(sourceVertices))
  else instance.bodyDeleteMasks.delete(key)

  if (!instance.bodyDeleteMasks.size) {
    instance.geometry.setIndex(Array.from(instance.baseIndices))
    return
  }
  const hidden = new Uint8Array(instance.basePositions.length / 3)
  for (const mask of instance.bodyDeleteMasks.values()) {
    for (const source of mask) if (source < hidden.length) hidden[source] = 1
  }
  const visible: number[] = []
  for (let i = 0; i < instance.baseIndices.length; i += 3) {
    const a = instance.baseIndices[i]
    const b = instance.baseIndices[i + 1]
    const c = instance.baseIndices[i + 2]
    if (hidden[instance.renderSource[a]] && hidden[instance.renderSource[b]] && hidden[instance.renderSource[c]]) continue
    visible.push(a, b, c)
  }
  instance.geometry.setIndex(visible)
}

function updateRenderGeometry(instance: MakeHumanInstance, full: Float32Array) {
  const attr = instance.geometry.getAttribute('position') as Float32BufferAttribute
  for (let i = 0; i < instance.renderSource.length; i++) {
    const source = instance.renderSource[i] * 3
    attr.setXYZ(i, full[source], full[source + 1], full[source + 2])
  }
  attr.needsUpdate = true

  // Smooth shading must be accumulated on the ORIGINAL MakeHuman vertices,
  // not on UV-split render vertices. Otherwise every UV seam gets its own
  // normal and animated clothes/skin show thin checker/stripe artifacts.
  const sourceNormals = new Float32Array(full.length)
  for (let i = 0; i + 2 < instance.baseIndices.length; i += 3) {
    const ra = instance.baseIndices[i]
    const rb = instance.baseIndices[i + 1]
    const rc = instance.baseIndices[i + 2]
    const a = instance.renderSource[ra]
    const b = instance.renderSource[rb]
    const c = instance.renderSource[rc]
    if (a === b || b === c || c === a) continue
    const ao = a * 3; const bo = b * 3; const co = c * 3
    const abx = full[bo] - full[ao]; const aby = full[bo + 1] - full[ao + 1]; const abz = full[bo + 2] - full[ao + 2]
    const acx = full[co] - full[ao]; const acy = full[co + 1] - full[ao + 1]; const acz = full[co + 2] - full[ao + 2]
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
  const renderNormals = new Float32Array(instance.renderSource.length * 3)
  for (let i = 0; i < instance.renderSource.length; i++) {
    const source = instance.renderSource[i] * 3
    renderNormals[i * 3] = sourceNormals[source]
    renderNormals[i * 3 + 1] = sourceNormals[source + 1]
    renderNormals[i * 3 + 2] = sourceNormals[source + 2]
  }
  instance.geometry.setAttribute('normal', new Float32BufferAttribute(renderNormals, 3))
  instance.geometry.computeBoundingSphere()
  instance.geometry.computeBoundingBox()
}

function eyeCenter(instance: MakeHumanInstance, side: 'l' | 'r') {
  return averageVertices(instance.currentPositions, instance.data.jointGroups[`joint-${side}-eye`] ?? [])
}

function refitEyes(instance: MakeHumanInstance, full: Float32Array) {
  const head = instance.boneByName.get('mixamorig:Head')
  if (!head) return
  instance.currentPositions = full
  head.updateWorldMatrix(true, false)
  // MakeHuman joint centers are expressed in CharacterRoot-local coordinates.
  // Convert them through CharacterRoot before asking the head for local space;
  // otherwise a rotated turntable parent is applied a second time on edits.
  const rootWorldRotation = instance.root.getWorldQuaternion(new Quaternion())
  const headWorldRotation = head.getWorldQuaternion(new Quaternion())
  const headRootRotation = rootWorldRotation.clone().invert().multiply(headWorldRotation)
  ;(['l', 'r'] as const).forEach((side, i) => {
    // During createMakeHumanInstance(), the rig is fitted before createEyes()
    // has populated eyeGroups. Re-fitting the skeleton must therefore tolerate
    // missing eye helpers; createEyes() calls refitEyes() again immediately
    // after both groups have been attached to the head bone.
    const eyeGroup = instance.eyeGroups[i]
    if (!eyeGroup) return
    const center = eyeCenter(instance, side)
    if (!center) return
    const local = head.worldToLocal(instance.root.localToWorld(center.clone()))
    eyeGroup.position.copy(local)
    eyeGroup.quaternion.copy(headRootRotation.clone().invert())
  })
}

function refitMouthInterior(instance: MakeHumanInstance, full: Float32Array) {
  const head = instance.boneByName.get('mixamorig:Head')
  const mouth = instance.mouthGroup
  if (!head || mouth.parent !== head) return
  const center = averageVertices(full, instance.data.jointGroups['joint-tongue-1'] ?? instance.data.jointGroups['joint-mouth'] ?? [])
  if (!center) return

  // Keep the backing inside the head, behind the lip surface. Putting it on the
  // face plane makes the black disc bleed through cheeks and closed lips.
  center.z += .054
  head.updateWorldMatrix(true, false)
  const rootWorldRotation = instance.root.getWorldQuaternion(new Quaternion())
  const headWorldRotation = head.getWorldQuaternion(new Quaternion())
  const headRootRotation = rootWorldRotation.clone().invert().multiply(headWorldRotation)
  mouth.position.copy(head.worldToLocal(instance.root.localToWorld(center)))
  mouth.quaternion.copy(headRootRotation.clone().invert())
}

function updateMouthInterior(instance: MakeHumanInstance, expression: FacialExpressionId) {
  const cavity = instance.mouthGroup.getObjectByName('MouthCavityBacking') as Mesh | undefined
  if (!cavity?.isMesh) return
  const opening = Math.max(0, Math.min(1, expressionMouthOpening(expression)))
  cavity.visible = opening >= .1
  if (!cavity.visible) return

  // Match the backing to the actual expression aperture instead of leaving a
  // full-size oval behind every face. Width varies only a little; height tracks
  // the mouth-open unit so sleepy/dead/scream remain proportionate.
  cavity.scale.set(.024 + opening * .005, .0025 + opening * .0155, 1)
}

export function refitMakeHumanEyes(instance: MakeHumanInstance) {
  instance.root.updateMatrixWorld(true)
  refitEyes(instance, instance.currentPositions)
  refitMouthInterior(instance, instance.currentPositions)
  instance.root.updateMatrixWorld(true)
}

function createEyes(instance: MakeHumanInstance) {
  const head = instance.boneByName.get('mixamorig:Head') ?? instance.root
  const white = new MeshPhysicalMaterial({
    name: 'EyeWhite', color: '#f3f1ec', roughness: 0.28,
    clearcoat: 0.1, clearcoatRoughness: 0.28,
  })
  const iris = instance.irisMaterial
  iris.side = DoubleSide
  iris.depthWrite = true
  iris.depthTest = true
  const limbal = new MeshBasicMaterial({ name: 'LimbalRing', color: '#28231f', side: DoubleSide, depthTest: true, depthWrite: true })
  const pupilMaterial = new MeshBasicMaterial({ name: 'Pupil', color: '#050505', side: DoubleSide, depthTest: true, depthWrite: true })

  for (let i = 0; i < 2; i++) {
    const g = new Group(); g.name = i === 0 ? 'LeftEye' : 'RightEye'
    const globe = new Mesh(new SphereGeometry(0.0146, 36, 24), white)
    globe.castShadow = false
    globe.receiveShadow = false

    // The camera views the character from +Z. These discs are placed a tiny
    // amount in front of the sclera, which avoids both z-fighting and the
    // all-white-eye bug caused by putting them behind the sphere.
    const limbalRing = new Mesh(new CircleGeometry(0.00655, 48), limbal)
    limbalRing.position.z = 0.01468
    limbalRing.renderOrder = 20
    const irisMesh = new Mesh(new CircleGeometry(0.00575, 48), iris)
    irisMesh.position.z = 0.01475
    irisMesh.renderOrder = 21
    const pupil = new Mesh(new CircleGeometry(0.00235, 40), pupilMaterial)
    pupil.position.z = 0.01482
    pupil.renderOrder = 22

    g.add(globe, limbalRing, irisMesh, pupil)
    head.add(g)
    instance.eyeGroups.push(g)
  }
  instance.root.updateMatrixWorld(true)
  refitEyes(instance, instance.currentPositions)
}

function createMouthInterior(instance: MakeHumanInstance) {
  const head = instance.boneByName.get('mixamorig:Head') ?? instance.root
  const mouth = instance.mouthGroup
  mouth.name = 'MouthInterior'

  const cavityMaterial = new MeshBasicMaterial({
    name: 'MouthCavity',
    color: '#030202',
    side: DoubleSide,
    depthTest: true,
    depthWrite: true,
  })
  const cavity = new Mesh(new CircleGeometry(1, 48), cavityMaterial)
  cavity.name = 'MouthCavityBacking'
  cavity.visible = false
  cavity.scale.set(.024, .0025, 1)

  mouth.add(cavity)
  head.add(mouth)
  instance.root.updateMatrixWorld(true)
  refitMouthInterior(instance, instance.currentPositions)
  updateMouthInterior(instance, 'neutral')
}

export function disposeMakeHumanMouth(instance: MakeHumanInstance) {
  instance.mouthGroup.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) material.dispose()
  })
  instance.mouthGroup.clear()
  instance.mouthGroup.removeFromParent()
}

export function createMakeHumanInstance(data: MakeHumanBaseData): MakeHumanInstance {
  const basePositions = Float32Array.from(data.fullPositions)
  const currentPositions = basePositions.slice()
  groundPositions(currentPositions, data.bodyVertexCount)
  const renderSource = Uint32Array.from(data.renderSource)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(renderSource.length * 3), 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(Float32Array.from(data.uv), 2))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Uint16Array.from(data.skinIndex), 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(Float32Array.from(data.skinWeight), 4))
  const baseIndices = Uint32Array.from(data.indices)
  geometry.setIndex(Array.from(baseIndices))

  const skinMaterial = new MeshPhysicalMaterial({
    name: 'Skin', color: new Color('#c99678'), roughness: 0.57, metalness: 0,
    clearcoat: 0.025, clearcoatRoughness: 0.5, sheen: 0.12, sheenRoughness: 0.82,
  })
  const eyeMaterial = new MeshPhysicalMaterial({ name: 'Eyes', color: '#f3f1eb', roughness: 0.25 })
  const irisMaterial = new MeshPhysicalMaterial({ name: 'Iris', color: '#6c8da8', roughness: 0.38, clearcoat: 0.18 })
  const body = new SkinnedMesh(geometry, skinMaterial)
  body.name = 'MakeHuman_HM08_Body'
  body.castShadow = false; body.receiveShadow = false; body.frustumCulled = false
  body.userData.makeHuman = { basemesh: 'hm08', rig: 'mixamo', license: 'CC0' }

  const root = new Group(); root.name = 'CharacterRoot'
  const boneByName = new Map<string, Bone>()
  const bones = data.boneNames.map((name) => {
    const b = new Bone()
    // Three.js animation track paths treat ':' as a reserved separator. Keep the
    // MPFB key internally, but expose the conventional glTF-safe Mixamo name.
    b.name = name.replace('mixamorig:', 'mixamorig')
    b.userData.mpfbBoneName = name
    boneByName.set(name, b)
    return b
  })
  for (const name of data.boneNames) {
    const bone = boneByName.get(name)!
    const parentName = data.rig.bones[name].parent
    const parent = parentName ? boneByName.get(parentName) : undefined
    ;(parent ?? root).add(bone)
  }
  root.add(body)

  const skeleton = new Skeleton(bones)
  const instance: MakeHumanInstance = {
    root, body, geometry, skeleton, bones, boneByName, skinMaterial, eyeMaterial, irisMaterial,
    eyeGroups: [], mouthGroup: new Group(), basePositions, currentPositions, renderSource, baseIndices, bodyDeleteMasks: new Map(), data,
  }
  updateRenderGeometry(instance, currentPositions)
  applyBoneMatrices(instance, currentPositions, true)
  root.updateMatrixWorld(true)
  body.bind(skeleton, new Matrix4())
  skeleton.calculateInverses()
  createEyes(instance)
  createMouthInterior(instance)
  return instance
}

async function resolveTargets(config: CharacterConfig, expression: FacialExpressionId) {
  const stack = [
    ...calculateMacroTargets(macroInfoFromBody(config.body)),
    ...calculateDetailTargets(config.body, config.face),
    ...expressionTargets(expression, config.body),
  ]
  // Merge duplicates (possible when composite controls share a detail target).
  const merged = new Map<string, number>()
  for (const { path, weight } of stack) merged.set(path, (merged.get(path) ?? 0) + weight)
  return [...merged].map(([path, weight]) => ({ path, weight }))
}

async function applyTargetStack(base: Float32Array, stack: WeightedTarget[]) {
  const result = base.slice()
  const loaded = await Promise.all(stack.map(async (entry) => ({ ...entry, target: await loadSparseTarget(entry.path) })))
  for (const { weight, target } of loaded) {
    for (let i = 0; i < target.indices.length; i++) {
      const vertex = target.indices[i] * 3
      const d = i * 3
      if (vertex + 2 >= result.length) continue
      result[vertex] += target.delta[d] * weight
      result[vertex + 1] += target.delta[d + 1] * weight
      result[vertex + 2] += target.delta[d + 2] * weight
    }
  }
  return result
}

export async function morphMakeHuman(instance: MakeHumanInstance, config: CharacterConfig, isCurrent: () => boolean = () => true, expression: FacialExpressionId = 'neutral') {
  const stack = await resolveTargets(config, expression)
  const full = await applyTargetStack(instance.basePositions, stack)
  if (!isCurrent()) return stack.length
  groundPositions(full, instance.data.bodyVertexCount)
  instance.currentPositions = full
  updateRenderGeometry(instance, full)
  applyBoneMatrices(instance, full)
  updateMouthInterior(instance, expression)
  if (!config.appearance.skinMaterialId) instance.skinMaterial.color.set(config.appearance.skinColor)
  instance.irisMaterial.color.set(config.appearance.eyeColor)
  instance.root.userData.characterStudio = {
    engine: 'MakeHuman HM08 sparse targets',
    morphTargetCount: stack.length,
    config: structuredClone(config),
  }
  return stack.length
}
