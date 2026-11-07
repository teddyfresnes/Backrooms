import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom';

/** Depth of the wall tops under the street: a long fall. */
export const BELOW_TOP_Y = -80;
const CELL = 4;
const CELLS = 31;
const WALL_HEIGHT = 2.7;
const WALL_THICKNESS = 0.2;

const canvasTexture = (draw: (context: CanvasRenderingContext2D, size: number) => void, size: number): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

/** Mono-yellow wallpaper: a faded vertical chevron stripe, darker toward the skirting. */
const wallpaper = (): THREE.Texture | null => canvasTexture((context, size) => {
  context.fillStyle = '#c9b46a'; context.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 16) {
    context.fillStyle = 'rgba(150,128,58,.35)'; context.fillRect(x, 0, 3, size);
    context.fillStyle = 'rgba(232,214,140,.25)'; context.fillRect(x + 8, 0, 2, size);
  }
  const shade = context.createLinearGradient(0, 0, 0, size);
  shade.addColorStop(0, 'rgba(255,248,210,.18)'); shade.addColorStop(0.75, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(60,44,12,.45)');
  context.fillStyle = shade; context.fillRect(0, 0, size, size);
}, 128);

/** Damp beige carpet under a grid of fluorescent pools (the lamps are above, out of sight). */
const carpet = (random: SeededRandom): THREE.Texture | null => canvasTexture((context, size) => {
  context.fillStyle = '#8e7a47'; context.fillRect(0, 0, size, size);
  for (let i = 0; i < 3800; i++) {
    context.fillStyle = random.float(0, 1) < 0.5 ? 'rgba(60,48,22,.16)' : 'rgba(190,170,110,.12)';
    context.fillRect(random.float(0, size), random.float(0, size), 2, 2);
  }
  // One light pool per cell: the texture covers exactly one cell.
  const pool = context.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size * 0.62);
  pool.addColorStop(0, 'rgba(255,246,196,.55)'); pool.addColorStop(0.55, 'rgba(255,236,160,.12)'); pool.addColorStop(1, 'rgba(0,0,0,.25)');
  context.fillStyle = pool; context.fillRect(0, 0, size, size);
}, 256);

/**
 * What the noclip falls into: an endless-looking yellow maze seen from above,
 * deep under the street. Unlit materials (no shader recompile when it appears,
 * no light added to the scene) and outside the scene fog: the black void stays
 * black while the maze glows below. Brightens as the camera nears it.
 */
export class BackroomsBelow {
  readonly group = new THREE.Group();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly base = new Map<THREE.MeshBasicMaterial, THREE.Color>();

  constructor() {
    const random = new SeededRandom('backrooms-below');
    this.group.name = 'backrooms-below';
    this.group.visible = false;
    const wallMap = wallpaper(), floorMap = carpet(random.fork('carpet'));
    for (const map of [wallMap, floorMap]) if (map) this.textures.push(map);
    const material = (color: number, map: THREE.Texture | null): THREE.MeshBasicMaterial => {
      const result = new THREE.MeshBasicMaterial({ color, map, fog: false });
      this.materials.push(result); this.base.set(result, result.color.clone());
      return result;
    };
    const wallMaterial = material(map(wallMap, 0xffffff, 0xc9b46a), wallMap);
    const topMaterial = material(0xe9dfb2, null);
    const floorMaterial = material(map(floorMap, 0xffffff, 0x8e7a47), floorMap);

    const span = CELLS * CELL;
    const floorGeometry = new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2);
    const uv = floorGeometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * CELLS, uv.getY(i) * CELLS);
    this.geometries.push(floorGeometry);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = -WALL_HEIGHT;
    this.group.add(floor);

    // Every wall is one 4 m cell edge, so a single box keeps the wallpaper scale.
    const wallGeometry = new THREE.BoxGeometry(CELL + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS).translate(0, -WALL_HEIGHT / 2, 0);
    const wallUv = wallGeometry.getAttribute('uv');
    for (let i = 0; i < wallUv.count; i++) wallUv.setXY(i, wallUv.getX(i) * 2, wallUv.getY(i));
    const topGeometry = new THREE.PlaneGeometry(CELL + WALL_THICKNESS, WALL_THICKNESS).rotateX(-Math.PI / 2).translate(0, 0.002, 0);
    this.geometries.push(wallGeometry, topGeometry);
    const layout = random.fork('maze'), transforms: THREE.Matrix4[] = [];
    const half = (CELLS * CELL) / 2, center = Math.floor(CELLS / 2);
    const rotation = new THREE.Quaternion(), turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), unit = new THREE.Vector3(1, 1, 1);
    for (let row = 0; row <= CELLS; row++) for (let column = 0; column <= CELLS; column++) {
      for (const vertical of [false, true]) {
        if (vertical ? row === CELLS : column === CELLS) continue;
        // The landing cell (and the four around it) stay open: the fall ends in a room, not on a wall.
        const nearCenter = Math.abs(row - center) <= 1 && Math.abs(column - center) <= 1;
        if (nearCenter || layout.float(0, 1) > 0.42) continue;
        const x = -half + column * CELL + (vertical ? 0 : CELL / 2), z = -half + row * CELL + (vertical ? CELL / 2 : 0);
        transforms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), vertical ? turned : rotation, unit));
      }
    }
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, transforms.length);
    const tops = new THREE.InstancedMesh(topGeometry, topMaterial, transforms.length);
    transforms.forEach((transform, index) => { walls.setMatrixAt(index, transform); tops.setMatrixAt(index, transform); });
    for (const mesh of [walls, tops]) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.frustumCulled = false; this.group.add(mesh); }
    floor.frustumCulled = false;
  }

  /** Centres the open landing cell under the given point; the walls' tops at BELOW_TOP_Y. */
  placeUnder(x: number, z: number): void {
    this.group.position.set(x, BELOW_TOP_Y, z);
    this.group.updateMatrixWorld(true);
  }

  /** Visible while falling; light rises from 0.12 (far) to 1 at the wall tops. */
  update(visible: boolean, cameraY: number): void {
    this.group.visible = visible;
    if (!visible) return;
    const near = 1 - THREE.MathUtils.smoothstep(cameraY - BELOW_TOP_Y, 4, 70);
    const level = THREE.MathUtils.lerp(0.12, 1, near * near);
    for (const material of this.materials) material.color.copy(this.base.get(material)!).multiplyScalar(level);
  }

  get warmupRoot(): THREE.Object3D { return this.group; }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}

function map(texture: THREE.Texture | null, withTexture: number, without: number): number { return texture ? withTexture : without; }
