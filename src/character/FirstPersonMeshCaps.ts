import * as THREE from 'three';

type Vertex = Record<string, number[]>;

/** Close the cut sleeves/waist of the render-only mesh instead of exposing a
 * hollow skin shell. Caps carry the same interpolated skin weights as the cut. */
export function capFirstPersonMask(geometry: THREE.BufferGeometry, maskName: string, threshold: number): void {
  const attributes = Object.entries(geometry.attributes) as [string, THREE.BufferAttribute][];
  const position = geometry.getAttribute('position');
  const mask = geometry.getAttribute(maskName);
  if (!position || !mask) return;
  const indices = geometry.index;
  const count = indices?.count ?? position.count;
  const points = new Map<string, Vertex>();
  const links = new Map<string, Set<string>>();
  const hiddenDirections = new Map<string, THREE.Vector3>();
  const key = (v: Vertex) => v.position!.map(x => Math.round(x * 10000)).join(',');
  const read = (i: number): Vertex => Object.fromEntries(attributes.map(([name, attr]) =>
    [name, Array.from({ length: attr.itemSize }, (_, c) => attr.getComponent(i, c))]));
  const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => {
    const out: Vertex = {};
    for (const [name] of attributes) out[name] = a[name]!.map((x, i) => THREE.MathUtils.lerp(x, b[name]![i]!, t));
    const weights = new Map<number, number>();
    for (const [v, blend] of [[a, 1 - t], [b, t]] as const) {
      for (let i = 0; i < 4; i++) {
        const bone = v.skinIndex![i]!;
        weights.set(bone, (weights.get(bone) ?? 0) + v.skinWeight![i]! * blend);
      }
    }
    const sorted = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = sorted.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    out.skinIndex = Array.from({ length: 4 }, (_, i) => sorted[i]?.[0] ?? 0);
    out.skinWeight = Array.from({ length: 4 }, (_, i) => (sorted[i]?.[1] ?? 0) / total);
    return out;
  };
  for (let i = 0; i + 2 < count; i += 3) {
    const ids = [0, 1, 2].map(j => indices?.getX(i + j) ?? i + j);
    const values = ids.map(id => mask.getX(id) - threshold);
    if (Math.min(...values) >= 0 || Math.max(...values) < 0) continue;
    const vertices = ids.map(read);
    const crossing: Vertex[] = [];
    for (let j = 0; j < 3; j++) {
      const k = (j + 1) % 3;
      if ((values[j]! >= 0) !== (values[k]! >= 0)) {
        crossing.push(interpolate(vertices[j]!, vertices[k]!, values[j]! / (values[j]! - values[k]!)));
      }
    }
    if (crossing.length !== 2) continue;
    const [a, b] = crossing.map(key);
    if (a === b) continue;
    const visible = new THREE.Vector3(), hidden = new THREE.Vector3();
    let visibleCount = 0, hiddenCount = 0;
    vertices.forEach((v, j) => {
      const p = new THREE.Vector3().fromArray(v.position!);
      if (values[j]! >= 0) { visible.add(p); visibleCount++; }
      else { hidden.add(p); hiddenCount++; }
    });
    const towardHidden = hidden.divideScalar(hiddenCount).sub(visible.divideScalar(visibleCount)).normalize();
    for (const [k, v, other] of [[a!, crossing[0]!, b!], [b!, crossing[1]!, a!]] as const) {
      points.set(k, v);
      if (!links.has(k)) links.set(k, new Set());
      links.get(k)!.add(other);
      if (!hiddenDirections.has(k)) hiddenDirections.set(k, new THREE.Vector3());
      hiddenDirections.get(k)!.add(towardHidden);
    }
  }
  const used = new Set<string>(), caps: Vertex[] = [];
  for (const start of points.keys()) {
    if (used.has(start) || links.get(start)?.size !== 2) continue;
    const loop: string[] = [];
    let previous = '', current = start;
    for (let n = 0; n <= points.size; n++) {
      if (used.has(current) || links.get(current)?.size !== 2) break;
      used.add(current); loop.push(current);
      const next = [...links.get(current)!].find(k => k !== previous)!;
      previous = current; current = next;
      if (current === start) break;
    }
    if (current !== start || loop.length < 3) continue;
    const vertices = loop.map(k => points.get(k)!);
    // The running interpolation retains bone identities, rather than averaging
    // numerical bone indices, which would bind a cap to an unrelated limb.
    let center = vertices[0]!;
    for (let i = 1; i < vertices.length; i++) center = interpolate(center, vertices[i]!, 1 / (i + 1));
    const origin = new THREE.Vector3().fromArray(center.position!);
    const normal = new THREE.Vector3(), towardHidden = new THREE.Vector3();
    for (let i = 0; i < loop.length; i++) {
      const a = new THREE.Vector3().fromArray(vertices[i]!.position!).sub(origin);
      const b = new THREE.Vector3().fromArray(vertices[(i + 1) % loop.length]!.position!).sub(origin);
      normal.add(a.cross(b)); towardHidden.add(hiddenDirections.get(loop[i]!)!);
    }
    if (normal.lengthSq() < 1e-10) continue;
    const reverse = normal.dot(towardHidden) < 0;
    normal.normalize(); if (reverse) normal.negate();
    const capVertex = (v: Vertex): Vertex => {
      const result = Object.fromEntries(Object.entries(v).map(([name, data]) => [name, [...data]]));
      result.normal = normal.toArray();
      result.fpLowerBodyMask = [0]; result.fpArmMask = [0];
      result.fpCombatArmMask = [maskName === 'fpCombatArmMask' ? 1 : 0];
      result.fpCombatBodyMask = [maskName === 'fpCombatBodyMask' || maskName === 'fpCombatSolidMask' ? 1 : 0];
      return result;
    };
    for (let i = 0; i < loop.length; i++) {
      const a = vertices[i]!, b = vertices[(i + 1) % loop.length]!;
      caps.push(capVertex(center), capVertex(reverse ? b : a), capVertex(reverse ? a : b));
    }
  }
  if (!caps.length) return;
  const first = position.count;
  for (const [name, attr] of attributes) {
    const ArrayType = attr.array.constructor as { new(length: number): THREE.TypedArray };
    const array = new ArrayType(attr.array.length + caps.length * attr.itemSize);
    array.set(attr.array);
    caps.forEach((v, i) => array.set(v[name]!, attr.array.length + i * attr.itemSize));
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attr.itemSize, attr.normalized));
  }
  if (indices) geometry.setIndex([...indices.array, ...caps.map((_, i) => first + i)]);
  if (geometry.groups.length) geometry.addGroup(count, caps.length, 0);
}
