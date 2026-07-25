import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { getPropAsset } from '../world/PropCatalog';
import type { PropAssetDefinition } from '../world/PropCatalog';
import type { PropPlacement, VisualBiome, WorldPlan } from '../world/types';

const gltfLoader = new GLTFLoader();
const objLoader = new OBJLoader();
const textureLoader = new THREE.TextureLoader();
const normalizedAssetCache = new Map<string, Promise<THREE.Group>>();
const failedAssets = new Set<string>();

const normalizeAsset = (
  source: THREE.Object3D,
  definition: PropAssetDefinition,
): THREE.Group => {
  const normalized = new THREE.Group();
  normalized.name = `normalized-${definition.id}`;
  normalized.add(source);
  source.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(source);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const ratios = [
    initialSize.x > 1e-5 ? definition.size.x / initialSize.x : Number.POSITIVE_INFINITY,
    initialSize.y > 1e-5 ? definition.size.y / initialSize.y : Number.POSITIVE_INFINITY,
    initialSize.z > 1e-5 ? definition.size.z / initialSize.z : Number.POSITIVE_INFINITY,
  ];
  const uniformScale = Math.min(...ratios.filter(Number.isFinite));
  source.scale.multiplyScalar(Number.isFinite(uniformScale) ? uniformScale : 1);
  source.updateMatrixWorld(true);
  const scaledBounds = new THREE.Box3().setFromObject(source);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  source.position.x -= center.x;
  source.position.y -= scaledBounds.min.y;
  source.position.z -= center.z;
  source.updateMatrixWorld(true);
  return normalized;
};

const loadAsset = (definition: PropAssetDefinition): Promise<THREE.Group> => {
  const cached = normalizedAssetCache.get(definition.id);
  if (cached) return cached;
  const promise = (async (): Promise<THREE.Group> => {
    if (definition.format === 'obj') {
      const [object, texture] = await Promise.all([
        objLoader.loadAsync(definition.path),
        definition.texturePath
          ? textureLoader.loadAsync(definition.texturePath)
          : Promise.resolve<THREE.Texture | null>(null),
      ]);
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
      }
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: texture,
          roughness: 0.82,
          metalness: 0.08,
        });
      });
      return normalizeAsset(object, definition);
    }
    const loaded = await gltfLoader.loadAsync(definition.path);
    return normalizeAsset(loaded.scene, definition);
  })().catch((error: unknown) => {
    if (!failedAssets.has(definition.id)) {
      failedAssets.add(definition.id);
      console.warn(`Unable to load decorative prop "${definition.id}".`, error);
    }
    throw error;
  });
  normalizedAssetCache.set(definition.id, promise);
  return promise;
};

const cloneMaterial = (
  source: THREE.Material,
  tone: number,
  biome: VisualBiome,
): THREE.Material => {
  const material = source.clone();
  const colored = material as THREE.Material & { color?: THREE.Color };
  if (colored.color instanceof THREE.Color) {
    const biomeTone = biome === 'red' ? 0.82 : biome === 'white' ? 0.94 : 0.9;
    colored.color.multiplyScalar(tone * biomeTone);
  }
  if (material instanceof THREE.MeshStandardMaterial) {
    material.roughness = Math.max(0.68, material.roughness);
    material.emissive.copy(material.color).multiplyScalar(biome === 'red' ? 0.018 : 0.025);
    material.emissiveIntensity = 1;
  }
  return material;
};

const cloneAsset = (
  source: THREE.Group,
  placement: PropPlacement,
  biome: VisualBiome,
): THREE.Group => {
  const instance = source.clone(true);
  instance.name = `prop-model-${placement.assetId}`;
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry = child.geometry.clone();
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => cloneMaterial(material, placement.tone, biome))
      : cloneMaterial(child.material, placement.tone, biome);
    child.castShadow = false;
    child.receiveShadow = false;
  });
  instance.scale.setScalar(placement.scale);
  instance.rotation.y = placement.rotationY;
  instance.position.set(
    placement.position.x,
    placement.position.y + 0.006,
    placement.position.z,
  );
  instance.updateMatrixWorld(true);
  return instance;
};

const disposeObject = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
};

export class WorldPropLayer {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private disposed = false;

  constructor(plan: WorldPlan) {
    this.group.name = 'rare-decorative-props';
    const biome = plan.visualBiome ?? 'yellow';
    this.ready = Promise.all(
      (plan.propPlacements ?? []).map(async (placement) => {
        try {
          const source = await loadAsset(getPropAsset(placement.assetId));
          const instance = cloneAsset(source, placement, biome);
          if (this.disposed) {
            disposeObject(instance);
            return;
          }
          this.group.add(instance);
        } catch {
          // A missing optional decoration must never prevent a chunk mounting.
        }
      }),
    ).then(() => undefined);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeObject(this.group);
    this.group.clear();
    this.group.removeFromParent();
  }
}
