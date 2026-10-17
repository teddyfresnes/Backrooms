import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnimationClip, AnimationMixer, Group, Matrix4, MeshBasicMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { createMakeHumanInstance, morphMakeHuman, refitMakeHumanEyes, type MakeHumanInstance } from '../makehuman/MakeHumanRuntime'
import { createMhcloGeometry, loadMhcloAsset, updateMhcloGeometry, type MhcloAssetData } from '../makehuman/MhcloRuntime'
import { loadMakeHumanBase } from '../makehuman/TargetLoader'
import { makeDefaultCharacter } from '../state/defaults'
import { calibrateMakeHumanRig } from './MakeHumanRig'
import type { MakeHumanBaseData } from '../makehuman/types'
import type { AssetManifest } from '../core/types'
import { findManifestAsset } from '../assets/Manifest'

// @ts-expect-error Node builtins are test-only.
const fs = await import('node:fs/promises')
let data: MakeHumanBaseData
let reference: Group
let garment: MhcloAssetData

beforeAll(async () => {
  vi.stubGlobal('window', { location: { href: 'http://localhost/' }, setTimeout })
  vi.stubGlobal('fetch', async (url: string) => {
    const pathname = new URL(String(url), 'http://localhost/').pathname
    return new Response(await fs.readFile(new URL(`../../../../public${pathname}`, import.meta.url)))
  })
  data = await loadMakeHumanBase()
  const bytes = await fs.readFile(new URL('../../../../public/assets/characters/animations/BreathingIdle.fbx', import.meta.url))
  reference = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  const manifest = JSON.parse(await fs.readFile(new URL('../../../../public/assets/characters/assets-manifest.json', import.meta.url), 'utf8')) as AssetManifest
  const asset = findManifestAsset(manifest, makeDefaultCharacter().wardrobe.top)!
  garment = await loadMhcloAsset(asset.mhcloUrl!, asset.objUrl!)
})

afterEach(() => vi.restoreAllMocks())

function stage(yaw: number) {
  const instance = createMakeHumanInstance(data)
  const parent = new Group()
  parent.rotation.y = yaw
  parent.position.set(.31, .08, -.2)
  parent.add(instance.root)
  // Intentionally leave the ancestor matrices stale, as after a pointer move.
  return { instance, parent }
}

function skinPoints(instance: MakeHumanInstance, mesh: SkinnedMesh) {
  instance.root.updateWorldMatrix(true, false)
  instance.root.updateMatrixWorld(true)
  instance.skeleton.update()
  return Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, index) =>
    instance.root.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(index, new Vector3()))))
}

function expectSameShape(a: MakeHumanInstance, b: MakeHumanInstance, meshA = a.body, meshB = b.body) {
  const pointsA = skinPoints(a, meshA), pointsB = skinPoints(b, meshB)
  expect(Math.max(...pointsA.map((point, i) => point.distanceTo(pointsB[i])))).toBeLessThan(0.00001)
  for (let i = 0; i < a.eyeGroups.length; i++) {
    const eyeA = a.root.worldToLocal(a.eyeGroups[i].getWorldPosition(new Vector3()))
    const eyeB = b.root.worldToLocal(b.eyeGroups[i].getWorldPosition(new Vector3()))
    expect(eyeA.distanceTo(eyeB)).toBeLessThan(0.00001)
    const facingA = a.root.getWorldQuaternion(new Quaternion()).invert().multiply(a.eyeGroups[i].getWorldQuaternion(new Quaternion()))
    const facingB = b.root.getWorldQuaternion(new Quaternion()).invert().multiply(b.eyeGroups[i].getWorldQuaternion(new Quaternion()))
    expect(facingA.angleTo(facingB)).toBeLessThan(0.00001)
  }
}

describe('wardrobe editing under the interactive turntable', () => {
  it.each([Math.PI / 2, -1.25])('keeps body, eyes and garments aligned when edited at yaw %s, then returned to front', async yaw => {
    const { instance: front } = stage(0)
    const { instance: turned, parent } = stage(0)
    const config = makeDefaultCharacter()
    for (const instance of [front, turned]) {
      await morphMakeHuman(instance, config)
      calibrateMakeHumanRig(instance, reference)
      refitMakeHumanEyes(instance)
    }
    parent.rotation.y = yaw
    expectSameShape(front, turned)
    const clothes = [front, turned].map(instance => {
      const mesh = new SkinnedMesh(createMhcloGeometry(garment, instance), new MeshBasicMaterial())
      mesh.bind(instance.skeleton, new Matrix4())
      instance.root.add(mesh)
      return mesh
    })
    const mixers = [front, turned].map(instance => {
      const clip = new AnimationClip('idle', reference.animations[0].duration,
        reference.animations[0].tracks.filter(track => track.name.endsWith('.quaternion')).map(track => track.clone()))
      const mixer = new AnimationMixer(instance.root)
      mixer.clipAction(clip).play()
      mixer.update(.8)
      return mixer
    })
    expectSameShape(front, turned, clothes[0], clothes[1])
    for (let edit = 0; edit < 3; edit++) {
      config.body.shoulders = .2 + edit * .1
      config.face.eyeSize = .15 + edit * .1
      for (const [index, instance] of [front, turned].entries()) {
        const pose = instance.bones.map(bone => bone.quaternion.clone())
        await morphMakeHuman(instance, config)
        calibrateMakeHumanRig(instance, reference)
        refitMakeHumanEyes(instance)
        instance.bones.forEach((bone, i) => bone.quaternion.copy(pose[i]))
        updateMhcloGeometry(clothes[index].geometry, garment, instance)
        instance.irisMaterial.color.set('#2277bb')
      }
      expectSameShape(front, turned)
      expectSameShape(front, turned, clothes[0], clothes[1])
      mixers.forEach(mixer => mixer.update(.12))
    }
    for (const angle of [yaw * .5, 0]) {
      parent.rotation.y = angle
      expectSameShape(front, turned)
      expectSameShape(front, turned, clothes[0], clothes[1])
    }
    mixers.forEach(mixer => mixer.stopAllAction())
  })
})
