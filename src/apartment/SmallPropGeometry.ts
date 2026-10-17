import * as THREE from 'three';

const WORLD_CELL = .0008;

/** Weld sub-millimetre tessellation on small static props; architecture is excluded.
 * UV/normal buckets retain texture seams and sharp edges. No decimation runs per frame.
 */
export function simplifySmallPropGeometry(mesh: THREE.Mesh): THREE.BufferGeometry | null {
  const source = mesh.geometry;
  if (mesh instanceof THREE.SkinnedMesh || Array.isArray(mesh.material) || source.groups.length > 1
    || Object.keys(source.morphAttributes).length > 0 || Number.isFinite(source.drawRange.count)) return null;
  const position = source.getAttribute('position');
  const count = source.index?.count ?? position.count;
  if (count < 54_000) return null;
  mesh.updateWorldMatrix(true, false);
  source.computeBoundingBox();
  const worldSize = source.boundingBox!.clone().applyMatrix4(mesh.matrixWorld).getSize(new THREE.Vector3());
  const maxDimension = Math.max(worldSize.x, worldSize.y, worldSize.z);
  if (maxDimension > .5) return null;
  const uvCells = maxDimension < .12 ? 16 : 128;
  const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
  if (Math.min(scale.x, scale.y, scale.z) < 1e-9) return null;
  const attrs = Object.entries(source.attributes);
  if (attrs.some(([name]) => !['position', 'normal', 'uv', 'uv1', 'color', 'tangent'].includes(name))) return null;
  const buckets = new Map<string, number>();
  const remap = new Uint32Array(position.count);
  const sizes: number[] = [];
  const sums = attrs.map(() => [] as number[]);
  const normal = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  const uv1 = source.getAttribute('uv1');
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.floor(position.getX(i) * scale.x / WORLD_CELL)},${Math.floor(position.getY(i) * scale.y / WORLD_CELL)},${Math.floor(position.getZ(i) * scale.z / WORLD_CELL)}`
      + (uv ? `/${Math.floor(uv.getX(i) * uvCells)},${Math.floor(uv.getY(i) * uvCells)}` : '')
      + (uv1 ? `/${Math.floor(uv1.getX(i) * uvCells)},${Math.floor(uv1.getY(i) * uvCells)}` : '')
      + (normal ? `/${Math.round(normal.getX(i) * 4)},${Math.round(normal.getY(i) * 4)},${Math.round(normal.getZ(i) * 4)}` : '');
    let target = buckets.get(key);
    if (target === undefined) { target = sizes.length; buckets.set(key, target); sizes.push(0); }
    remap[i] = target; sizes[target]!++;
    attrs.forEach(([, attr], a) => {
      for (let c = 0; c < attr.itemSize; c++) {
        const at = target! * attr.itemSize + c;
        sums[a]![at] = (sums[a]![at] ?? 0) + attr.getComponent(i, c);
      }
    });
  }
  const indices: number[] = [];
  for (let i = 0; i < count; i += 3) {
    const a = remap[source.index?.getX(i) ?? i]!;
    const b = remap[source.index?.getX(i + 1) ?? i + 1]!;
    const c = remap[source.index?.getX(i + 2) ?? i + 2]!;
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  if (indices.length > count * .8 || indices.length < 3) return null;
  const geometry = new THREE.BufferGeometry();
  attrs.forEach(([name, attr], a) => {
    const data = sums[a]!;
    for (let i = 0; i < sizes.length; i++) for (let c = 0; c < attr.itemSize; c++) data[i * attr.itemSize + c]! /= sizes[i]!;
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, attr.itemSize));
  });
  geometry.setIndex(indices);
  if (normal) geometry.normalizeNormals(); else geometry.computeVertexNormals();
  const compactPosition = geometry.getAttribute('position');
  const originalPoint = new THREE.Vector3(), compactPoint = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    originalPoint.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    compactPoint.fromBufferAttribute(compactPosition, remap[i]!).applyMatrix4(mesh.matrixWorld);
    if (originalPoint.distanceToSquared(compactPoint) > .0014 ** 2) { geometry.dispose(); return null; }
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.name = `${source.name || mesh.name}-compact`;
  return geometry;
}

export function optimizeApartmentSmallProps(root: THREE.Object3D): void {
  root.updateWorldMatrix(true, true);
  const cache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const replaced = new Set<THREE.BufferGeometry>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const original = object.geometry;
    const optimized = cache.get(original) ?? simplifySmallPropGeometry(object);
    if (!optimized) return;
    cache.set(original, optimized); object.geometry = optimized; replaced.add(original);
  });
  // An original may also be shared by an excluded mesh. Keep its GPU resource then.
  root.traverse(object => { if (object instanceof THREE.Mesh) replaced.delete(object.geometry); });
  replaced.forEach(geometry => geometry.dispose());
}
