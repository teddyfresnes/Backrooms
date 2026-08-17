import * as THREE from 'three';
import type { StaticCollider } from '../world/types';
import { floorY, midLandingY, STAIRWELL_BOUNDS, STAIRWELL_LEVEL_COUNT } from '../stairwell/layout';
import { APARTMENT_ENTRY_DOOR } from './layout';

const MODEL_URL = '/assets/imported-apartment/apartment.json';

// The user's latest Three.js Editor export already contains the requested
// apartment alignment. Do not add another runtime offset or the doorway will
// drift relative to the stairwell again.
const APARTMENT_ALIGNMENT_Z = 0;
const ENTRY_OPEN_ANGLE = -Math.PI * 0.52;
export const APARTMENT_LIGHTS_OFF_SURFACE_FACTOR = 0.14;
const APARTMENT_LIGHTS_OFF_EMISSIVE_FACTOR = 0.04;

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
  'Radiator',
  'chair',
  'nightstand',
  'trashcan',
  'backpack',
  'stool',
  'stool1',
  'can',
] as const;

const REMOVED_DECOR_NAMES = [
  // Open crisp bag and its loose contents on the buffet.
  'pasted__polySurface26',
] as const;

// The apartment export explicitly groups its two panes under
// TRANSPARENCY_NEEDED, but still assigns them the opaque main-parts atlas.
const APARTMENT_WINDOW_GLASS_NAMES = new Set([
  'polySurface16_M_MainParts_0',
  'polySurface24_M_MainParts_0',
]);

export const makeApartmentWindowGlassTransparent = (root: THREE.Object3D): void => {
  const glass = new THREE.MeshBasicMaterial({
    name: 'apartment-window-reflection-free-glass',
    color: 0x000000,
    transparent: true,
    opacity: 0.004,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: true,
    fog: false,
  });

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !APARTMENT_WINDOW_GLASS_NAMES.has(mesh.name)) return;
    mesh.material = glass;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;
  });
};

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

// The imported entrance leaf is an open shell: it has a decorated front plus
// top/side strips, but no rear panel. Seen from the stairwell, the front is
// therefore visible at the bottom of that shell and the strips read as a huge
// outline around it. Reuse the authored front triangles (including their UVs)
// on the missing rear plane so the door is a closed slab with a real second
// face and only its actual thickness visible at grazing angles.
export const closeDoorLeafWithBackFace = (leaf: THREE.Object3D): THREE.Mesh | null => {
  const sourceMesh = collectMeshes(leaf)[0];
  if (!sourceMesh) throw new Error('Mesh de porte importÃ©e absent.');

  const sourceGeometry = sourceMesh.geometry;
  const position = sourceGeometry.getAttribute('position');
  const index = sourceGeometry.getIndex();
  if (!position || !index) {
    throw new Error('La porte importÃ©e doit rester indexÃ©e pour fermer sa face arriÃ¨re.');
  }

  sourceGeometry.computeBoundingBox();
  const bounds = sourceGeometry.boundingBox;
  if (!bounds) throw new Error('Bounding box de la porte importÃ©e indisponible.');
  const size = bounds.getSize(new THREE.Vector3());
  const triangleCount = Math.floor(index.count / 3);
  const broadFaceTriangles: number[] = [];
  let slabMinX = Number.POSITIVE_INFINITY;
  let slabMaxX = Number.NEGATIVE_INFINITY;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const triangleBox = new THREE.Box3();
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = index.getX(triangle * 3 + corner);
      triangleBox.expandByPoint(new THREE.Vector3(
        position.getX(vertex),
        position.getY(vertex),
        position.getZ(vertex),
      ));
    }
    const triangleSize = triangleBox.getSize(new THREE.Vector3());
    const belongsToSlab = triangleSize.y > size.y * 0.8 || triangleSize.z > size.z * 0.8;
    if (belongsToSlab) {
      slabMinX = Math.min(slabMinX, triangleBox.min.x);
      slabMaxX = Math.max(slabMaxX, triangleBox.max.x);
    }
    if (
      triangleSize.x < 1e-4 &&
      triangleSize.y > size.y * 0.8 &&
      triangleSize.z > size.z * 0.8
    ) {
      broadFaceTriangles.push(triangle);
    }
  }

  if (broadFaceTriangles.length < 2 || !Number.isFinite(slabMinX) || !Number.isFinite(slabMaxX)) {
    throw new Error('Face principale de la porte importÃ©e non reconnue.');
  }

  const firstVertex = index.getX(broadFaceTriangles[0] * 3);
  const sourceFaceX = position.getX(firstVertex);
  const backFaceX = Math.abs(sourceFaceX - slabMinX) > Math.abs(sourceFaceX - slabMaxX)
    ? slabMinX
    : slabMaxX;
  if (Math.abs(sourceFaceX - backFaceX) < 1e-4) return null;

  const backGeometry = new THREE.BufferGeometry();
  for (const [attributeName, attribute] of Object.entries(sourceGeometry.attributes)) {
    const values: number[] = [];
    for (const triangle of broadFaceTriangles) {
      for (const corner of [0, 2, 1]) {
        const vertex = index.getX(triangle * 3 + corner);
        for (let item = 0; item < attribute.itemSize; item += 1) {
          let value = attribute.getComponent(vertex, item);
          if (attributeName === 'position' && item === 0) {
            value = backFaceX;
          } else if (attributeName === 'normal' && item < 3) {
            value = -value;
          } else if (attributeName === 'tangent' && item === 3) {
            value = -value;
          }
          values.push(value);
        }
      }
    }
    backGeometry.setAttribute(
      attributeName,
      new THREE.Float32BufferAttribute(values, attribute.itemSize, attribute.normalized),
    );
  }
  backGeometry.computeBoundingBox();
  backGeometry.computeBoundingSphere();

  const backFace = new THREE.Mesh(backGeometry, sourceMesh.material);
  backFace.name = 'front-door-authored-back-face';
  backFace.position.copy(sourceMesh.position);
  backFace.quaternion.copy(sourceMesh.quaternion);
  backFace.scale.copy(sourceMesh.scale);
  backFace.castShadow = sourceMesh.castShadow;
  backFace.receiveShadow = sourceMesh.receiveShadow;
  backFace.frustumCulled = true;
  sourceMesh.parent?.add(backFace);
  return backFace;
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
export const createApartmentDoorHardwareMaterial = (): THREE.MeshStandardMaterial => (
  new THREE.MeshStandardMaterial({
    name: 'apartment-door-hardware-brushed-nickel',
    color: 0x9aa1a8,
    roughness: 0.34,
    metalness: 0.82,
    envMapIntensity: 0.55,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })
);

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
  const copyHardwareGeometry = (mirrored: boolean): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    for (const [attributeName, attribute] of Object.entries(sourceGeometry.attributes)) {
      const values: number[] = [];
      for (const triangle of selectedTriangles) {
        // Reflection flips winding. Reverse the last two corners so the copied
        // hardware remains front-facing even if its material later becomes
        // single-sided again.
        for (const corner of mirrored ? [0, 2, 1] : [0, 1, 2]) {
          const vertex = index.getX(triangle * 3 + corner);
          for (let item = 0; item < attribute.itemSize; item += 1) {
            let value = attribute.getComponent(vertex, item);
            if (mirrored && attributeName === 'position' && item === 0) {
              value = mirrorX * 2 - value;
            } else if (mirrored && attributeName === 'normal' && item === 0) {
              value = -value;
            } else if (mirrored && attributeName === 'tangent' && (item === 0 || item === 3)) {
              value = -value;
            }
            values.push(value);
          }
        }
      }
      geometry.setAttribute(
        attributeName,
        new THREE.Float32BufferAttribute(values, attribute.itemSize, attribute.normalized),
      );
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };

  const hardwareMaterial = createApartmentDoorHardwareMaterial();
  const interiorHandle = new THREE.Mesh(copyHardwareGeometry(false), hardwareMaterial);
  interiorHandle.name = 'front-door-interior-handle-metal-overlay';
  interiorHandle.position.copy(sourceMesh.position);
  interiorHandle.quaternion.copy(sourceMesh.quaternion);
  interiorHandle.scale.copy(sourceMesh.scale);
  interiorHandle.castShadow = false;
  interiorHandle.receiveShadow = false;
  interiorHandle.renderOrder = 3;
  interiorHandle.frustumCulled = true;

  const mirroredHandle = new THREE.Mesh(copyHardwareGeometry(true), hardwareMaterial);
  mirroredHandle.name = 'front-door-exterior-handle-clone';
  mirroredHandle.position.copy(sourceMesh.position);
  // The imported assembly embeds roughly 10 mm of its base in the front face.
  // After reflection, move it 12 mm toward the stairwell so the base clears the
  // rear plane instead of disappearing inside the leaf thickness.
  mirroredHandle.position.x -= 0.012;
  mirroredHandle.quaternion.copy(sourceMesh.quaternion);
  mirroredHandle.scale.copy(sourceMesh.scale);
  mirroredHandle.castShadow = false;
  mirroredHandle.receiveShadow = false;
  mirroredHandle.renderOrder = 3;
  mirroredHandle.frustumCulled = true;
  sourceMesh.parent?.add(interiorHandle, mirroredHandle);
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

export const preciseBoxFromObject = (root: THREE.Object3D): THREE.Box3 => {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(point);
    }
  });
  return box;
};

export const hideObjectsRestingOnSupport = (
  candidatesRoot: THREE.Object3D,
  support: THREE.Object3D,
): string[] => {
  const supportBox = preciseBoxFromObject(support);
  if (supportBox.isEmpty()) return [];

  const hidden: string[] = [];
  for (const candidate of [...candidatesRoot.children]) {
    if (candidate === support || !candidate.visible) continue;
    const candidateBox = preciseBoxFromObject(candidate);
    if (candidateBox.isEmpty()) continue;
    const center = candidateBox.getCenter(new THREE.Vector3());
    const restsOnTop = candidateBox.min.y >= supportBox.max.y - 0.03
      && candidateBox.min.y <= supportBox.max.y + 0.12;
    const insideTop = center.x >= supportBox.min.x && center.x <= supportBox.max.x
      && center.z >= supportBox.min.z && center.z <= supportBox.max.z;
    if (!restsOnTop || !insideTop) continue;
    candidate.visible = false;
    hidden.push(candidate.name);
  }
  return hidden;
};

const moveObjectInWorld = (object: THREE.Object3D, offset: THREE.Vector3): void => {
  object.updateWorldMatrix(true, false);
  const target = object.getWorldPosition(new THREE.Vector3()).add(offset);
  if (object.parent) object.parent.worldToLocal(target);
  object.position.copy(target);
  object.updateWorldMatrix(false, true);
};

export const trimDoorFrameOverhang = (
  root: THREE.Object3D,
  openingWidth: number,
  overlap = 0.018,
): void => {
  root.updateWorldMatrix(true, true);
  const frameBox = new THREE.Box3().setFromObject(root);
  if (frameBox.isEmpty()) return;

  const centerZ = frameBox.getCenter(new THREE.Vector3()).z;
  const minZ = centerZ - openingWidth * 0.5 - overlap;
  const maxZ = centerZ + openingWidth * 0.5 + overlap;
  const worldPoint = new THREE.Vector3();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.getAttribute('position')) return;

    // The imported model has a wide, paper-thin casing around an otherwise
    // correctly sized frame. Clamp only that outer lip in world space: the
    // inner rebate stays aligned with the leaf and the trim no longer sticks
    // conspicuously past the masonry opening.
    const geometry = mesh.geometry.clone();
    const position = geometry.getAttribute('position');
    const worldToLocal = mesh.matrixWorld.clone().invert();
    for (let index = 0; index < position.count; index += 1) {
      worldPoint.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      worldPoint.z = THREE.MathUtils.clamp(worldPoint.z, minZ, maxZ);
      worldPoint.applyMatrix4(worldToLocal);
      position.setXYZ(index, worldPoint.x, worldPoint.y, worldPoint.z);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
  });
};

interface DoorRuntime {
  pivot: THREE.Group;
  leaf: THREE.Object3D;
  closedBox: THREE.Box3;
  closedAngle: number;
  openAngle: number;
}

interface InteriorMaterialState {
  readonly material: THREE.MeshStandardMaterial;
  readonly litColor: THREE.Color;
  readonly litEmissive: THREE.Color;
  readonly litEmissiveIntensity: number;
}

export interface ApartmentWindowBlindRuntime {
  readonly id: string;
  readonly blind: THREE.Object3D;
  readonly pivot: THREE.Group;
  readonly closedScaleY: number;
}

export const suppressApartmentLightGlare = (
  material: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial => {
  material.roughness = Math.max(0.72, material.roughness);
  material.metalness = Math.min(0.18, material.metalness);
  material.roughnessMap = null;
  material.envMapIntensity = Math.min(0.25, material.envMapIntensity);
  material.emissiveIntensity = Math.min(0.28, material.emissiveIntensity);
  material.needsUpdate = true;
  return material;
};

export const makeApartmentMainFixtureLuminous = (root: THREE.Object3D): void => {
  const clones = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const makeLuminous = (source: THREE.Material): THREE.Material => {
      const cached = clones.get(source);
      if (cached) return cached;
      const clone = source.clone();
      clone.name = 'apartment-main-fixture-luminous';
      if (clone instanceof THREE.MeshStandardMaterial || clone instanceof THREE.MeshPhysicalMaterial) {
        clone.color.lerp(new THREE.Color(0xffedcf), 0.42);
        clone.emissive.setHex(0xffd9a6);
        clone.emissiveIntensity = 1.05;
        clone.roughness = Math.max(0.72, clone.roughness);
        clone.metalness = Math.min(0.08, clone.metalness);
      }
      clone.needsUpdate = true;
      clones.set(source, clone);
      return clone;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => makeLuminous(material))
      : makeLuminous(mesh.material);
  });
};

export const createApartmentMainLight = (fixtureBox: THREE.Box3): THREE.PointLight => {
  if (fixtureBox.isEmpty()) throw new Error('Plafonnier principal de lâ€™appartement introuvable.');
  const light = new THREE.PointLight(0xffddb5, 0, 14, 1);
  light.name = 'imported-apartment-main-ceiling-light';
  light.position.copy(fixtureBox.getCenter(new THREE.Vector3()));
  // Keep the source just below the real diffuser: its single ceiling halo is
  // centered on the visible fixture while the low decay reaches the entrance
  // and room corners without adding fake secondary sources.
  light.position.y = fixtureBox.min.y - 0.28;
  light.castShadow = false;
  return light;
};

export class ImportedApartmentEnvironment {
  readonly group = new THREE.Group();
  readonly entryDoor: DoorRuntime;
  readonly lightSwitch: THREE.Group;
  readonly doorLock: THREE.Group;
  readonly windowBlinds: readonly [ApartmentWindowBlindRuntime, ApartmentWindowBlindRuntime];
  readonly shellColliderMeshes: THREE.Mesh[];
  readonly furnitureColliders: StaticCollider[];
  readonly entrySpawn: THREE.Vector3;
  readonly floorY: number;
  readonly doorCenter: THREE.Vector3;
  private readonly interiorLights: Array<{ light: THREE.PointLight; intensity: number }>;
  private readonly interiorMaterialStates: InteriorMaterialState[] = [];
  private readonly replacedInteriorMaterials = new Set<THREE.Material>();
  private readonly lightSwitchIndicator: THREE.MeshBasicMaterial;
  private readonly doorLockBolt: THREE.Mesh;
  private interiorLightsEnabled = false;

  private constructor(private readonly model: THREE.Object3D) {
    this.group.name = 'imported-sketchfab-apartment-runtime';
    this.group.position.z = APARTMENT_ALIGNMENT_Z;
    this.model.name = 'imported-sketchfab-apartment';
    this.group.add(this.model);

    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
    });
    makeApartmentWindowGlassTransparent(this.model);

    this.group.updateMatrixWorld(true);

    const livingRoomTable = requireObject(this.model, 'table');
    const kitchenClutter = requireObject(this.model, 'KitchenStuff');
    hideObjectsRestingOnSupport(kitchenClutter, livingRoomTable);
    livingRoomTable.visible = false;
    for (const name of REMOVED_DECOR_NAMES) requireObject(this.model, name).visible = false;

    // The tall bin beside the entrance was intersecting the east wall. Keep
    // the authored orientation but bring it a small step into the apartment.
    moveObjectInWorld(requireObject(this.model, 'can'), new THREE.Vector3(-0.14, 0, 0));

    // Only the apartment entrance is interactive. Interior doors stay exactly
    // where the user placed them in Three.js Editor and are static/collidable.
    const entryLeaf = requireObject(this.model, 'DOOR');
    const entryFrame = requireObject(this.model, 'Doorframe');
    forceOpaqueTwoSided(entryLeaf);
    tintDoorLeafBrown(entryLeaf);
    closeDoorLeafWithBackFace(entryLeaf);
    cloneInteriorDoorHardwareToExterior(entryLeaf);
    trimDoorFrameOverhang(entryFrame, APARTMENT_ENTRY_DOOR.width);
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

    this.windowBlinds = [
      this.createWindowBlind(
        'apartment-west-window-blind',
        requireObject(this.model, 'polySurface36'),
        requireObject(this.model, 'Window2'),
      ),
      this.createWindowBlind(
        'apartment-north-window-blind',
        requireObject(this.model, 'polySurface34'),
        requireObject(this.model, 'Window'),
      ),
    ];

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
    this.shellColliderMeshes.forEach((mesh) => {
      mesh.castShadow = true;
    });

    const furniture: StaticCollider[] = [];
    for (const name of MAJOR_COLLIDER_NAMES) {
      const object = this.model.getObjectByName(name);
      if (!object || !object.visible) continue;
      const box = preciseBoxFromObject(object);
      if (!box.isEmpty()) furniture.push(colliderFromBox(`imported-${name}`, box));
    }

    // Interior doors are intentionally non-interactive, but they must still
    // block the player instead of being ghost geometry.
    for (const [id, leaf] of [
      ['imported-bathroom-door-static', bathroomLeaf],
      ['imported-closet-door-static', closetLeaf],
    ] as const) {
      // setFromObject transforms a local AABB and made the thin bathroom leaf
      // look almost 70 cm deep to Rapier. Vertex-precise bounds keep the player
      // close to the visible panel without letting them pass through it.
      const box = preciseBoxFromObject(leaf);
      if (!box.isEmpty()) furniture.push(colliderFromBox(id, box));
    }

    this.furnitureColliders = furniture;

    // Spawn outside the imported front door, on the stairwell landing.
    this.entrySpawn = new THREE.Vector3(
      this.entryDoor.closedBox.max.x + 0.68,
      this.floorY + 0.865,
      this.doorCenter.z,
    );

    const mainFixture = requireObject(this.model, 'light1');
    makeApartmentMainFixtureLuminous(mainFixture);
    this.prepareInteriorLightResponsiveMaterials();

    // One real source, attached to the visible living-room plafonnier. Its
    // extended range and linear decay replace the three offset point lights
    // that painted separate, disconnected auras across the ceiling.
    const mainLight = createApartmentMainLight(preciseBoxFromObject(mainFixture));
    this.interiorLights = [{ light: mainLight, intensity: 1.35 }];

    const switchPlateMaterial = new THREE.MeshStandardMaterial({
      name: 'apartment-light-switch-plate',
      color: 0xd1c8b5,
      roughness: 0.76,
      metalness: 0.03,
    });
    const switchRockerMaterial = new THREE.MeshStandardMaterial({
      name: 'apartment-light-switch-rocker',
      color: 0x9f9788,
      roughness: 0.7,
      metalness: 0.02,
    });
    this.lightSwitchIndicator = new THREE.MeshBasicMaterial({
      name: 'apartment-light-switch-visible-indicator',
      color: 0x9db37b,
      toneMapped: false,
    });
    this.lightSwitch = new THREE.Group();
    this.lightSwitch.name = 'apartment-light-switch';
    // The entrance is set into the east wall (x ~= -2). The apartment lies to
    // its west, so this plate sits on the interior face immediately beside the
    // latch side of the door.
    this.lightSwitch.position.set(-2.13, this.floorY + 1.23, -2.04);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.2, 0.14),
      switchPlateMaterial,
    );
    plate.name = 'apartment-light-switch-hit-target';
    plate.receiveShadow = true;
    const rocker = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.075, 0.07),
      switchRockerMaterial,
    );
    rocker.name = 'apartment-light-switch-rocker';
    rocker.position.x = -0.027;
    const indicator = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.022, 0.04),
      this.lightSwitchIndicator,
    );
    indicator.name = 'apartment-light-switch-indicator';
    indicator.position.set(-0.034, 0.066, 0);
    this.lightSwitch.add(plate, rocker, indicator);
    this.lightSwitch.userData.rocker = rocker;

    // Compact surface bolt on the same interior wall plane as the light
    // switch. Keep it tight to the latch jamb: the previous oversized plate
    // was derived from the leaf depth and ended up reading as hardware on the
    // perpendicular reveal instead of a real apartment security bolt.
    const lockMetal = createApartmentDoorHardwareMaterial();
    lockMetal.name = 'apartment-entry-door-lock-nickel';
    const lockDarkMetal = lockMetal.clone();
    lockDarkMetal.name = 'apartment-entry-door-lock-case';
    lockDarkMetal.color.setHex(0x4b5055);
    lockDarkMetal.roughness = 0.52;
    const lockScrewMetal = lockMetal.clone();
    lockScrewMetal.name = 'apartment-entry-door-lock-screws';
    lockScrewMetal.color.setHex(0xc2c6c8);
    this.doorLock = new THREE.Group();
    this.doorLock.name = 'apartment-entry-door-wall-lock';
    this.doorLock.position.set(
      this.lightSwitch.position.x,
      this.floorY + 1.42,
      APARTMENT_ENTRY_DOOR.centerZ + APARTMENT_ENTRY_DOOR.leafWidth * 0.5 + 0.075,
    );
    const lockPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.105, 0.115),
      lockDarkMetal,
    );
    lockPlate.name = 'apartment-entry-door-lock-hit-target';
    lockPlate.position.x = -0.011;
    const lockCase = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.064, 0.078),
      lockDarkMetal,
    );
    lockCase.name = 'apartment-entry-door-lock-case';
    lockCase.position.x = -0.043;
    const boltGuideGeometry = new THREE.CylinderGeometry(0.019, 0.019, 0.026, 12);
    boltGuideGeometry.rotateX(Math.PI * 0.5);
    const doorSideGuide = new THREE.Mesh(boltGuideGeometry, lockDarkMetal);
    doorSideGuide.name = 'apartment-entry-door-lock-door-side-guide';
    doorSideGuide.position.set(-0.066, 0, -0.052);
    const wallSideGuide = doorSideGuide.clone();
    wallSideGuide.name = 'apartment-entry-door-lock-wall-side-guide';
    wallSideGuide.position.z = 0.037;
    this.doorLockBolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0105, 0.0105, 0.115, 12),
      lockMetal,
    );
    this.doorLockBolt.geometry.rotateX(Math.PI * 0.5);
    this.doorLockBolt.name = 'apartment-entry-door-sliding-bolt';
    this.doorLockBolt.position.x = -0.067;
    const thumbStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, 0.038, 10),
      lockMetal,
    );
    thumbStem.name = 'apartment-entry-door-lock-thumb-stem';
    thumbStem.rotation.z = Math.PI * 0.5;
    thumbStem.position.set(-0.018, 0, 0.025);
    const thumbGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.044, 0.017),
      lockMetal,
    );
    thumbGrip.name = 'apartment-entry-door-lock-thumb-grip';
    thumbGrip.position.set(-0.038, 0, 0.025);
    this.doorLockBolt.add(thumbStem, thumbGrip);
    const keeper = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.058, 0.026),
      lockDarkMetal,
    );
    keeper.name = 'apartment-entry-door-lock-keeper';
    keeper.position.set(-0.067, 0, -0.078);
    const screwGeometry = new THREE.CylinderGeometry(0.006, 0.006, 0.004, 10);
    screwGeometry.rotateZ(Math.PI * 0.5);
    const screws = [-1, 1].map((direction, index) => {
      const screw = new THREE.Mesh(screwGeometry, lockScrewMetal);
      screw.name = `apartment-entry-door-lock-screw-${index + 1}`;
      screw.position.set(-0.024, direction * 0.036, 0.038);
      return screw;
    });
    this.doorLock.add(
      lockPlate,
      lockCase,
      doorSideGuide,
      wallSideGuide,
      this.doorLockBolt,
      keeper,
      ...screws,
    );
    this.setEntryDoorLocked(false);

    this.group.add(mainLight);
    this.group.add(this.lightSwitch, this.doorLock);
    this.setInteriorLightsEnabled(false);
  }

  get areInteriorLightsEnabled(): boolean {
    return this.interiorLightsEnabled;
  }

  setInteriorLightsEnabled(enabled: boolean): void {
    this.interiorLightsEnabled = enabled;
    this.interiorLights.forEach(({ light, intensity }) => {
      light.intensity = enabled ? intensity : 0;
    });
    const surfaceFactor = enabled ? 1 : APARTMENT_LIGHTS_OFF_SURFACE_FACTOR;
    const emissiveFactor = enabled ? 1 : APARTMENT_LIGHTS_OFF_EMISSIVE_FACTOR;
    for (const state of this.interiorMaterialStates) {
      state.material.color.copy(state.litColor).multiplyScalar(surfaceFactor);
      state.material.emissive.copy(state.litEmissive).multiplyScalar(emissiveFactor);
      state.material.emissiveIntensity = state.litEmissiveIntensity * emissiveFactor;
    }
    const rocker = this.lightSwitch.userData.rocker as THREE.Mesh | undefined;
    if (rocker) {
      // A wall rocker pivots in place: translating it vertically made the
      // entire switch visibly jump whenever the light changed state.
      rocker.rotation.z = enabled ? 0.16 : -0.16;
    }
    // A dim locator remains readable in darkness; green confirms that the
    // apartment lights are actually powered.
    this.lightSwitchIndicator.color.setHex(enabled ? 0xd9efaa : 0x8d9879);
  }

  setEntryDoorLocked(locked: boolean): void {
    this.doorLockBolt.position.z = locked ? -0.052 : 0.012;
  }

  private createWindowBlind(
    id: string,
    blind: THREE.Object3D,
    window: THREE.Object3D,
  ): ApartmentWindowBlindRuntime {
    const blindBox = preciseBoxFromObject(blind);
    const windowBox = preciseBoxFromObject(window);
    if (blindBox.isEmpty() || windowBox.isEmpty()) {
      throw new Error(`Store importÃ© incomplet: ${id}`);
    }
    const blindHeight = Math.max(0.001, blindBox.max.y - blindBox.min.y);
    // Each imported store keeps its own authored dimensions. Its individual
    // closed scale is derived from the matching window instead of applying one
    // generic panel size to both windows.
    const closedScaleY = Math.max(1, (blindBox.max.y - windowBox.min.y) / blindHeight);
    const blindCenter = blindBox.getCenter(new THREE.Vector3());
    const pivotWorld = new THREE.Vector3(blindCenter.x, blindBox.max.y, blindCenter.z);
    const pivot = new THREE.Group();
    pivot.name = `${id}-top-pivot`;
    this.group.add(pivot);
    this.group.updateWorldMatrix(true, true);
    pivot.position.copy(this.group.worldToLocal(pivotWorld));
    pivot.updateWorldMatrix(true, false);
    // attach() preserves the exact imported open pose. Scaling the pivot only
    // stretches the original store downward from its top edge; scale 1 restores
    // the untouched source shape and material.
    pivot.attach(blind);
    pivot.updateWorldMatrix(true, true);
    return { id, blind, pivot, closedScaleY };
  }

  private prepareInteriorLightResponsiveMaterials(): void {
    const clones = new Map<THREE.Material, THREE.Material>();
    const cloneMaterial = (source: THREE.Material): THREE.Material => {
      const cached = clones.get(source);
      if (cached) return cached;
      // The glass must keep the same nocturnal calibration whether the room
      // light is on or off; only the opaque interior surfaces are dimmed.
      if (source.name === 'apartment-window-night-glass') return source;
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const preserveHardwareFinish = source.name === 'apartment-door-hardware-brushed-nickel';
      const material = preserveHardwareFinish
        ? source.clone()
        : suppressApartmentLightGlare(source.clone());
      if (source.name === 'apartment-main-fixture-luminous') {
        // The glare limiter is correct for walls and furniture, but the actual
        // diffuser must still look powered instead of remaining a grey dome.
        material.emissive.setHex(0xffd9a6);
        material.emissiveIntensity = 1.05;
      }
      material.name = `${source.name || 'apartment-surface'}-light-responsive`;
      clones.set(source, material);
      this.replacedInteriorMaterials.add(source);
      this.interiorMaterialStates.push({
        material,
        litColor: material.color.clone(),
        litEmissive: material.emissive.clone(),
        litEmissiveIntensity: material.emissiveIntensity,
      });
      return material;
    };

    // Clone only materials that remain inside the apartment. Neighboring door
    // copies were created earlier and keep their normal stairwell calibration.
    for (const root of [this.model, this.entryDoor.pivot]) {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((material) => cloneMaterial(material))
          : cloneMaterial(mesh.material);
      });
    }
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
    this.replacedInteriorMaterials.forEach((material) => material.dispose());
    this.group.removeFromParent();
  }
}
