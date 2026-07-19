import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildBakedLightField, ensureBakedLightUv } from './BakedLighting';
import type { LightSlot, RoomRecord, WallSegment, WorldPlan } from '../world/types';

const RESOLUTION = 80;
const ROOM: RoomRecord = {
  id: 'room-a',
  bounds: { minX: -8, minZ: -8, maxX: 8, maxZ: 8 },
  kind: 'office',
  level: 0,
  ceilingHeight: 2.75,
  detailDensity: 0,
};

const light = (roomId = ROOM.id): LightSlot => ({
  id: `light-${roomId}`,
  x: 5,
  ceilingY: 2.75,
  z: 5,
  rotation: 0,
  width: 1.55,
  intensity: 1.08,
  color: 0xfff4cf,
  dead: false,
  unstable: false,
  phase: 0,
  roomId,
  level: 0,
});

const wall = (
  id: string,
  x: number,
  z: number,
  length: number,
  orientation: 'x' | 'z',
): WallSegment => ({
  id,
  x,
  z,
  length,
  orientation,
  bottom: 0,
  height: 2.75,
  thickness: 0.22,
  tint: 1,
  collision: true,
  kind: 'wallpaper',
});

const plan = (
  rooms: RoomRecord[],
  lights: LightSlot[],
  walls: WallSegment[] = [],
): WorldPlan => ({
  version: 1,
  seed: 'BAKED-LIGHT-TEST',
  size: 20,
  wallHeight: 2.75,
  rooms,
  walls,
  columns: [],
  solidMasses: [],
  lights,
  missingCeilingTiles: [],
  features: [],
  detailSockets: [],
  colliders: [],
  floorRects: rooms.map((room) => room.bounds),
  spawn: { x: 0, y: 0, z: 0 },
});

const sample = (field: Float32Array, x: number, z: number): number => {
  const worldSize = 20;
  const half = worldSize * 0.5;
  const scale = RESOLUTION / worldSize;
  const pixelX = Math.min(RESOLUTION - 1, Math.max(0, Math.floor((x + half) * scale)));
  const pixelY = Math.min(RESOLUTION - 1, Math.max(0, Math.floor((half - z) * scale)));
  const index = (pixelY * RESOLUTION + pixelX) * 3;
  return (
    field[index]! * 0.2126 +
    field[index + 1]! * 0.7152 +
    field[index + 2]! * 0.0722
  );
};

describe('baked fluorescent field', () => {
  it('keeps a corner beside a live fixture illuminated', () => {
    const outerWalls = [
      wall('north', 0, -8, 16, 'x'),
      wall('south', 0, 8, 16, 'x'),
      wall('west', -8, 0, 16, 'z'),
      wall('east', 8, 0, 16, 'z'),
    ];
    const field = buildBakedLightField(plan([ROOM], [light()], outerWalls), RESOLUTION);

    expect(sample(field, 7.25, 7.25)).toBeGreaterThan(0.2);
  });

  it('fully blocks direct light through a solid partition', () => {
    const left: RoomRecord = { ...ROOM, id: 'left', bounds: { minX: -9, minZ: -8, maxX: -0.15, maxZ: 8 } };
    const right: RoomRecord = { ...ROOM, id: 'right', bounds: { minX: 0.15, minZ: -8, maxX: 9, maxZ: 8 } };
    const source = { ...light(left.id), x: -4, z: 0 };
    const field = buildBakedLightField(
      plan([left, right], [source], [wall('divider', 0, 0, 16, 'z')]),
      RESOLUTION,
    );

    const litSide = sample(field, -2, 0);
    const blockedSide = sample(field, 2, 0);
    expect(litSide).toBeGreaterThan(0.2);
    expect(blockedSide).toBeLessThan(0.02);
    expect(blockedSide).toBeLessThan(litSide * 0.1);
  });

  it('lets neighbouring light diffuse through an actual doorway', () => {
    const left: RoomRecord = { ...ROOM, id: 'left', bounds: { minX: -9, minZ: -8, maxX: -0.15, maxZ: 8 } };
    const right: RoomRecord = { ...ROOM, id: 'right', bounds: { minX: 0.15, minZ: -8, maxX: 9, maxZ: 8 } };
    const source = { ...light(left.id), x: -4, z: 0 };
    const doorwayWalls = [
      wall('divider-north', 0, -4.75, 6.5, 'z'),
      wall('divider-south', 0, 4.75, 6.5, 'z'),
    ];
    const field = buildBakedLightField(plan([left, right], [source], doorwayWalls), RESOLUTION);

    expect(sample(field, 2, 0)).toBeGreaterThan(0.04);
    expect(sample(field, 2, 5)).toBeLessThan(0.02);
  });

  it('does not count the same fixture twice in overlapping room bounds', () => {
    const overlap: RoomRecord = { ...ROOM, id: 'room-b' };
    const source = light();
    const single = buildBakedLightField(plan([ROOM], [source]), RESOLUTION);
    const doubled = buildBakedLightField(plan([ROOM, overlap], [source]), RESOLUTION);

    expect(sample(doubled, 5, 5)).toBeCloseTo(sample(single, 5, 5), 5);
  });

  it('samples opposite wall faces from opposite rooms', () => {
    const geometry = new THREE.BoxGeometry(10, 2.75, 0.22);
    const material = new THREE.MeshStandardMaterial();
    material.lightMap = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    material.userData.bakedLightMapWorldSize = 20;
    material.userData.bakedLightMapSurfaceOffset = 0.7;

    ensureBakedLightUv(geometry, material, 0.56);

    const normals = geometry.getAttribute('normal');
    const lightUv = geometry.getAttribute('uv1');
    const positiveFace = Array.from({ length: normals.count }, (_, index) => index)
      .filter((index) => normals.getZ(index) > 0.5)
      .map((index) => lightUv.getY(index));
    const negativeFace = Array.from({ length: normals.count }, (_, index) => index)
      .filter((index) => normals.getZ(index) < -0.5)
      .map((index) => lightUv.getY(index));

    expect(Math.min(...positiveFace)).toBeGreaterThan(Math.max(...negativeFace));
  });

  it('pulls wall-face endpoints away from perpendicular partitions', () => {
    const geometry = new THREE.BoxGeometry(10, 2.75, 0.22);
    const material = new THREE.MeshStandardMaterial();
    material.lightMap = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    material.userData.bakedLightMapWorldSize = 20;
    material.userData.bakedLightMapSurfaceOffset = 0.7;

    ensureBakedLightUv(geometry, material, 0.56);

    const normals = geometry.getAttribute('normal');
    const lightUv = geometry.getAttribute('uv1');
    const sideFaceU = Array.from({ length: normals.count }, (_, index) => index)
      .filter((index) => Math.abs(normals.getZ(index)) > 0.5)
      .map((index) => lightUv.getX(index));
    const expectedMaximum = (5 - 0.56 + 10) / 20;

    expect(Math.max(...sideFaceU)).toBeCloseTo(expectedMaximum, 5);
  });
});
