import * as THREE from 'three';
import type { StaticCollider } from '../world/types';
import { floorY, midLandingY, STAIRWELL_BOUNDS, STAIRWELL_LEVEL_COUNT } from '../stairwell/layout';

const MODEL_URL = '/assets/imported-apartment/apartment.json';

// The user's latest Three.js Editor export already contains the requested
// apartment alignment. Do not add another runtime offset or the doorway will
// drift relative to the stairwell again.
const APARTMENT_ALIGNMENT_Z = 0;
const ENTRY_OPEN_ANGLE = -Math.PI * 0.52;

const SHELL_MESH_NAMES = new Set([
  'Base_M_MainParts_0',
  'bathroom_wall_M_MainParts_0',
  'wallCloset_M_MainParts_0',
  'Doorframe_M_MainParts_0',
  'door_frame_M_MainParts_0',
]);

const MAJOR_COLLIDER_NAMES = [
  'cabinets',
  'Refrigirator',
  'Bed',
  'Desk',
  'Drawer',
  'bathtub',
  'table',
  'Radiator',
] as const;

const colliderFromBox = (id: string, box: THREE.Box3): StaticCollider => {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return {
    id,
    center: { x: center.x, y: center.y, z: center.z },
    halfExtents: {
      x: Math.max(0.025, size.x * 0.5),
      y: Math.max(0.025, size.y * 0.5),
      z: Math.max(0.025, size.z * 0.5),
    },
    kind: 'barrier',
  };
};

const requireObject = (root: THREE.Object3D, name: string): THREE.Object3D => {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`Objet requis absent du modèle importé: ${name}`);
  return object;
};

const collectMeshes = (root: THREE.Object3D): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
};

// Sketchfab's leaf meshes were authored primarily from one side. For an FPS
// interior the front door must remain opaque/visible from both sides.
const forceOpaqueTwoSided = (root: THREE.Object3D): void => {
  const clones = new Map<THREE.Material, THREE.Material>();
  const cloneMaterial = (source: THREE.Material): THREE.Material => {
    const cached = clones.get(source);
    if (cached) return cached;
    const clone = source.clone();
    clone.side = THREE.DoubleSide;
    clone.transparent = false;
    clone.opacity = 1;
    clone.alphaTest = 0;
    clone.depthTest = true;
    clone.depthWrite = true;
    clone.needsUpdate = true;
    clones.set(source, clone);
    return clone;
  };

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => cloneMaterial(material))
      : cloneMaterial(mesh.material);
  });
};

const tintDoorLeafBrown = (root: THREE.Object3D): void => {
  const clones = new Map<THREE.Material, THREE.Material>();
  const tintMaterial = (source: THREE.Material): THREE.Material => {
    const cached = clones.get(source);
    if (cached) return cached;
    const clone = source.clone();
    if (clone instanceof THREE.MeshStandardMaterial || clone instanceof THREE.MeshPhysicalMaterial) {
      // Warm brown painted-wood look while preserving the baked texture detail.
      clone.color.multiply(new THREE.Color(0x8a6a49));
      clone.roughness = Math.max(clone.roughness, 0.72);
      clone.metalness = Math.min(clone.metalness, 0.08);
    }
    clone.needsUpdate = true;
    clones.set(source, clone);
    return clone;
  };

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => tintMaterial(material))
      : tintMaterial(mesh.material);
  });
};


// The imported frame is a closed solid mesh. Rendering it DoubleSide (as we do
// for the thin door leaf) makes the very thin nested faces in the upper lintel
// compete in the depth buffer and produces the visible blinking strip. Keep the
// frame opaque/front-sided and give it a tiny depth bias so it wins cleanly
// against adjacent masonry without moving the geometry out of the wall.
// The source mesh only has a complete lever on the apartment side. Clone the
// real interior hardware out of the imported mesh and mirror it to the
// stairwell face, so every neighboring apartment entrance gets the same real
// hardware too without any procedural replacement geometry.
const cloneInteriorDoorHardwareToExterior = (leaf: THREE.Object3D): void => {
  const sourceMesh = collectMeshes(leaf)[0];
  if (!sourceMesh) throw new Error('Mesh de porte importée absent.');

  const sourceGeometry = sourceMesh.geometry;
  const position = sourceGeometry.getAttribute('position');
  const index = sourceGeometry.getIndex();
  if (!position || !index) {
    throw new Error('La porte importée doit rester une géométrie indexée pour cloner sa vraie poignée.');
  }

  sourceGeometry.computeBoundingBox();
  const doorBounds = sourceGeometry.boundingBox;
  if (!doorBounds) throw new Error('Bounding box de la porte importée indisponible.');
  const doorSize = doorBounds.getSize(new THREE.Vector3());

  // The authored DOOR mesh contains the slab and the interior hardware as
  // disconnected triangle islands. Build those connected components directly
  // from the original indexed mesh so the real handle can be reused verbatim.
  const triangleCount = Math.floor(index.count / 3);
  const vertexTriangles = new Map<number, number[]>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = index.getX(triangle * 3 + corner);
      const triangles = vertexTriangles.get(vertex) ?? [];
      triangles.push(triangle);
      vertexTriangles.set(vertex, triangles);
    }
  }

  interface Component {
    triangles: number[];
    box: THREE.Box3;
  }

  const components: Component[] = [];
  const visited = new Uint8Array(triangleCount);
  for (let seed = 0; seed < triangleCount; seed += 1) {
    if (visited[seed]) continue;
    const stack = [seed];
    visited[seed] = 1;
    const triangles: number[] = [];
    const box = new THREE.Box3();

    while (stack.length > 0) {
      const triangle = stack.pop()!;
      triangles.push(triangle);
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = index.getX(triangle * 3 + corner);
        box.expandByPoint(new THREE.Vector3(
          position.getX(vertex),
          position.getY(vertex),
          position.getZ(vertex),
        ));
        for (const neighbor of vertexTriangles.get(vertex) ?? []) {
          if (visited[neighbor]) continue;
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }
    components.push({ triangles, box });
  }

  // On this Sketchfab door the real interior escutcheon/lever/lock assembly is
  // the compact cluster at latch height near the -Z edge. This selects every
  // disconnected island belonging to that assembly while excluding the four
  // large slab faces. No replacement geometry is authored here.
  const handleComponents = components.filter(({ box }) => {
    const size = box.getSize(new THREE.Vector3());
    return (
      box.min.y > doorBounds.min.y + 1.14 &&
      box.max.y < doorBounds.min.y + 1.56 &&
      box.max.z < doorBounds.min.z + 0.19 &&
      size.y < 0.5 &&
      size.z < 0.2
    );
  });
  if (handleComponents.length < 5) {
    throw new Error(`Poignée intérieure importée non reconnue (${handleComponents.length} composants).`);
  }

  // Derive the leaf mid-plane from the large slab components only, otherwise
  // the protruding interior lever would bias the mirror plane.
  const slabComponents = components.filter(({ box }) => {
    const size = box.getSize(new THREE.Vector3());
    return size.y > doorSize.y * 0.8 || size.z > doorSize.z * 0.8;
  });
  if (slabComponents.length === 0) throw new Error('Faces principales de la porte importée non reconnues.');
  const slabMinX = Math.min(...slabComponents.map(({ box }) => box.min.x));
  const slabMaxX = Math.max(...slabComponents.map(({ box }) => box.max.x));
  const mirrorX = (slabMinX + slabMaxX) * 0.5;

  const selectedTriangles = handleComponents.flatMap(({ triangles }) => triangles);
  const mirroredGeometry = new THREE.BufferGeometry();

  for (const [attributeName, attribute] of Object.entries(sourceGeometry.attributes)) {
    const values: number[] = [];
    for (const triangle of selectedTriangles) {
      // Reflection flips winding. Reverse the last two corners so the copied
      // hardware remains front-facing even if its material later becomes
      // single-sided again.
      for (const corner of [0, 2, 1]) {
        const vertex = index.getX(triangle * 3 + corner);
        for (let item = 0; item < attribute.itemSize; item += 1) {
          let value = attribute.getComponent(vertex, item);
          if (attributeName === 'position' && item === 0) {
            value = mirrorX * 2 - value;
          } else if (attributeName === 'normal' && item === 0) {
            value = -value;
          } else if (attributeName === 'tangent' && (item === 0 || item === 3)) {
            value = -value;
          }
          values.push(value);
        }
      }
    }
    mirroredGeometry.setAttribute(
      attributeName,
      new THREE.Float32BufferAttribute(values, attribute.itemSize, attribute.normalized),
    );
  }

  mirroredGeometry.computeBoundingBox();
  mirroredGeometry.computeBoundingSphere();

  const sourceMaterial = Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material;
  const mirroredHandleMaterial = sourceMaterial.clone();
  if (mirroredHandleMaterial instanceof THREE.MeshStandardMaterial || mirroredHandleMaterial instanceof THREE.MeshPhysicalMaterial) {
    mirroredHandleMaterial.color = new THREE.Color(0x56585f);
    mirroredHandleMaterial.roughness = 0.42;
    mirroredHandleMaterial.metalness = 0.68;
  }
  mirroredHandleMaterial.needsUpdate = true;

  const mirroredHandle = new THREE.Mesh(mirroredGeometry, mirroredHandleMaterial);
  mirroredHandle.name = 'front-door-exterior-handle-clone';
  mirroredHandle.position.copy(sourceMesh.position);
  // Sink the mirrored hardware a little bit back into the leaf so it reads as
  // mounted on the panel instead of hovering slightly proud of it.
  mirroredHandle.position.x += 0.03;
  mirroredHandle.quaternion.copy(sourceMesh.quaternion);
  mirroredHandle.scale.copy(sourceMesh.scale);
  mirroredHandle.castShadow = false;
  mirroredHandle.receiveShadow = false;
  mirroredHandle.frustumCulled = true;
  leaf.add(mirroredHandle);
};

const stabilizeDoorFrame = (root: THREE.Object3D): void => {
  const clones = new Map<THREE.Material, THREE.Material>();
  const cloneMaterial = (source: THREE.Material): THREE.Material => {
    const cached = clones.get(source);
    if (cached) return cached;
    const clone = source.clone();
    clone.side = THREE.FrontSide;
    clone.transparent = false;
    clone.opacity = 1;
    clone.alphaTest = 0;
    clone.depthTest = true;
    clone.depthWrite = true;
    clone.polygonOffset = true;
    clone.polygonOffsetFactor = -1;
    clone.polygonOffsetUnits = -4;

    // The source material is extremely metallic and carries a strong normal
    // map. Slightly damping those two terms removes specular shimmer on the
    // narrow horizontal header while preserving the original colour texture.
    if (clone instanceof THREE.MeshStandardMaterial) {
      clone.roughness = Math.max(clone.roughness, 0.78);
      clone.metalness = Math.min(clone.metalness, 0.35);
      if (clone.normalMap) clone.normalScale.multiplyScalar(0.55);
    }

    clone.needsUpdate = true;
    clones.set(source, clone);
    return clone;
  };

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => cloneMaterial(material))
      : cloneMaterial(mesh.material);
    mesh.renderOrder = 2;
  });
};

interface DoorRuntime {
  pivot: THREE.Group;
  leaf: THREE.Object3D;
  closedBox: THREE.Box3;
  closedAngle: number;
  openAngle: number;
}

export class ImportedApartmentEnvironment {
  readonly group = new THREE.Group();
  readonly entryDoor: DoorRuntime;
  readonly shellColliderMeshes: THREE.Mesh[];
  readonly furnitureColliders: StaticCollider[];
  readonly entrySpawn: THREE.Vector3;
  readonly floorY: number;
  readonly doorCenter: THREE.Vector3;

  private constructor(private readonly model: THREE.Object3D) {
    this.group.name = 'imported-sketchfab-apartment-runtime';
    this.group.position.z = APARTMENT_ALIGNMENT_Z;
    this.model.name = 'imported-sketchfab-apartment';
    this.group.add(this.model);

    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
    });

    this.group.updateMatrixWorld(true);

    // Only the apartment entrance is interactive. Interior doors stay exactly
    // where the user placed them in Three.js Editor and are static/collidable.
    const entryLeaf = requireObject(this.model, 'DOOR');
    const entryFrame = requireObject(this.model, 'Doorframe');
    forceOpaqueTwoSided(entryLeaf);
    tintDoorLeafBrown(entryLeaf);
    cloneInteriorDoorHardwareToExterior(entryLeaf);
    stabilizeDoorFrame(entryFrame);
    this.entryDoor = this.makeDoorRuntime(
      'imported-apartment-entry-door-pivot',
      entryLeaf,
      (box) => new THREE.Vector3(box.getCenter(new THREE.Vector3()).x, box.min.y, box.min.z),
      0,
      ENTRY_OPEN_ANGLE,
    );
    this.doorCenter = this.entryDoor.closedBox.getCenter(new THREE.Vector3());
    this.floorY = this.entryDoor.closedBox.min.y - 0.041;

    // Reuse the exact imported leaf + frame for every other apartment entrance
    // in the stairwell. These are decorative/static copies only; the player's
    // own front door above remains the sole interactive door.
    this.addNeighborApartmentDoors(entryLeaf, entryFrame);

    const bathroomLeaf = requireObject(this.model, 'bathroom_door');
    const closetLeaf = requireObject(this.model, 'closet_door');
    forceOpaqueTwoSided(bathroomLeaf);
    tintDoorLeafBrown(bathroomLeaf);
    forceOpaqueTwoSided(closetLeaf);
    tintDoorLeafBrown(closetLeaf);

    this.shellColliderMeshes = [];
    for (const mesh of collectMeshes(this.model)) {
      if (SHELL_MESH_NAMES.has(mesh.name)) this.shellColliderMeshes.push(mesh);
    }
    if (this.shellColliderMeshes.length < 3) {
      throw new Error('Le shell collider de l’appartement importé est incomplet.');
    }

    const furniture: StaticCollider[] = [];
    for (const name of MAJOR_COLLIDER_NAMES) {
      const object = this.model.getObjectByName(name);
      if (!object) continue;
      const box = new THREE.Box3().setFromObject(object);
      if (!box.isEmpty()) furniture.push(colliderFromBox(`imported-${name}`, box));
    }

    // Interior doors are intentionally non-interactive, but they must still
    // block the player instead of being ghost geometry.
    for (const [id, leaf] of [
      ['imported-bathroom-door-static', bathroomLeaf],
      ['imported-closet-door-static', closetLeaf],
    ] as const) {
      const box = new THREE.Box3().setFromObject(leaf);
      if (!box.isEmpty()) furniture.push(colliderFromBox(id, box));
    }

    this.furnitureColliders = furniture;

    // Spawn outside the imported front door, on the stairwell landing.
    this.entrySpawn = new THREE.Vector3(
      this.entryDoor.closedBox.max.x + 0.68,
      this.floorY + 0.865,
      this.doorCenter.z,
    );

    // Cheap interior fill lights: the imported scene contains baked materials
    // but no runtime lights after export. No dynamic shadows.
    const lightY = this.floorY + 2.18;
    const warm = new THREE.PointLight(0xffdfb2, 0.72, 7.2, 2);
    warm.position.set(-5.7, lightY, -1.1);
    warm.castShadow = false;
    warm.name = 'imported-apartment-fill-main';
    const bedroom = new THREE.PointLight(0xffd8aa, 0.52, 5.8, 2);
    bedroom.position.set(-7.5, lightY, -5.0);
    bedroom.castShadow = false;
    bedroom.name = 'imported-apartment-fill-bedroom';
    const bathroom = new THREE.PointLight(0xffe7cf, 0.42, 4.2, 2);
    bathroom.position.set(-3.0, lightY, -5.1);
    bathroom.castShadow = false;
    bathroom.name = 'imported-apartment-fill-bathroom';
    this.group.add(warm, bedroom, bathroom);
  }

  private cloneAtWorldMatrix(
    source: THREE.Object3D,
    worldMatrix: THREE.Matrix4,
    name: string,
  ): THREE.Object3D {
    const clone = source.clone(true);
    clone.name = name;
    clone.matrixAutoUpdate = false;
    this.group.updateMatrixWorld(true);
    clone.matrix.copy(this.group.matrixWorld.clone().invert().multiply(worldMatrix));
    clone.matrixWorldNeedsUpdate = true;
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
    });
    this.group.add(clone);
    return clone;
  }

  private addNeighborApartmentDoors(entryLeaf: THREE.Object3D, entryFrame: THREE.Object3D): void {
    this.group.updateMatrixWorld(true);
    entryLeaf.updateWorldMatrix(true, true);
    entryFrame.updateWorldMatrix(true, true);

    const sourceCenter = this.entryDoor.closedBox.getCenter(new THREE.Vector3());
    // The real front door is authored *inside* the 22 cm stairwell wall, not
    // pasted onto its plaster face. Mirror that exact X inset on the opposite
    // wall and keep it unchanged on lower west landings. The stairwell shell is
    // cut around every neighbor doorway, so the frame sits in the reveal just
    // like the player's own entrance instead of protruding into the corridor.
    const sourceAbsX = Math.abs(sourceCenter.x);
    const relativeCenterY = sourceCenter.y - this.floorY;

    const sourceLeafWorld = entryLeaf.matrixWorld.clone();
    const sourceFrameWorld = entryFrame.matrixWorld.clone();

    for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level += 1) {
      for (const side of [-1, 1] as const) {
        // Top-floor west is the real interactive apartment door already present
        // in the imported model; every other landing gets a static clone.
        if (side === -1 && level === STAIRWELL_LEVEL_COUNT - 1) continue;

        const targetCenter = new THREE.Vector3(
          side * sourceAbsX,
          floorY(level) + relativeCenterY,
          sourceCenter.z,
        );
        const rotation = side === -1 ? 0 : Math.PI;
        const delta = new THREE.Matrix4()
          .makeTranslation(targetCenter.x, targetCenter.y, targetCenter.z)
          .multiply(new THREE.Matrix4().makeRotationY(rotation))
          .multiply(new THREE.Matrix4().makeTranslation(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z));
        const prefix = `${side === -1 ? 'west' : 'east'}-neighbor-door-${level}`;

        this.cloneAtWorldMatrix(entryFrame, delta.clone().multiply(sourceFrameWorld), `${prefix}-frame`);
        this.cloneAtWorldMatrix(entryLeaf, delta.clone().multiply(sourceLeafWorld), `${prefix}-leaf`);
      }
    }

    // Also populate the blank wall side of the stairwell with apartment doors,
    // so the hall no longer reads as having apartments only on the window side.
    // These doors sit on the north wall, centered on each mid-landing.
    for (let level = 0; level < STAIRWELL_LEVEL_COUNT - 1; level += 1) {
      const targetCenter = new THREE.Vector3(
        0,
        midLandingY(level) + relativeCenterY,
        STAIRWELL_BOUNDS.maxZ,
      );
      const delta = new THREE.Matrix4()
        .makeTranslation(targetCenter.x, targetCenter.y, targetCenter.z)
        .multiply(new THREE.Matrix4().makeRotationY(-Math.PI * 0.5))
        .multiply(new THREE.Matrix4().makeTranslation(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z));
      const prefix = `north-neighbor-door-${level}`;

      this.cloneAtWorldMatrix(entryFrame, delta.clone().multiply(sourceFrameWorld), `${prefix}-frame`);
      this.cloneAtWorldMatrix(entryLeaf, delta.clone().multiply(sourceLeafWorld), `${prefix}-leaf`);
    }

    this.group.updateMatrixWorld(true);
  }

  private makeDoorRuntime(
    pivotName: string,
    leaf: THREE.Object3D,
    getHingeWorld: (closedAuthorBox: THREE.Box3) => THREE.Vector3,
    closedAngle: number,
    openAngle: number,
  ): DoorRuntime {
    this.group.updateMatrixWorld(true);
    leaf.updateWorldMatrix(true, true);
    const authoredWorld = leaf.matrixWorld.clone();
    const authoredBox = new THREE.Box3().setFromObject(leaf);
    const hingeWorld = getHingeWorld(authoredBox);

    const pivot = new THREE.Group();
    pivot.name = pivotName;
    leaf.parent?.remove(leaf);
    this.group.add(pivot);
    this.group.updateMatrixWorld(true);
    pivot.position.copy(this.group.worldToLocal(hingeWorld.clone()));
    pivot.updateMatrixWorld(true);
    pivot.add(leaf);

    const local = pivot.matrixWorld.clone().invert().multiply(authoredWorld);
    local.decompose(leaf.position, leaf.quaternion, leaf.scale);
    pivot.rotation.y = closedAngle;
    pivot.updateMatrixWorld(true);
    leaf.updateWorldMatrix(true, true);

    return {
      pivot,
      leaf,
      closedBox: new THREE.Box3().setFromObject(leaf),
      closedAngle,
      openAngle,
    };
  }

  static async load(): Promise<ImportedApartmentEnvironment> {
    const loader = new THREE.ObjectLoader();
    const model = await loader.loadAsync(MODEL_URL);
    try {
      return new ImportedApartmentEnvironment(model);
    } catch (error) {
      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      });
      throw error;
    }
  }

  createDoorCollider(id: string, box: THREE.Box3): StaticCollider {
    const colliderBox = box.clone();
    colliderBox.expandByVector(new THREE.Vector3(0.012, 0.006, 0.012));
    return colliderFromBox(id, colliderBox);
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
