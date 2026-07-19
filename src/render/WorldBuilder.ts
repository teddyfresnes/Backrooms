import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialSet } from './MaterialLibrary';
import type { RuntimeLightSource } from './LocalLightRig';
import {
  createBakedLightMap,
  createBakedMaterialSet,
  ensureBakedLightUv,
} from './BakedLighting';
import type {
  GridPitFeature,
  LightSlot,
  Rect,
  StairSocketFeature,
  Vec3Data,
  VistaFeature,
  WallSegment,
  WorldPlan,
  RoomKind,
} from '../world/types';
import { pointInRect, rectCenter, rectDepth, rectWidth } from '../world/types';

const setGeometryTint = (geometry: THREE.BufferGeometry, tint: number): void => {
  const count = geometry.getAttribute('position').count;
  const color = new THREE.Color().setRGB(tint, tint, tint);
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = color.r;
    values[index * 3 + 1] = color.g;
    values[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
};

const createWallGeometry = (wall: WallSegment): THREE.BoxGeometry => {
  const alongX = wall.orientation === 'x';
  const geometry = new THREE.BoxGeometry(
    alongX ? wall.length : wall.thickness,
    wall.height,
    alongX ? wall.thickness : wall.length,
  );
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const uScale = Math.max(0.24, wall.length / 2.05);
  const vScale = Math.max(0.2, wall.height / 2.45);
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * uScale, uv.getY(index) * vScale);
  }
  geometry.translate(wall.x, wall.bottom + wall.height * 0.5, wall.z);
  setGeometryTint(geometry, wall.tint);
  return geometry;
};

const createTexturedBoxGeometry = (
  width: number,
  height: number,
  depth: number,
  x: number,
  bottom: number,
  z: number,
  tint = 1,
): THREE.BoxGeometry => {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const faceScales: Array<[number, number]> = [
    [depth / 2.05, height / 2.45],
    [depth / 2.05, height / 2.45],
    [width / 2.05, depth / 2.05],
    [width / 2.05, depth / 2.05],
    [width / 2.05, height / 2.45],
    [width / 2.05, height / 2.45],
  ];
  for (let face = 0; face < 6; face += 1) {
    const [uScale, vScale] = faceScales[face]!;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = face * 4 + vertex;
      uv.setXY(index, uv.getX(index) * uScale, uv.getY(index) * vScale);
    }
  }
  geometry.translate(x, bottom + height * 0.5, z);
  setGeometryTint(geometry, tint);
  return geometry;
};

const createFloorGeometry = (rects: Rect[], y = 0): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const rect of rects) {
    const offset = positions.length / 3;
    positions.push(
      rect.minX, y, rect.minZ,
      rect.maxX, y, rect.minZ,
      rect.maxX, y, rect.maxZ,
      rect.minX, y, rect.maxZ,
    );
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uvs.push(
      rect.minX / 2.15, rect.minZ / 2.15,
      rect.maxX / 2.15, rect.minZ / 2.15,
      rect.maxX / 2.15, rect.maxZ / 2.15,
      rect.minX / 2.15, rect.maxZ / 2.15,
    );
    indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const createCeilingGeometry = (rect: Rect, y: number): THREE.PlaneGeometry => {
  const width = rectWidth(rect);
  const depth = rectDepth(rect);
  const center = rectCenter(rect);
  const geometry = new THREE.PlaneGeometry(width, depth);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * (width / 2.4), uv.getY(index) * (depth / 2.4));
  }
  geometry.rotateX(Math.PI * 0.5);
  geometry.translate(center.x, y, center.z);
  return geometry;
};

const cellsAroundHoles = (bounds: Rect, holes: Rect[]): Rect[] => {
  const xValues = [...new Set([bounds.minX, bounds.maxX, ...holes.flatMap((hole) => [hole.minX, hole.maxX])])].sort(
    (a, b) => a - b,
  );
  const zValues = [...new Set([bounds.minZ, bounds.maxZ, ...holes.flatMap((hole) => [hole.minZ, hole.maxZ])])].sort(
    (a, b) => a - b,
  );
  const cells: Rect[] = [];
  for (let xIndex = 0; xIndex < xValues.length - 1; xIndex += 1) {
    for (let zIndex = 0; zIndex < zValues.length - 1; zIndex += 1) {
      const cell: Rect = {
        minX: xValues[xIndex]!,
        maxX: xValues[xIndex + 1]!,
        minZ: zValues[zIndex]!,
        maxZ: zValues[zIndex + 1]!,
      };
      const center = rectCenter(cell);
      if (!holes.some((hole) => pointInRect(center.x, center.z, hole))) cells.push(cell);
    }
  }
  return cells;
};

const mergeOrSingle = (geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0]!;
  return mergeGeometries(geometries, false);
};

const makeMesh = (
  geometry: THREE.BufferGeometry | null,
  material: THREE.Material,
  name: string,
  parent: THREE.Object3D,
): THREE.Mesh | null => {
  if (!geometry) return null;
  ensureBakedLightUv(geometry, material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  parent.add(mesh);
  return mesh;
};

export interface WorldViewOptions {
  createLightRig?: boolean;
}

export interface WorldInteraction {
  label: string;
  path: Vec3Data[];
  duration: number;
  duckDepth: number;
}

export class WorldView {
  readonly group = new THREE.Group();
  private readonly emitterMesh: THREE.InstancedMesh;
  private readonly fixtureSlots: LightSlot[];
  private readonly materials: MaterialSet;
  private readonly bakedLightMap: THREE.CanvasTexture;
  private readonly ownedMaterials: THREE.MeshStandardMaterial[];

  constructor(
    readonly plan: WorldPlan,
    sourceMaterials: MaterialSet,
    options: WorldViewOptions = {},
  ) {
    this.group.name = `world-${plan.seed}`;
    this.bakedLightMap = createBakedLightMap(plan);
    const baked = createBakedMaterialSet(sourceMaterials, this.bakedLightMap, plan.size);
    this.materials = baked.materials;
    this.ownedMaterials = baked.ownedMaterials;
    this.fixtureSlots = plan.lights;
    this.buildArchitecture();
    this.emitterMesh = this.buildFixtures();
    this.buildPitFeatures();
    this.buildStairs();
    this.buildCeilingDamage();
    this.buildImpossibleVista();
    void options;
  }

  private buildArchitecture(): void {
    const wallGeometries: THREE.BufferGeometry[] = [];
    const plasterGeometries: THREE.BufferGeometry[] = [];
    const baseboardGeometries: THREE.BufferGeometry[] = [];
    for (const wall of this.plan.walls) {
      const geometry = createWallGeometry(wall);
      const wallMaterial = wall.kind === 'plaster' ? this.materials.plaster : this.materials.wall;
      ensureBakedLightUv(geometry, wallMaterial, 0.56);
      (wall.kind === 'plaster' ? plasterGeometries : wallGeometries).push(geometry);

      if (wall.height > 1.3) {
        const alongX = wall.orientation === 'x';
        const trim = new THREE.BoxGeometry(
          alongX ? wall.length + 0.025 : wall.thickness + 0.055,
          0.115,
          alongX ? wall.thickness + 0.055 : wall.length + 0.025,
        );
        trim.translate(wall.x, wall.bottom + 0.0575, wall.z);
        ensureBakedLightUv(trim, this.materials.baseboard, 0.48);
        baseboardGeometries.push(trim);
      }
    }

    for (const column of this.plan.columns) {
      const geometry = createTexturedBoxGeometry(
        column.width,
        column.height,
        column.depth,
        column.x,
        0,
        column.z,
        column.tint,
      );
      ensureBakedLightUv(geometry, this.materials.wall, 0.44);
      wallGeometries.push(geometry);
      const trim = new THREE.BoxGeometry(column.width + 0.055, 0.115, column.depth + 0.055);
      trim.translate(column.x, 0.0575, column.z);
      ensureBakedLightUv(trim, this.materials.baseboard, 0.38);
      baseboardGeometries.push(trim);
    }

    for (const mass of this.plan.solidMasses) {
      const width = rectWidth(mass.bounds);
      const depth = rectDepth(mass.bounds);
      const center = rectCenter(mass.bounds);
      const massGeometry = createTexturedBoxGeometry(
        width,
        mass.height,
        depth,
        center.x,
        0,
        center.z,
        mass.tint,
      );
      ensureBakedLightUv(massGeometry, this.materials.wall, 0.48);
      wallGeometries.push(massGeometry);
      const trimHeight = 0.115;
      const massTrims = [
        new THREE.BoxGeometry(width + 0.055, trimHeight, 0.09).translate(
          center.x,
          trimHeight * 0.5,
          mass.bounds.minZ,
        ),
        new THREE.BoxGeometry(width + 0.055, trimHeight, 0.09).translate(
          center.x,
          trimHeight * 0.5,
          mass.bounds.maxZ,
        ),
        new THREE.BoxGeometry(0.09, trimHeight, depth).translate(
          mass.bounds.minX,
          trimHeight * 0.5,
          center.z,
        ),
        new THREE.BoxGeometry(0.09, trimHeight, depth).translate(
          mass.bounds.maxX,
          trimHeight * 0.5,
          center.z,
        ),
      ];
      for (const trim of massTrims) ensureBakedLightUv(trim, this.materials.baseboard, 0.4);
      baseboardGeometries.push(...massTrims);
    }

    makeMesh(mergeOrSingle(wallGeometries), this.materials.wall, 'merged-wallpaper-walls', this.group);
    makeMesh(mergeOrSingle(plasterGeometries), this.materials.plaster, 'merged-plaster-walls', this.group);
    makeMesh(mergeOrSingle(baseboardGeometries), this.materials.baseboard, 'merged-baseboards', this.group);

    const floorGeometry = createFloorGeometry(this.plan.floorRects);
    ensureBakedLightUv(floorGeometry, this.materials.floor);
    const floor = new THREE.Mesh(floorGeometry, this.materials.floor);
    floor.name = 'continuous-carpet-floor';
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    this.group.add(floor);

    const ceiling = new THREE.PlaneGeometry(this.plan.size, this.plan.size, 1, 1);
    const uv = ceiling.getAttribute('uv') as THREE.BufferAttribute;
    const repeat = this.plan.size / 2.4;
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(index, uv.getX(index) * repeat, uv.getY(index) * repeat);
    }
    ceiling.rotateX(Math.PI * 0.5);
    ceiling.translate(0, this.plan.wallHeight, 0);
    makeMesh(ceiling, this.materials.ceiling, 'office-drop-ceiling', this.group);
  }

  private buildFixtures(): THREE.InstancedMesh {
    const emitterGeometry = new THREE.PlaneGeometry(2.24, 1.16);
    emitterGeometry.rotateX(Math.PI * 0.5);
    const emitters = new THREE.InstancedMesh(emitterGeometry, this.materials.fixtureGlow, this.fixtureSlots.length);
    emitters.name = 'instanced-luminous-ceiling-tiles';
    emitters.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    emitters.renderOrder = 12;
    emitters.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    this.fixtureSlots.forEach((slot, index) => {
      quaternion.setFromAxisAngle(axis, slot.rotation);
      position.set(slot.x, slot.ceilingY - 0.036, slot.z);
      // A dead slot represents a missing fluorescent panel, not a bright
      // white rectangle that merely stopped contributing to the lightmap.
      scale.set(
        slot.dead ? 0 : slot.width / 2.24,
        slot.dead ? 0 : 1,
        slot.dead ? 0 : slot.width > 1.65 ? 1.08 : 0.86,
      );
      matrix.compose(position, quaternion, scale);
      emitters.setMatrixAt(index, matrix);
    });
    emitters.instanceMatrix.needsUpdate = true;
    emitters.computeBoundingSphere();
    this.group.add(emitters);
    return emitters;
  }

  private buildPitFeatures(): void {
    const features = this.plan.features.filter((feature): feature is GridPitFeature => feature.kind === 'grid-pit');
    const sideGeometries: THREE.BufferGeometry[] = [];
    const abyssSideGeometries: THREE.BufferGeometry[] = [];
    const abyssStoreyGeometries: THREE.BufferGeometry[] = [];
    const lowerCeilingGeometries: THREE.BufferGeometry[] = [];
    const ladderGeometries: THREE.BufferGeometry[] = [];
    for (const feature of features) {
      for (const hole of feature.holes) {
        const width = rectWidth(hole);
        const depth = rectDepth(hole);
        const center = rectCenter(hole);
        const sideThickness = 0.055;
        const sideHeight = -feature.lowerCeilingY;
        const walls = [
          createTexturedBoxGeometry(width, sideHeight, sideThickness, center.x, -sideHeight, hole.minZ, 0.72),
          createTexturedBoxGeometry(width, sideHeight, sideThickness, center.x, -sideHeight, hole.maxZ, 0.72),
          createTexturedBoxGeometry(sideThickness, sideHeight, depth, hole.minX, -sideHeight, center.z, 0.72),
          createTexturedBoxGeometry(sideThickness, sideHeight, depth, hole.maxX, -sideHeight, center.z, 0.72),
        ];
        sideGeometries.push(...walls);

        if (hole.kind === 'void') {
          // Keep the shaft well below the death plane so its geometry never
          // visibly ends while the player is falling. Repeated, recessed slab
          // edges make several impossible office storeys readable from above.
          const abyssBottom = -Math.max(54, hole.depth + 10.8);
          const abyssHeight = feature.lowerFloorY - abyssBottom;
          abyssSideGeometries.push(
            createTexturedBoxGeometry(width, abyssHeight, sideThickness, center.x, abyssBottom, hole.minZ, 0.66),
            createTexturedBoxGeometry(width, abyssHeight, sideThickness, center.x, abyssBottom, hole.maxZ, 0.66),
            createTexturedBoxGeometry(sideThickness, abyssHeight, depth, hole.minX, abyssBottom, center.z, 0.66),
            createTexturedBoxGeometry(sideThickness, abyssHeight, depth, hole.maxX, abyssBottom, center.z, 0.66),
          );

          const storeyPitch = 5.4;
          const ledgeDepth = Math.min(0.16, Math.min(width, depth) * 0.035);
          const slabHeight = 0.12;
          for (
            let storeyY = feature.lowerFloorY - storeyPitch;
            storeyY > abyssBottom + storeyPitch * 0.5;
            storeyY -= storeyPitch
          ) {
            abyssStoreyGeometries.push(
              createTexturedBoxGeometry(width, slabHeight, ledgeDepth, center.x, storeyY, hole.minZ + ledgeDepth * 0.5, 0.72),
              createTexturedBoxGeometry(width, slabHeight, ledgeDepth, center.x, storeyY, hole.maxZ - ledgeDepth * 0.5, 0.72),
              createTexturedBoxGeometry(ledgeDepth, slabHeight, Math.max(0.05, depth - ledgeDepth * 2), hole.minX + ledgeDepth * 0.5, storeyY, center.z, 0.72),
              createTexturedBoxGeometry(ledgeDepth, slabHeight, Math.max(0.05, depth - ledgeDepth * 2), hole.maxX - ledgeDepth * 0.5, storeyY, center.z, 0.72),
            );
          }
        }
      }
      const voidHoles = feature.holes.filter((hole) => hole.kind === 'void');
      const lowerFloorGeometry = createFloorGeometry(
        cellsAroundHoles(feature.lowerBounds, voidHoles),
        feature.lowerFloorY,
      );
      ensureBakedLightUv(lowerFloorGeometry, this.materials.floor);
      const lowerFloor = new THREE.Mesh(lowerFloorGeometry, this.materials.floor);
      lowerFloor.name = `lower-carpet-${feature.id}`;
      lowerFloor.matrixAutoUpdate = false;
      lowerFloor.updateMatrix();
      this.group.add(lowerFloor);
      for (const cell of cellsAroundHoles(feature.lowerBounds, feature.holes)) {
        lowerCeilingGeometries.push(createCeilingGeometry(cell, feature.lowerCeilingY));
      }
      const ladderHole = feature.holes
        .filter((hole) => hole.kind !== 'void')
        .sort((a, b) => rectWidth(a) * rectDepth(a) - rectWidth(b) * rectDepth(b))[0];
      if (ladderHole) {
        const ladderCenter = rectCenter(ladderHole);
        const ladderBottom = feature.lowerFloorY + 0.18;
        const ladderTop = -0.18;
        const ladderHeight = ladderTop - ladderBottom;
        const ladderZ = ladderHole.minZ - 0.065;
        ladderGeometries.push(
          new THREE.BoxGeometry(0.055, ladderHeight, 0.065).translate(
            ladderCenter.x - 0.29,
            ladderBottom + ladderHeight * 0.5,
            ladderZ,
          ),
          new THREE.BoxGeometry(0.055, ladderHeight, 0.065).translate(
            ladderCenter.x + 0.29,
            ladderBottom + ladderHeight * 0.5,
            ladderZ,
          ),
        );
        const rungCount = Math.floor(ladderHeight / 0.31);
        for (let rung = 0; rung <= rungCount; rung += 1) {
          ladderGeometries.push(
            new THREE.BoxGeometry(0.64, 0.045, 0.07).translate(
              ladderCenter.x,
              ladderBottom + rung * 0.31,
              ladderZ - 0.018,
            ),
          );
        }
      }
    }
    makeMesh(mergeOrSingle(sideGeometries), this.materials.floor, 'carpet-lined-pit-shafts', this.group);
    makeMesh(mergeOrSingle(abyssSideGeometries), this.materials.floor, 'carpet-lined-abyss-shafts', this.group);
    makeMesh(mergeOrSingle(abyssStoreyGeometries), this.materials.ceiling, 'abyss-storey-edges', this.group);
    makeMesh(
      mergeOrSingle(lowerCeilingGeometries),
      this.materials.ceiling,
      'lower-office-ceiling',
      this.group,
    );
    makeMesh(mergeOrSingle(ladderGeometries), this.materials.fixtureFrame, 'pit-return-ladders', this.group);
  }

  private buildStairs(): void {
    const stairFeatures = this.plan.features.filter(
      (feature): feature is StairSocketFeature => feature.kind === 'stair-socket',
    );
    const geometries: THREE.BufferGeometry[] = [];
    const darkDoorGeometries: THREE.BufferGeometry[] = [];
    const thresholdWallGeometries: THREE.BufferGeometry[] = [];
    for (const stairs of stairFeatures) {
      const center = rectCenter(stairs.bounds);
      const alongX = stairs.heading.startsWith('x');
      const positive = stairs.heading.endsWith('+');
      const count = 8;
      const run = 0.38;
      const rise = 0.18;
      for (let index = 0; index < count; index += 1) {
        const height = rise * (index + 1);
        const offset = (index - (count - 1) * 0.5) * run * (positive ? 1 : -1);
        const geometry = new THREE.BoxGeometry(alongX ? run : 2.25, height, alongX ? 2.25 : run);
        geometry.translate(center.x + (alongX ? offset : 0), height * 0.5, center.z + (alongX ? 0 : offset));
        geometries.push(geometry);
      }
      const endOffset = count * run * 0.5 * (positive ? 1 : -1) + (positive ? 0.55 : -0.55);
      const doorwayWidth = 1.82;
      const sideWidth = 0.34;
      const doorBottom = count * rise - 0.08;
      const doorHeight = 1.12;
      const doorTop = doorBottom + doorHeight;
      const endX = center.x + (alongX ? endOffset : 0);
      const endZ = center.z + (alongX ? 0 : endOffset);
      if (alongX) {
        thresholdWallGeometries.push(
          createTexturedBoxGeometry(0.22, this.plan.wallHeight, sideWidth, endX, 0, center.z - (doorwayWidth + sideWidth) * 0.5, 0.9),
          createTexturedBoxGeometry(0.22, this.plan.wallHeight, sideWidth, endX, 0, center.z + (doorwayWidth + sideWidth) * 0.5, 0.9),
          createTexturedBoxGeometry(0.22, this.plan.wallHeight - doorTop, doorwayWidth, endX, doorTop, center.z, 0.9),
        );
      } else {
        thresholdWallGeometries.push(
          createTexturedBoxGeometry(sideWidth, this.plan.wallHeight, 0.22, center.x - (doorwayWidth + sideWidth) * 0.5, 0, endZ, 0.9),
          createTexturedBoxGeometry(sideWidth, this.plan.wallHeight, 0.22, center.x + (doorwayWidth + sideWidth) * 0.5, 0, endZ, 0.9),
          createTexturedBoxGeometry(doorwayWidth, this.plan.wallHeight - doorTop, 0.22, center.x, doorTop, endZ, 0.9),
        );
      }
      const door = new THREE.PlaneGeometry(doorwayWidth, doorHeight);
      if (alongX) {
        door.rotateY(positive ? -Math.PI * 0.5 : Math.PI * 0.5);
        door.translate(endX + (positive ? 0.116 : -0.116), doorBottom + doorHeight * 0.5, center.z);
      } else {
        if (positive) door.rotateY(Math.PI);
        door.translate(center.x, doorBottom + doorHeight * 0.5, endZ + (positive ? 0.116 : -0.116));
      }
      darkDoorGeometries.push(door);
    }
    makeMesh(mergeOrSingle(geometries), this.materials.plaster, 'liminal-staircases', this.group);
    makeMesh(mergeOrSingle(thresholdWallGeometries), this.materials.wall, 'stair-threshold-walls', this.group);
    makeMesh(mergeOrSingle(darkDoorGeometries), this.materials.void, 'recessed-stair-thresholds', this.group);
  }

  private buildCeilingDamage(): void {
    if (this.plan.missingCeilingTiles.length === 0) return;
    const holeGeometry = new THREE.PlaneGeometry(1.12, 1.12);
    holeGeometry.rotateX(Math.PI * 0.5);
    const holes = new THREE.InstancedMesh(holeGeometry, this.materials.void, this.plan.missingCeilingTiles.length);
    holes.name = 'missing-ceiling-tiles';
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const hangingPanels: THREE.BufferGeometry[] = [];
    this.plan.missingCeilingTiles.forEach((tile, index) => {
      euler.set(0, tile.rotation, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(
        new THREE.Vector3(tile.x, this.plan.wallHeight - 0.012, tile.z),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      holes.setMatrixAt(index, matrix);
      if (tile.hanging) {
        const panel = new THREE.BoxGeometry(1.06, 0.028, 1.06);
        panel.rotateZ(0.48);
        panel.rotateY(tile.rotation);
        panel.translate(tile.x + 0.28, this.plan.wallHeight - 0.53, tile.z);
        hangingPanels.push(panel);
      }
    });
    holes.instanceMatrix.needsUpdate = true;
    holes.computeBoundingSphere();
    this.group.add(holes);
    makeMesh(mergeOrSingle(hangingPanels), this.materials.ceiling, 'hanging-ceiling-panels', this.group);
  }

  private buildImpossibleVista(): void {
    const vista = this.plan.features.find(
      (feature): feature is VistaFeature => feature.kind === 'impossible-vista',
    );
    if (!vista) return;
    const group = new THREE.Group();
    group.name = 'explorable-vista-hall';
    const center = rectCenter(vista.bounds);
    const length = rectWidth(vista.bounds);
    const width = rectDepth(vista.bounds);

    const vistaFloorGeometry = createFloorGeometry([vista.bounds]);
    ensureBakedLightUv(vistaFloorGeometry, this.materials.floor);
    const floor = new THREE.Mesh(vistaFloorGeometry, this.materials.floor);
    floor.name = 'vista-carpet-floor';
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    group.add(floor);
    const entryBridge: Rect = {
      minX: Math.min(vista.wallX, vista.bounds.minX),
      maxX: Math.max(vista.wallX, vista.bounds.minX),
      minZ: vista.bounds.minZ,
      maxZ: vista.bounds.maxZ,
    };
    makeMesh(createFloorGeometry([entryBridge]), this.materials.floor, 'vista-entry-floor-bridge', group);
    makeMesh(
      createCeilingGeometry(vista.bounds, vista.height),
      this.materials.ceiling,
      'vista-tiled-ceiling',
      group,
    );

    const shellWalls: THREE.BufferGeometry[] = [
      createWallGeometry({
        id: 'vista-north-wall',
        x: center.x,
        z: vista.bounds.minZ,
        length,
        orientation: 'x',
        bottom: 0,
        height: vista.height,
        thickness: 0.26,
        tint: 0.9,
        collision: true,
        kind: 'wallpaper',
      }),
      createWallGeometry({
        id: 'vista-south-wall',
        x: center.x,
        z: vista.bounds.maxZ,
        length,
        orientation: 'x',
        bottom: 0,
        height: vista.height,
        thickness: 0.26,
        tint: 0.94,
        collision: true,
        kind: 'wallpaper',
      }),
      createWallGeometry({
        id: 'vista-end-wall',
        x: vista.bounds.maxX,
        z: center.z,
        length: width,
        orientation: 'z',
        bottom: 0,
        height: vista.height,
        thickness: 0.26,
        tint: 0.86,
        collision: true,
        kind: 'wallpaper',
      }),
    ];
    makeMesh(mergeOrSingle(shellWalls), this.materials.wall, 'vista-wallpaper-shell', group);

    const upperFacadeHeight = vista.height - this.plan.wallHeight;
    const transitionGeometries: THREE.BufferGeometry[] = [
      createTexturedBoxGeometry(
        0.28,
        upperFacadeHeight,
        width,
        vista.bounds.minX,
        this.plan.wallHeight,
        vista.centerZ,
        0.9,
      ),
    ];
    const revealDepth = Math.max(0.22, vista.bounds.minX - vista.wallX + 0.12);
    const revealX = (vista.bounds.minX + vista.wallX) * 0.5;
    const apertureWidth = vista.aperture.maxZ - vista.aperture.minZ;
    transitionGeometries.push(
      createTexturedBoxGeometry(
        revealDepth,
        vista.openingBottom,
        apertureWidth,
        revealX,
        0,
        vista.centerZ,
        0.94,
      ),
      createTexturedBoxGeometry(
        revealDepth,
        this.plan.wallHeight - vista.openingBottom - vista.openingHeight,
        apertureWidth,
        revealX,
        vista.openingBottom + vista.openingHeight,
        vista.centerZ,
        0.94,
      ),
      createTexturedBoxGeometry(
        revealDepth,
        vista.openingHeight,
        0.075,
        revealX,
        vista.openingBottom,
        vista.aperture.minZ,
        0.94,
      ),
      createTexturedBoxGeometry(
        revealDepth,
        vista.openingHeight,
        0.075,
        revealX,
        vista.openingBottom,
        vista.aperture.maxZ,
        0.94,
      ),
    );
    makeMesh(
      mergeOrSingle(transitionGeometries),
      this.materials.wall,
      'vista-complete-entry-facade',
      group,
    );

    const columns: THREE.BufferGeometry[] = [];
    for (let lane = -1; lane <= 1; lane += 2) {
      for (let index = 0; index < 7; index += 1) {
        const x = vista.wallX + vista.viewDirection * (5.5 + index * 7.1);
        columns.push(
          createTexturedBoxGeometry(
            1.15,
            vista.height,
            1.15,
            x,
            0,
            vista.centerZ + lane * 6.3,
            0.84 + index * 0.018,
          ),
        );
      }
    }
    makeMesh(mergeOrSingle(columns), this.materials.wall, 'vista-wallpaper-columns', group);

    const baseboards = [
      new THREE.BoxGeometry(length, 0.115, 0.09).translate(center.x, 0.0575, vista.bounds.minZ),
      new THREE.BoxGeometry(length, 0.115, 0.09).translate(center.x, 0.0575, vista.bounds.maxZ),
      new THREE.BoxGeometry(0.09, 0.115, width).translate(vista.bounds.maxX, 0.0575, center.z),
    ];
    for (let lane = -1; lane <= 1; lane += 2) {
      for (let index = 0; index < 7; index += 1) {
        const x = vista.wallX + vista.viewDirection * (5.5 + index * 7.1);
        const z = vista.centerZ + lane * 6.3;
        baseboards.push(
          new THREE.BoxGeometry(1.23, 0.115, 0.085).translate(x, 0.0575, z - 0.575),
          new THREE.BoxGeometry(1.23, 0.115, 0.085).translate(x, 0.0575, z + 0.575),
          new THREE.BoxGeometry(0.085, 0.115, 1.15).translate(x - 0.575, 0.0575, z),
          new THREE.BoxGeometry(0.085, 0.115, 1.15).translate(x + 0.575, 0.0575, z),
        );
      }
    }
    makeMesh(mergeOrSingle(baseboards), this.materials.baseboard, 'vista-baseboards', group);
    this.group.add(group);
  }

  update(time: number, playerPosition: THREE.Vector3, delta = 1 / 60): void {
    void time;
    void playerPosition;
    void delta;
  }

  getRuntimeLightSources(offset = new THREE.Vector3()): RuntimeLightSource[] {
    return this.fixtureSlots
      .filter((slot) => !slot.dead)
      .map((slot) => ({
        id: `${this.plan.seed}:${slot.id}`,
        x: slot.x + offset.x,
        y: slot.ceilingY - 0.052 + offset.y,
        z: slot.z + offset.z,
        rotation: slot.rotation,
        width: slot.width,
        intensity: slot.intensity,
        color: slot.color,
        level: slot.level,
        zoneId: `${this.plan.seed}:${slot.roomId}`,
      }));
  }

  findZoneIdAt(x: number, y: number, z: number): string {
    const lower = this.plan.features.find(
      (feature): feature is GridPitFeature => feature.kind === 'grid-pit',
    );
    if (lower && y < -1.4 && pointInRect(x, z, lower.lowerBounds)) return `${this.plan.seed}:${lower.id}`;
    const vista = this.plan.features.find(
      (feature): feature is VistaFeature => feature.kind === 'impossible-vista',
    );
    if (vista && pointInRect(x, z, vista.bounds)) return `${this.plan.seed}:${vista.id}`;
    const room = this.plan.rooms.find((candidate) => pointInRect(x, z, candidate.bounds));
    return `${this.plan.seed}:${room?.id ?? 'unclassified'}`;
  }

  private isLightOccluded(player: THREE.Vector3, source: RuntimeLightSource): boolean {
    const intersects = (minX: number, maxX: number, minZ: number, maxZ: number): boolean => {
      const dx = source.x - player.x;
      const dz = source.z - player.z;
      let enter = 0;
      let exit = 1;
      for (const [origin, direction, min, max] of [
        [player.x, dx, minX, maxX],
        [player.z, dz, minZ, maxZ],
      ] as const) {
        if (Math.abs(direction) < 1e-6) {
          if (origin < min || origin > max) return false;
          continue;
        }
        const first = (min - origin) / direction;
        const second = (max - origin) / direction;
        enter = Math.max(enter, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (enter > exit) return false;
      }
      return exit > 0.04 && enter < 0.96;
    };
    const lower = source.level < 0;
    if (this.plan.walls.some((wall) => {
      if ((wall.bottom < -1) !== lower) return false;
      const halfX = wall.orientation === 'x' ? wall.length * 0.5 : wall.thickness * 0.5;
      const halfZ = wall.orientation === 'z' ? wall.length * 0.5 : wall.thickness * 0.5;
      return intersects(wall.x - halfX, wall.x + halfX, wall.z - halfZ, wall.z + halfZ);
    })) return true;
    if (!lower && this.plan.solidMasses.some((mass) => intersects(
      mass.bounds.minX,
      mass.bounds.maxX,
      mass.bounds.minZ,
      mass.bounds.maxZ,
    ))) return true;
    return false;
  }

  getInteraction(
    playerPosition: THREE.Vector3,
    lookDirection: THREE.Vector3,
  ): WorldInteraction | null {
    const pit = this.plan.features.find(
      (feature): feature is GridPitFeature => feature.kind === 'grid-pit',
    );
    if (pit && playerPosition.y < pit.lowerCeilingY + 0.8) {
      const ladderHole = pit.holes.filter((hole) => hole.kind !== 'void').sort(
        (a, b) => rectWidth(a) * rectDepth(a) - rectWidth(b) * rectDepth(b),
      )[0];
      if (ladderHole) {
        const center = rectCenter(ladderHole);
        const ladderZ = ladderHole.minZ - 0.08;
        const dx = center.x - playerPosition.x;
        const dz = ladderZ - playerPosition.z;
        const distance = Math.hypot(dx, dz);
        const facing = distance > 1e-5
          ? (lookDirection.x * dx + lookDirection.z * dz) / distance
          : 1;
        if (distance <= 1.65 && facing > 0.7) {
          const shaftZ = ladderHole.minZ + Math.min(0.5, rectDepth(ladderHole) * 0.42);
          return {
            label: 'MONTER À L’ÉCHELLE',
            duration: 2.35,
            duckDepth: 0.03,
            path: [
              { x: center.x, y: pit.lowerFloorY + 0.865, z: shaftZ },
              { x: center.x, y: 0.865, z: shaftZ },
              { x: center.x, y: 0.865, z: ladderHole.minZ - 0.72 },
            ],
          };
        }
      }
    }

    const vista = this.plan.features.find(
      (feature): feature is VistaFeature => feature.kind === 'impossible-vista',
    );
    if (!vista || Math.abs(playerPosition.z - vista.centerZ) > (vista.aperture.maxZ - vista.aperture.minZ) * 0.5 + 0.62) return null;
    const signedDistance = (playerPosition.x - vista.wallX) * vista.viewDirection;
    if (Math.abs(signedDistance) > 2.45 || playerPosition.y < 0.25 || playerPosition.y > 1.35) return null;
    const target = new THREE.Vector3(
      vista.wallX,
      vista.openingBottom + vista.openingHeight * 0.5,
      vista.centerZ,
    );
    const toOpening = target.sub(playerPosition).normalize();
    if (lookDirection.dot(toOpening) < 0.82) return null;
    return signedDistance < 0
      ? {
          path: [vista.destination],
          duration: 0.72,
          duckDepth: 0.34,
          label: 'SE GLISSER DANS L’OUVERTURE',
        }
      : {
          path: [vista.returnDestination],
          duration: 0.72,
          duckDepth: 0.34,
          label: 'REVENIR DANS LE LEVEL 0',
        };
  }

  findRoomAt(x: number, y: number, z: number): RoomKind {
    const lower = this.plan.features.find(
      (feature): feature is GridPitFeature => feature.kind === 'grid-pit',
    );
    if (lower && y < -1.4 && pointInRect(x, z, lower.lowerBounds)) return 'lower-maze';
    const vista = this.plan.features.find(
      (feature): feature is VistaFeature => feature.kind === 'impossible-vista',
    );
    if (vista && pointInRect(x, z, vista.bounds)) return 'vista-hall';
    const room = this.plan.rooms.find(
      (candidate) =>
        x >= candidate.bounds.minX &&
        x <= candidate.bounds.maxX &&
        z >= candidate.bounds.minZ &&
        z <= candidate.bounds.maxZ,
    );
    return room?.kind ?? 'threshold';
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) object.geometry.dispose();
    });
    this.ownedMaterials.forEach((material) => material.dispose());
    this.bakedLightMap.dispose();
    this.group.removeFromParent();
  }
}
