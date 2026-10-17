import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom';
import { STAIRWELL_BOUNDS, STAIRWELL_ROOF_Y } from './layout';
import { containsPaint, stairwellPaintPatches } from './StairwellPaintLayout';

export type StairwellWall = 'west' | 'east' | 'south' | 'north';
const WALLS: readonly StairwellWall[] = ['west', 'east', 'south', 'north'];
const TILE_WIDTH = 1024;
const TILE_HEIGHT = 512;
const GUTTER = 4;

/** Opaque finish baked once: no layered wall faces, transparency or shader noise. */
export function createStairwellWallAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_WIDTH * 2; canvas.height = TILE_HEIGHT * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Impossible de préparer les surfaces du hall.');
  const patches = stairwellPaintPatches();
  for (const [index, wall] of WALLS.entries()) {
    const random = new SeededRandom(`stairwell-wall-wear:${wall}`);
    const min = wall === 'west' || wall === 'east' ? STAIRWELL_BOUNDS.minZ : STAIRWELL_BOUNDS.minX;
    const max = wall === 'west' || wall === 'east' ? STAIRWELL_BOUNDS.maxZ : STAIRWELL_BOUNDS.maxX;
    const px = (along: number) => GUTTER + (along - min) / (max - min) * (TILE_WIDTH - GUTTER * 2);
    const py = (height: number) => TILE_HEIGHT - GUTTER - height / STAIRWELL_ROOF_Y * (TILE_HEIGHT - GUTTER * 2);
    ctx.save(); ctx.translate(index % 2 * TILE_WIDTH, Math.floor(index / 2) * TILE_HEIGHT);
    ctx.beginPath(); ctx.rect(0, 0, TILE_WIDTH, TILE_HEIGHT); ctx.clip();
    ctx.fillStyle = '#b9b6a9'; ctx.fillRect(0, 0, TILE_WIDTH, TILE_HEIGHT);

    // Old roller coats, broad damp blooms and repairs are part of the albedo.
    for (let stain = 0; stain < 55; stain++) {
      const x = random.float(0, TILE_WIDTH), y = random.float(0, TILE_HEIGHT);
      const radius = random.float(15, 110);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, random.chance(.4) ? 'rgba(68,61,42,.14)' : 'rgba(226,218,192,.12)');
      gradient.addColorStop(1, 'rgba(90,79,55,0)');
      ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    for (let repair = 0; repair < 9; repair++) {
      const x = random.float(35, TILE_WIDTH - 75), y = random.float(20, TILE_HEIGHT - 40);
      ctx.fillStyle = 'rgba(218,213,190,.2)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 28, y - 2); ctx.lineTo(x + 38, y + 22);
      ctx.lineTo(x + 9, y + 28); ctx.lineTo(x - 4, y + 9); ctx.fill();
    }
    for (const patch of patches.filter(patch => patch.wall === wall)) {
      ctx.fillStyle = '#707e71'; ctx.beginPath();
      patch.points.forEach((point, i) => {
        if (i === 0) ctx.moveTo(px(point.along), py(point.height));
        else ctx.lineTo(px(point.along), py(point.height));
      });
      ctx.closePath(); ctx.fill();
      const left = Math.min(...patch.points.map(p => p.along)), right = Math.max(...patch.points.map(p => p.along));
      const bottom = Math.min(...patch.points.map(p => p.height)), top = Math.max(...patch.points.map(p => p.height));
      for (let mark = 0; mark < 50; mark++) {
        const along = random.float(left, right), height = random.float(bottom, top);
        if (!containsPaint(patch, along, height)) continue;
        const x = px(along), y = py(height);
        ctx.fillStyle = random.chance(.32) ? 'rgba(186,177,151,.55)' : 'rgba(41,46,36,.12)';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + random.float(1, 6), y - 1);
        ctx.lineTo(x + random.float(0, 4), y + random.float(1, 2)); ctx.closePath(); ctx.fill();
      }
    }
    for (let streak = 0; streak < 50; streak++) {
      const x = random.float(GUTTER, TILE_WIDTH - GUTTER), y = random.float(12, TILE_HEIGHT - 40);
      ctx.strokeStyle = 'rgba(71,63,43,.1)'; ctx.lineWidth = random.float(.5, 1.6);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x - 1, y + 7, x + 2, y + 12, x + 1, y + random.float(12, 32)); ctx.stroke();
    }
    // Hairline settling cracks, never missing pixels in the wall.
    for (let crack = 0; crack < 6; crack++) {
      let x = random.float(18, TILE_WIDTH - 18), y = random.float(12, TILE_HEIGHT - 65);
      ctx.strokeStyle = 'rgba(62,59,44,.28)'; ctx.lineWidth = .65;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let segment = 0; segment < 7; segment++) { x += random.float(-4, 4); y += random.float(2, 7); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let grain = 0; grain < 13000; grain++) {
      ctx.fillStyle = random.chance(.5) ? 'rgba(39,37,29,.035)' : 'rgba(245,234,207,.045)';
      ctx.fillRect(random.int(0, TILE_WIDTH - 1), random.int(0, TILE_HEIGHT - 1), 1, 1);
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'stairwell-worn-wall-atlas'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

/** All adjacent shell pieces use one continuous wall chart, including lintels. */
export function mapStairwellWallUV(mesh: THREE.Mesh, wall: StairwellWall): THREE.Mesh {
  const index = WALLS.indexOf(wall);
  const side = wall === 'west' || wall === 'east';
  const min = side ? STAIRWELL_BOUNDS.minZ : STAIRWELL_BOUNDS.minX;
  const max = side ? STAIRWELL_BOUNDS.maxZ : STAIRWELL_BOUNDS.maxX;
  const positions = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
  mesh.updateMatrix();
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix);
    const u = THREE.MathUtils.clamp(((side ? point.z : point.x) - min) / (max - min), 0, 1);
    const v = THREE.MathUtils.clamp(point.y / STAIRWELL_ROOF_Y, 0, 1);
    uv.setXY(i, (index % 2 + (GUTTER + u * (TILE_WIDTH - GUTTER * 2)) / TILE_WIDTH) / 2,
      1 - (Math.floor(index / 2) + (TILE_HEIGHT - GUTTER - v * (TILE_HEIGHT - GUTTER * 2)) / TILE_HEIGHT) / 2);
  }
  uv.needsUpdate = true;
  return mesh;
}
