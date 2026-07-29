import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type {
  DoorOpenMode,
  InteractiveDoorFeature,
  WorldPlan,
} from '../world/types';

const ASSET_URL =
  '/assets/models/doors/kenney-modern-office-door/modern-office-door.glb';
const SOURCE_HEIGHT = 2.1;
const HINGE_INSET = 0.025;
const OPEN_SWING = THREE.MathUtils.degToRad(86);
const PASSABLE_PROGRESS = 0.36;

interface DoorRuntime {
  feature: InteractiveDoorFeature;
  pivot?: THREE.Group;
  closedRotation: number;
  swingSign: -1 | 1;
  progress: number;
  startProgress: number;
  targetProgress: number;
  elapsed: number;
  duration: number;
  colliderReleased: boolean;
}

export interface DoorInteractionCandidate {
  doorId: string;
  colliderId: string;
  label: string;
}

const gltfLoader = new GLTFLoader();
let templatePromise: Promise<THREE.Group> | undefined;

const officeLeafMaterial = (source: THREE.Material): THREE.Material => {
  if (!(source instanceof THREE.MeshStandardMaterial)) return source.clone();
  const material = source.clone();
  material.name = 'muted-office-laminate';
  material.color.setHex(0xb19a70);
  material.metalness = 0.02;
  material.roughness = 0.76;
  if (material.map) material.map.anisotropy = 4;
  return material;
};

const loadDoorTemplate = (): Promise<THREE.Group> => {
  templatePromise ??= gltfLoader.loadAsync(ASSET_URL).then((gltf) => {
    const source = gltf.scene;
    const leaf = source.getObjectByName('door');
    if (!leaf) {
      throw new Error('The office door asset must contain a door hinge node.');
    }
    source.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.name === 'door') {
        child.material = officeLeafMaterial(
          Array.isArray(child.material) ? child.material[0] : child.material,
        );
      } else if (child.name === 'handle') {
        child.material = new THREE.MeshStandardMaterial({
          name: 'brushed-office-door-hardware',
          color: 0x65686b,
          metalness: 0.82,
          roughness: 0.34,
        });
      } else if (child.name === '(%ignore)') {
        child.material = new THREE.MeshStandardMaterial({
          name: 'dirty-frosted-door-glass',
          color: 0x4d514c,
          metalness: 0.05,
          roughness: 0.38,
        });
      } else {
        child.material = Array.isArray(child.material)
          ? child.material.map((material) => material.clone())
          : child.material.clone();
      }
      child.castShadow = false;
      child.receiveShadow = false;
    });

    const template = new THREE.Group();
    template.name = 'kenney-modern-office-door-template';
    template.add(source);
    return template;
  });
  return templatePromise;
};

const cloneDoorTemplate = (source: THREE.Group): THREE.Group => {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry = child.geometry.clone();
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
  return clone;
};

const disposeDoorObject = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
};

export class WorldDoorLayer {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private readonly runtimes = new Map<string, DoorRuntime>();
  private readonly passableColliderIds: string[] = [];
  private disposed = false;

  constructor(plan: WorldPlan) {
    this.group.name = 'interactive-office-doors';
    const features = plan.features.filter(
      (feature): feature is InteractiveDoorFeature => feature.kind === 'interactive-door',
    );
    for (const feature of features) {
      this.runtimes.set(feature.id, {
        feature,
        closedRotation: feature.orientation === 'x' ? Math.PI * 0.5 : 0,
        swingSign: feature.orientation === 'x'
          ? (feature.openingDirection * -1) as -1 | 1
          : feature.openingDirection,
        progress: 0,
        startProgress: 0,
        targetProgress: 0,
        elapsed: 0,
        duration: 0.5,
        colliderReleased: false,
      });
    }
    if (features.length === 0 || typeof document === 'undefined') {
      this.ready = Promise.resolve();
      return;
    }
    this.ready = loadDoorTemplate()
      .then((template) => {
        for (const runtime of this.runtimes.values()) {
          const instance = cloneDoorTemplate(template);
          if (this.disposed) {
            disposeDoorObject(instance);
            continue;
          }
          instance.name = `interactive-door-model-${runtime.feature.id}`;
          const scale = runtime.feature.height / SOURCE_HEIGHT;
          const hingeAlong = runtime.feature.width * -0.5 + HINGE_INSET * scale;
          instance.position.set(
            runtime.feature.position.x +
              (runtime.feature.orientation === 'x' ? hingeAlong : 0),
            runtime.feature.position.y,
            runtime.feature.position.z +
              (runtime.feature.orientation === 'z' ? hingeAlong : 0),
          );
          instance.rotation.y = runtime.closedRotation;
          instance.scale.setScalar(scale);
          runtime.pivot = instance;
          this.group.add(instance);
        }
      })
      .catch((error: unknown) => {
        console.warn('Unable to load the interactive office door asset.', error);
      });
  }

  getInteraction(
    playerPosition: THREE.Vector3,
    lookDirection: THREE.Vector3,
  ): DoorInteractionCandidate | null {
    let nearest: { runtime: DoorRuntime; distance: number } | undefined;
    for (const runtime of this.runtimes.values()) {
      if (runtime.targetProgress > 0 || runtime.progress > 0.015) continue;
      const target = new THREE.Vector3(
        runtime.feature.position.x,
        runtime.feature.position.y + Math.min(1.18, runtime.feature.height * 0.52),
        runtime.feature.position.z,
      );
      const distance = target.distanceTo(playerPosition);
      if (distance > 2.35) continue;
      const towardDoor = target.sub(playerPosition).normalize();
      if (lookDirection.dot(towardDoor) < 0.76) continue;
      if (!nearest || distance < nearest.distance) nearest = { runtime, distance };
    }
    if (!nearest) return null;
    return {
      doorId: nearest.runtime.feature.id,
      colliderId: nearest.runtime.feature.colliderId,
      label: 'PRESS E TO OPEN  /  HOLD E TO OPEN SLOWLY',
    };
  }

  open(doorId: string, mode: DoorOpenMode): string | null {
    const runtime = this.runtimes.get(doorId);
    if (!runtime || runtime.targetProgress > 0 || runtime.progress > 0.015) return null;
    runtime.startProgress = runtime.progress;
    runtime.targetProgress = 1;
    runtime.elapsed = 0;
    runtime.duration = mode === 'slow' ? 2 : 0.52;
    return runtime.feature.colliderId;
  }

  update(delta: number): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.progress === runtime.targetProgress) continue;
      runtime.elapsed = Math.min(runtime.duration, runtime.elapsed + Math.max(0, delta));
      const linear = runtime.elapsed / Math.max(1e-5, runtime.duration);
      const eased = linear * linear * (3 - 2 * linear);
      runtime.progress = THREE.MathUtils.lerp(
        runtime.startProgress,
        runtime.targetProgress,
        eased,
      );
      if (!runtime.colliderReleased && runtime.progress >= PASSABLE_PROGRESS) {
        runtime.colliderReleased = true;
        this.passableColliderIds.push(runtime.feature.colliderId);
      }
      if (runtime.pivot) {
        runtime.pivot.rotation.y = runtime.closedRotation +
          runtime.swingSign * OPEN_SWING * runtime.progress;
      }
    }
  }

  getOpenProgress(doorId: string): number | undefined {
    return this.runtimes.get(doorId)?.progress;
  }

  consumePassableColliderIds(): string[] {
    return this.passableColliderIds.splice(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeDoorObject(this.group);
    this.group.clear();
    this.group.removeFromParent();
    this.runtimes.clear();
    this.passableColliderIds.length = 0;
  }
}
