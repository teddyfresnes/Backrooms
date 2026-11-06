import * as THREE from 'three';

/** Attach transferred arrays directly. BufferGeometryLoader would allocate and
 * copy every attribute again, briefly doubling the large apartment's memory. */
export function transferredGeometry(source: Record<string, unknown>): THREE.BufferGeometry | undefined {
  if (source.type !== 'BufferGeometry') return;
  const data = source.data as { attributes?: Record<string, { array: THREE.TypedArray; itemSize: number; normalized?: boolean }>;
    index?: { array: THREE.TypedArray }; groups?: { start: number; count: number; materialIndex: number }[];
    morphAttributes?: Record<string, unknown>; runtimeBounds?: { min: number[]; max: number[] };
    drawRange?: { start: number; count: number }; userData?: Record<string, unknown> };
  if (!data?.attributes || Object.keys(data.morphAttributes ?? {}).length
    || Object.values(data.attributes).some(attribute => !ArrayBuffer.isView(attribute.array))) return;
  const geometry = new THREE.BufferGeometry(); geometry.uuid = String(source.uuid); geometry.name = String(source.name ?? '');
  for (const [name, attribute] of Object.entries(data.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized));
  }
  if (data.index) {
    if (!ArrayBuffer.isView(data.index.array)) { geometry.dispose(); return; }
    geometry.setIndex(new THREE.BufferAttribute(data.index.array, 1));
  }
  for (const group of data.groups ?? []) geometry.addGroup(group.start, group.count, group.materialIndex);
  if (source.userData || data.userData) geometry.userData = { ...(source.userData ?? data.userData) as Record<string, unknown> };
  if (data.drawRange) geometry.setDrawRange(data.drawRange.start, data.drawRange.count);
  if (data.runtimeBounds) {
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(data.runtimeBounds.min), new THREE.Vector3().fromArray(data.runtimeBounds.max));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  }
  return geometry;
}
