import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export const makeBox = (
  name: string,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  material: THREE.Material | THREE.Material[],
  castShadow = false,
  receiveShadow = true,
): THREE.Mesh => {
  const geometry = new THREE.BoxGeometry(...size);
  const positionAttribute = geometry.getAttribute('position');
  const normalAttribute = geometry.getAttribute('normal');
  const uvAttribute = geometry.getAttribute('uv');
  for (let index = 0; index < positionAttribute.count; index += 1) {
    const px = positionAttribute.getX(index);
    const py = positionAttribute.getY(index);
    const pz = positionAttribute.getZ(index);
    const nx = Math.abs(normalAttribute.getX(index));
    const ny = Math.abs(normalAttribute.getY(index));
    let u: number;
    let v: number;
    if (nx > 0.5) {
      u = pz + size[2] * 0.5;
      v = py + size[1] * 0.5;
    } else if (ny > 0.5) {
      u = px + size[0] * 0.5;
      v = pz + size[2] * 0.5;
    } else {
      u = px + size[0] * 0.5;
      v = py + size[1] * 0.5;
    }
    uvAttribute.setXY(index, u, v);
  }
  uvAttribute.needsUpdate = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
};

export const makeCylinder = (
  name: string,
  radius: number,
  height: number,
  position: readonly [number, number, number],
  material: THREE.Material,
  radialSegments = 10,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radialSegments), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
};

export const makeCylinderBetween = (
  name: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments = 10,
): THREE.Mesh => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
};

export const makeSphere = (
  name: string,
  radius: number,
  position: readonly [number, number, number],
  material: THREE.Material,
  segments = 10,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(6, Math.floor(segments * 0.65))), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
};

export const makeTorus = (
  name: string,
  radius: number,
  tube: number,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  material: THREE.Material,
  radialSegments = 8,
  tubularSegments = 20,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
};

/**
 * Fusionne les éléments statiques qui partagent matériau et propriétés d'ombre.
 * Les vitrages et matériaux transparents restent séparés pour conserver un tri
 * correct. Les petits tuyaux, portes et garde-corps texturés sont fusionnés eux
 * aussi. Les branches cachées/animées ne sont jamais absorbées dans un lot.
 */
export const batchStaticMeshes = (root: THREE.Object3D, cellSize?: number): void => {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[] }>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh) return;
    if (Array.isArray(object.material)) return;
    if (object.material.transparent || object.userData.noBatch) return;
    let ancestor: THREE.Object3D | null = object;
    while (ancestor && ancestor !== root) {
      if (!ancestor.visible || ancestor.userData.noBatch || ancestor instanceof THREE.LOD) return;
      ancestor = ancestor.parent;
    }
    const layout = Object.keys(object.geometry.attributes).sort().map(name => {
      const attribute = object.geometry.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
      const array = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array;
      return `${name}/${attribute.itemSize}/${array.constructor.name}/${attribute.normalized}`;
    }).join(',');
    let cell = '';
    if (cellSize) {
      object.geometry.computeBoundingBox();
      const center = object.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
      cell = `${Math.floor(center.x / cellSize)},${Math.floor(center.y / cellSize)},${Math.floor(center.z / cellSize)}`;
    }
    const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}:${layout}:${!!object.geometry.index}:${cell}`;
    const bucket: { material: THREE.Material; meshes: THREE.Mesh[] } =
      buckets.get(key) ?? { material: object.material, meshes: [] };
    bucket.meshes.push(object);
    buckets.set(key, bucket);
  });

  for (const { material, meshes } of buckets.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      const transform = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
      const geometry = mesh.geometry.clone();
      // WebGL flips front faces for mirrored objects. A baked batch must bake
      // that winding too, or one side of an imported object disappears.
      if (transform.determinant() < 0) {
        if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
        const index = geometry.index!;
        for (let i = 0; i < index.count; i += 3) {
          const a = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, a);
        }
      }
      return geometry.applyMatrix4(transform);
    });
    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;

    const batch = new THREE.Mesh(merged, material);
    batch.name = `static-batch-${material.name || material.uuid.slice(0, 8)}`;
    batch.receiveShadow = meshes[0]!.receiveShadow;
    batch.castShadow = meshes[0]!.castShadow;
    meshes.forEach((mesh) => {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    });
    root.add(batch);
  }
};

export const disposeObject3D = (root: THREE.Object3D): void => {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) geometries.add(object.geometry);
  });
  geometries.forEach((geometry) => geometry.dispose());
  root.clear();
  root.removeFromParent();
};
