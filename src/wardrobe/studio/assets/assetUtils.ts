import type { Material, Mesh, Object3D, SkinnedMesh } from 'three'
import { Color } from 'three'

export function tintAsset(root: Object3D, color: string) {
  const target = new Color(color)
  root.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mesh.material = materials.map((material) => {
      const cloned = (material as Material).clone() as Material & { color?: Color }
      if (cloned.color) cloned.color.copy(target)
      return cloned
    }) as typeof mesh.material
  })
}

export function rebindSkinnedMeshes(assetRoot: Object3D, characterRoot: Object3D) {
  const bones = new Map<string, Object3D>()
  characterRoot.traverse((node) => bones.set(node.name.toLowerCase(), node))
  assetRoot.traverse((node) => {
    const mesh = node as SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return
    const mapped = mesh.skeleton.bones.map((bone) => bones.get(bone.name.toLowerCase())).filter(Boolean)
    if (mapped.length === mesh.skeleton.bones.length) {
      mesh.skeleton.bones.splice(0, mesh.skeleton.bones.length, ...(mapped as typeof mesh.skeleton.bones))
      mesh.bind(mesh.skeleton, mesh.bindMatrix)
    }
  })
}
