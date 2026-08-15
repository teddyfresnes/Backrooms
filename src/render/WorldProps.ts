import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getPropAsset } from '../world/PropCatalog';
import type { PropAssetDefinition } from '../world/PropCatalog';
import type { PropPlacement, VisualBiome, WorldPlan } from '../world/types';
import { applyZonalLighting, createZonalLightingContext } from './ZonalLighting';
import type { ZonalLightingContext } from './ZonalLighting';

const gltfLoader = new GLTFLoader();
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
    const loaded = await gltfLoader.loadAsync(definition.path);
    loaded.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        for (const texture of [
          material.map,
          material.aoMap,
          material.metalnessMap,
          material.normalMap,
          material.roughnessMap,
        ]) {
          if (texture) texture.anisotropy = Math.max(texture.anisotropy, 4);
        }
      }
      child.castShadow = false;
      child.receiveShadow = false;
    });
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
  lighting: ZonalLightingContext | null,
): THREE.Material => {
  const material = source.clone();
  const colored = material as THREE.Material & { color?: THREE.Color };
  if (colored.color instanceof THREE.Color) {
    const biomeTone = biome === 'red' ? 0.88 : biome === 'white' ? 1 : 0.96;
    colored.color.multiplyScalar(tone * biomeTone);
  }
  if (lighting && (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshBasicMaterial
  )) applyZonalLighting(material, lighting);
  return material;
};

const cloneAsset = (
  source: THREE.Group,
  placement: PropPlacement,
  biome: VisualBiome,
  lighting: ZonalLightingContext | null,
): THREE.Group => {
  const instance = source.clone(true);
  instance.name = `prop-model-${placement.assetId}`;
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => cloneMaterial(material, placement.tone, biome, lighting))
      : cloneMaterial(child.material, placement.tone, biome, lighting);
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
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
};

export class WorldPropLayer {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private disposed = false;

  constructor(
    plan: WorldPlan,
    lighting: ZonalLightingContext | null = createZonalLightingContext(plan),
  ) {
    this.group.name = 'rare-decorative-props';
    const biome = plan.visualBiome ?? 'yellow';
    this.ready = Promise.all(
      (plan.propPlacements ?? []).map(async (placement) => {
        try {
          const source = await loadAsset(getPropAsset(placement.assetId));
          const instance = cloneAsset(source, placement, biome, lighting);
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
