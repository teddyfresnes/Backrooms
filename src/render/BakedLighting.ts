import * as THREE from 'three';
import type { MaterialSet } from './MaterialLibrary';
import type { Rect, WorldPlan } from '../world/types';

const LIGHTMAP_RESOLUTION = 128;
const LIGHTMAP_UV_CHANNEL = 1;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const roomClip = (
  context: CanvasRenderingContext2D,
  bounds: Rect,
  worldSize: number,
): void => {
  const scale = LIGHTMAP_RESOLUTION / worldSize;
  const half = worldSize * 0.5;
  const left = (bounds.minX + half) * scale;
  const top = LIGHTMAP_RESOLUTION - (bounds.maxZ + half) * scale;
  context.beginPath();
  context.rect(
    left,
    top,
    Math.max(1, (bounds.maxX - bounds.minX) * scale),
    Math.max(1, (bounds.maxZ - bounds.minZ) * scale),
  );
  context.clip();
};

/**
 * Produces a tiny per-chunk diffuse light field. It is intentionally static:
 * fluorescent pools stay attached to their fixtures and never pop around the
 * player as the infinite world streams.
 */
export const createBakedLightMap = (plan: WorldPlan): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = LIGHTMAP_RESOLUTION;
  canvas.height = LIGHTMAP_RESOLUTION;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable for baked lighting.');

  // A little indirect energy remains in unlit corners, but it is low enough
  // for the geometry and screen-space occlusion to retain their depth.
  context.fillStyle = 'rgb(10, 9, 5)';
  context.fillRect(0, 0, LIGHTMAP_RESOLUTION, LIGHTMAP_RESOLUTION);

  const scale = LIGHTMAP_RESOLUTION / plan.size;
  const half = plan.size * 0.5;
  const rooms = new Map(plan.rooms.map((room) => [room.id, room.bounds]));

  for (const light of plan.lights) {
    if (light.dead || light.level < 0) continue;
    const x = (light.x + half) * scale;
    const y = LIGHTMAP_RESOLUTION - (light.z + half) * scale;
    const room = rooms.get(light.roomId);
    const roomSpan = room
      ? Math.max(room.maxX - room.minX, room.maxZ - room.minZ)
      : 15;
    const radiusMeters = THREE.MathUtils.clamp(roomSpan * 0.55, 6.5, 12.5);
    const radius = radiusMeters * scale;
    const energy = THREE.MathUtils.clamp(light.intensity, 0.8, 1.55);
    const color = new THREE.Color(light.color);
    const red = Math.round(clamp01(color.r * 1.08) * 255);
    const green = Math.round(clamp01(color.g * 0.96) * 255);
    const blue = Math.round(clamp01(color.b * 0.72) * 255);

    context.save();
    if (room) roomClip(context, room, plan.size);
    context.globalCompositeOperation = 'lighter';
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${0.24 * energy})`);
    gradient.addColorStop(0.16, `rgba(${red}, ${green}, ${blue}, ${0.16 * energy})`);
    gradient.addColorStop(0.54, `rgba(178, 144, 76, ${0.055 * energy})`);
    gradient.addColorStop(1, 'rgba(34, 25, 12, 0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    context.restore();
  }

  // A broad, soft occlusion line grounds walls and columns without requiring
  // hundreds of real-time shadow-casting lights.
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = 'rgba(5, 4, 2, 0.25)';
  context.lineCap = 'square';
  context.lineWidth = Math.max(1.1, scale * 0.72);
  context.shadowColor = 'rgba(2, 2, 1, 0.5)';
  context.shadowBlur = Math.max(1.4, scale * 1.35);
  for (const wall of plan.walls) {
    if (wall.bottom < -1) continue;
    const halfLength = wall.length * 0.5;
    context.beginPath();
    if (wall.orientation === 'x') {
      context.moveTo((wall.x - halfLength + half) * scale, LIGHTMAP_RESOLUTION - (wall.z + half) * scale);
      context.lineTo((wall.x + halfLength + half) * scale, LIGHTMAP_RESOLUTION - (wall.z + half) * scale);
    } else {
      context.moveTo((wall.x + half) * scale, LIGHTMAP_RESOLUTION - (wall.z - halfLength + half) * scale);
      context.lineTo((wall.x + half) * scale, LIGHTMAP_RESOLUTION - (wall.z + halfLength + half) * scale);
    }
    context.stroke();
  }
  for (const column of plan.columns) {
    const minX = column.x - column.width * 0.5;
    const maxX = column.x + column.width * 0.5;
    const minZ = column.z - column.depth * 0.5;
    const maxZ = column.z + column.depth * 0.5;
    context.strokeRect(
      (minX + half) * scale,
      LIGHTMAP_RESOLUTION - (maxZ + half) * scale,
      (maxX - minX) * scale,
      (maxZ - minZ) * scale,
    );
  }
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `baked-fluorescent-field-${plan.seed}`;
  texture.channel = LIGHTMAP_UV_CHANNEL;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

const withLightMap = <T extends THREE.MeshStandardMaterial>(
  source: T,
  lightMap: THREE.Texture,
  worldSize: number,
  intensity: number,
): T => {
  const material = source.clone() as T;
  material.name = `${source.name}-baked`;
  material.lightMap = lightMap;
  material.lightMapIntensity = intensity;
  material.userData.bakedLightMapWorldSize = worldSize;
  material.needsUpdate = true;
  return material;
};

export interface BakedMaterialSet {
  materials: MaterialSet;
  ownedMaterials: THREE.MeshStandardMaterial[];
}

export const createBakedMaterialSet = (
  source: MaterialSet,
  lightMap: THREE.Texture,
  worldSize: number,
): BakedMaterialSet => {
  const wall = withLightMap(source.wall, lightMap, worldSize, 0.9);
  const plaster = withLightMap(source.plaster, lightMap, worldSize, 0.82);
  // The carpet receives less direct energy than vertical surfaces. This keeps
  // it visibly light without bringing back the old glowing-floor look.
  const floor = withLightMap(source.floor, lightMap, worldSize, 0.58);
  const ceiling = withLightMap(source.ceiling, lightMap, worldSize, 0.42);
  const baseboard = withLightMap(source.baseboard, lightMap, worldSize, 0.72);
  const pitWall = withLightMap(source.pitWall, lightMap, worldSize, 0.48);
  const pitBottom = withLightMap(source.pitBottom, lightMap, worldSize, 0.12);
  const metal = withLightMap(source.metal, lightMap, worldSize, 0.38);
  const fixtureFrame = withLightMap(source.fixtureFrame, lightMap, worldSize, 0.72);
  const ownedMaterials = [
    wall,
    plaster,
    floor,
    ceiling,
    baseboard,
    pitWall,
    pitBottom,
    metal,
    fixtureFrame,
  ];
  return {
    materials: {
      ...source,
      wall,
      plaster,
      floor,
      ceiling,
      baseboard,
      pitWall,
      pitBottom,
      metal,
      fixtureFrame,
    },
    ownedMaterials,
  };
};

export const ensureBakedLightUv = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): void => {
  if (!(material instanceof THREE.MeshStandardMaterial) || material.lightMap === null) return;
  if (geometry.hasAttribute('uv1')) return;
  const worldSize = material.userData.bakedLightMapWorldSize;
  if (typeof worldSize !== 'number' || !Number.isFinite(worldSize) || worldSize <= 0) return;
  const position = geometry.getAttribute('position');
  const values = new Float32Array(position.count * 2);
  const half = worldSize * 0.5;
  for (let index = 0; index < position.count; index += 1) {
    values[index * 2] = clamp01((position.getX(index) + half) / worldSize);
    values[index * 2 + 1] = clamp01((position.getZ(index) + half) / worldSize);
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(values, 2));
};
