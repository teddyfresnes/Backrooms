import * as THREE from 'three';

/** The export merges five upright books and three stacked books into two meshes.
 * Weld UV seams for connectivity, then retain every original attribute/triangle.
 * Each connected island in these two authored meshes is one complete book. */
export function splitApartmentBooks(model: THREE.Object3D): void {
  model.updateWorldMatrix(true, true);
  for (const name of ['books', 'books1']) {
    const root = model.getObjectByName(name);
    if (!root || root.userData.booksSeparated) continue;
    root.userData.booksSeparated = true;
    const meshes: THREE.Mesh[] = [];
    root.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
    for (const mesh of meshes) {
      const geometry = mesh.geometry, position = geometry.getAttribute('position'), index = geometry.index;
      const parents: number[] = [], vertexNodes: number[] = [], welded = new Map<string, number>();
      const point = new THREE.Vector3();
      const find = (n: number): number => parents[n] === n ? n : (parents[n] = find(parents[n]!));
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        const key = point.toArray().map(value => Math.round(value * 100_000)).join(',');
        let n = welded.get(key);
        if (n === undefined) { n = parents.length; parents.push(n); welded.set(key, n); }
        vertexNodes.push(n);
      }
      const count = index?.count ?? position.count;
      for (let i = 0; i < count; i += 3) {
        const a = find(vertexNodes[index?.getX(i) ?? i]!);
        parents[find(vertexNodes[index?.getX(i + 1) ?? i + 1]!)] = a;
        parents[find(vertexNodes[index?.getX(i + 2) ?? i + 2]!)] = a;
      }
      const islands = new Map<number, number[]>();
      for (let i = 0; i < count; i += 3) {
        const key = find(vertexNodes[index?.getX(i) ?? i]!);
        const triangles = islands.get(key) ?? [];
        for (let corner = 0; corner < 3; corner++) triangles.push(index?.getX(i + corner) ?? i + corner);
        islands.set(key, triangles);
      }
      let number = 0;
      for (const triangles of islands.values()) {
        const vertices = [...new Set(triangles)], remap = new Map(vertices.map((v, i) => [v, i]));
        const part = new THREE.BufferGeometry();
        for (const [key, attr] of Object.entries(geometry.attributes)) {
          const values: number[] = [];
          for (const v of vertices) for (let c = 0; c < attr.itemSize; c++) values.push(attr.getComponent(v, c));
          part.setAttribute(key, new THREE.Float32BufferAttribute(values, attr.itemSize));
        }
        part.setIndex(triangles.map(v => remap.get(v)!));
        part.computeBoundingBox(); part.computeBoundingSphere();
        const book = new THREE.Mesh(part, mesh.material);
        book.name = `apartment-book-${name}-${number++}`;
        book.position.copy(mesh.position); book.quaternion.copy(mesh.quaternion); book.scale.copy(mesh.scale);
        book.userData.noBatch = true; book.userData.pickableBook = true;
        book.castShadow = false; book.receiveShadow = true;
        mesh.parent!.add(book);
      }
      mesh.visible = false;
    }
  }
  const single = model.getObjectByName('book');
  if (single) { single.userData.noBatch = true; single.userData.pickableBook = true; }
}
