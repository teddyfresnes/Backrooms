import { Bone, Vector3, type Object3D, type SkinnedMesh } from 'three'
import { getMakeHumanBoneTail, type MakeHumanInstance } from '../makehuman/MakeHumanRuntime'
type TargetRest = { bone: Bone; worldPosition: Vector3 }

function boneKey(name: string) {
  return name
    .toLowerCase()
    .replace(/^.*mixamorig[:_]?/, '')
    .replace(/[^a-z0-9]/g, '')
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

function targetBonesInHierarchy(instance: MakeHumanInstance) {
  const result: Bone[] = []
  instance.root.traverse((object) => {
    const bone = object as Bone
    if (bone.isBone) result.push(bone)
  })
  return result
}

/** MPFB omits unweighted end bones; gait contacts and ragdoll sizing use them. */
export function completeMakeHumanRig(instance: MakeHumanInstance, referenceRoot: Object3D): void {
  const reference = collectBones(referenceRoot)
  instance.root.updateMatrixWorld(true)
  for (const [key, parent] of instance.boneByName) {
    if (parent.children.some(child => (child as Bone).isBone)) continue
    const source = reference.get(boneKey(parent.name))
    if (!source) continue
    for (const child of source.children) {
      if (!(child as Bone).isBone) continue
      const end = new Bone()
      end.name = child.name
      const point = instance.root.localToWorld(getMakeHumanBoneTail(instance, key))
      end.position.copy(parent.worldToLocal(point))
      end.quaternion.copy(child.quaternion)
      parent.add(end)
    }
  }
  instance.root.updateMatrixWorld(true)
}

export function calibrateMakeHumanRig(instance: MakeHumanInstance, referenceRoot: Object3D) {
  const reference = { bonesByKey: collectBones(referenceRoot) }
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

