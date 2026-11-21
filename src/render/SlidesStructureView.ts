import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../world/SeededRandom';
import {
  SLIDE_BORE, SLIDE_HOLE, SLIDE_LIP, SLIDE_SHELL, slidePath, slideTubeMesh,
  type SlideEntryPlan, type SlideMeshData, type SlidesStructureFeature,
} from '../world/SlidesStructure';
import type { TextureOrigin } from './ArchitecturalUV';
import { applyZonalLighting, type ZonalLightingContext } from './ZonalLighting';

/** The chunk's own wallpaper: the slide wall is the same wall as the rest of the hall. */
export interface SlidesWallFinish { material: THREE.Material; origin: TextureOrigin; scale: number }

const HALL_HALF_WIDTH = 24;
const INK = '#151412';
const MARKER_FONTS = '"Segoe Print", "Ink Free", "Comic Sans MS", "Bradley Hand ITC", cursive';

const meshDataGeometry = (m: SlideMeshData): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.shade.flatMap(v => [v, v, v]), 3)); g.setIndex(m.indices); g.computeVertexNormals(); return g;
};
const soup = (g: THREE.BufferGeometry, shade = 1): THREE.BufferGeometry => {
  const flat = g.index ? g.toNonIndexed() : g; if (flat !== g) g.dispose();
  if (!flat.getAttribute('color')) flat.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(flat.getAttribute('position').count * 3).fill(shade), 3));
  return flat;
};

/** Marker scrawls in the photo's spirit: a label and its doodle, drawn once. */
const drawScrawl = (context: CanvasRenderingContext2D, entry: SlideEntryPlan, w: number, h: number, rng: SeededRandom): void => {
  const jitter = (n: number) => rng.float(-n, n);
  const stroke = (points: [number, number][]) => {
    context.beginPath(); context.moveTo(points[0]![0] + jitter(1.5), points[0]![1] + jitter(1.5));
    for (const [x, y] of points.slice(1)) context.lineTo(x + jitter(1.5), y + jitter(1.5));
    context.stroke();
  };
  const text = (value: string, x: number, y: number, size: number, angle: number) => {
    context.save(); context.translate(x, y); context.rotate(angle); context.font = `700 ${size}px ${MARKER_FONTS}`;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    // Two slightly offset passes read as a felt marker, not a typeface.
    context.fillText(value, 0, 0); context.globalAlpha *= .55; context.fillText(value, 1.6, .8); context.restore();
  };
  const curve = (points: [number, number][]) => {
    const out: [number, number][] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t, [a, b, c] = points as [[number, number], [number, number], [number, number]];
      out.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]);
    }
    stroke(out); return out;
  };
  const head = (tip: [number, number], from: [number, number], size: number) => {
    const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    stroke([[tip[0] - Math.cos(a - .5) * size, tip[1] - Math.sin(a - .5) * size], tip, [tip[0] - Math.cos(a + .5) * size, tip[1] - Math.sin(a + .5) * size]]);
  };
  if (entry.key === 'this-way') {
    text('THIS WAY', w * .3, h * .2, h * .15, -.06);
    const path = curve([[w * .12, h * .36], [w * .03, h * .72], [w * .27, h * .82]]);
    head(path.at(-1)!, path.at(-4)!, h * .07);
  } else if (entry.key === 'unknown') {
    text('?', w * .33, h * .42, h * .2, -.25); text('?', w * .5, h * .27, h * .22, .05); text('?', w * .67, h * .41, h * .2, .3);
  } else {
    text('EXIT', w * .72, h * .2, h * .15, .05);
    // A sideways smile, the way it is drawn in a hurry.
    context.beginPath(); context.arc(w * .9, h * .3, h * .012, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.arc(w * .9, h * .19, h * .012, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.arc(w * .94, h * .245, h * .07, Math.PI * .6, Math.PI * 1.4, true); context.stroke();
  }
};

/** Three tube slides in a wallpapered wall, merged per material. Owns all of
 * its GPU resources except the borrowed wallpaper material. */
export class SlidesStructureView {
  readonly group = new THREE.Group();
  readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private disposed = false;
  constructor(feature: SlidesStructureFeature, seed: string, context: ZonalLightingContext | null, wall?: SlidesWallFinish) {
    this.group.name = feature.id; this.group.userData.structureKind = 'slides';
    const rng = new SeededRandom(seed).fork('slides-plastic-v2');
    // Faint moulding marks and scuffs on the plastic, never a printed pattern.
    const bytes = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < bytes.length; i += 4) { const n = rng.int(226, 255); bytes[i] = bytes[i + 1] = bytes[i + 2] = n; bytes[i + 3] = 255; }
    const scuffs = new THREE.DataTexture(bytes, 64, 64); scuffs.wrapS = scuffs.wrapT = THREE.RepeatWrapping; scuffs.needsUpdate = true; this.textures.push(scuffs);
    const black = new THREE.MeshBasicMaterial({ name: 'slides-unlit-depth', color: 0x000000 }); this.materials.push(black);
    const caps: THREE.BufferGeometry[] = [];
    for (const e of feature.entries) {
      const entry = new THREE.Group(); entry.name = `slide-mouth-${e.key}`;
      entry.userData = { entryId: e.id, label: e.label, transitionKey: e.transitionKey }; this.group.add(entry);
      const plastic = new THREE.MeshStandardMaterial({ name: `slide-${e.key}-plastic`, color: e.color, roughness: .3, metalness: 0, map: scuffs,
        vertexColors: true, emissive: e.color, emissiveIntensity: .17 });
      if (context) applyZonalLighting(plastic, context);
      // Moulded plastic keeps its colour in a dim hall, but the glow follows the
      // bore's shading: deep in the bend it is black, not lit from within.
      const before = plastic.onBeforeCompile.bind(plastic), key = plastic.customProgramCacheKey.bind(plastic);
      plastic.onBeforeCompile = (shader, renderer) => {
        before(shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          #ifdef USE_COLOR
            totalEmissiveRadiance *= vColor.rgb;
          #endif`);
      };
      plastic.customProgramCacheKey = () => `${key()}|slide-plastic-v2`;
      this.materials.push(plastic);
      const rim = new THREE.TorusGeometry(SLIDE_BORE + SLIDE_SHELL * .5, .058, 14, 64).translate(e.position.x, e.position.y, e.position.z + SLIDE_LIP);
      const parts = [soup(meshDataGeometry(slideTubeMesh(e, 'inner'))), soup(meshDataGeometry(slideTubeMesh(e, 'lip'))), soup(rim)];
      this.addMesh(entry, mergeOrThrow(parts), plastic, `slide-${e.key}-tube`);
      // A round black stop where the bend leaves sight: the drop goes on in the dark.
      const path = slidePath(e), end = path.at(-1)!;
      const cap = new THREE.CircleGeometry(SLIDE_BORE + .01, 40);
      cap.lookAt(new THREE.Vector3(-end.tx, -end.ty, -end.tz)); cap.translate(end.x, end.y, end.z); caps.push(soup(cap));
      this.addScrawl(entry, e, seed);
    }
    this.addMesh(this.group, mergeOrThrow(caps), black, 'slides-unlit-depth');
    if (wall) this.addWall(feature, wall);
  }

  /** The hall's north wall, with three round holes and the wallpaper's world UVs. */
  private addWall(feature: SlidesStructureFeature, finish: SlidesWallFinish): void {
    const shape = new THREE.Shape();
    shape.moveTo(-HALL_HALF_WIDTH, feature.floorY); shape.lineTo(HALL_HALF_WIDTH, feature.floorY);
    shape.lineTo(HALL_HALF_WIDTH, feature.ceilingY); shape.lineTo(-HALL_HALF_WIDTH, feature.ceilingY); shape.closePath();
    for (const e of feature.entries) { const hole = new THREE.Path(); hole.absarc(e.position.x, e.position.y, SLIDE_HOLE, 0, Math.PI * 2, true); shape.holes.push(hole); }
    const geometry = new THREE.ShapeGeometry(shape, 48); geometry.translate(0, 0, feature.wallZ);
    const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + finish.origin.x) * finish.scale / 2.05, (p.getY(i) + finish.origin.y) * finish.scale / 2.45);
    const mesh = new THREE.Mesh(soup(geometry), finish.material); mesh.name = 'slides-wallpaper-wall';
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere(); this.group.add(mesh);
  }

  private addScrawl(parent: THREE.Group, entry: SlideEntryPlan, seed: string): void {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 600;
    const context = canvas.getContext('2d'); if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = INK; context.strokeStyle = INK; context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = 8; context.globalAlpha = .9;
    drawScrawl(context, entry, canvas.width, canvas.height, new SeededRandom(`${seed}:slide-scrawl:${entry.key}`));
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; this.textures.push(texture);
    const material = new THREE.MeshBasicMaterial({ name: `slide-${entry.key}-scrawl`, map: texture, transparent: true, alphaTest: .03, depthWrite: false, toneMapped: false });
    this.materials.push(material);
    // 2.8 x 1.64 m, its lower edge level with the middle of the mouth.
    const geometry = new THREE.PlaneGeometry(2.8, 1.64).translate(entry.position.x, entry.position.y + .82, entry.position.z + .006);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `slide-${entry.key}-scrawl`; mesh.renderOrder = 14; parent.add(mesh);
  }

  private addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, name: string): void {
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; parent.add(mesh);
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.group.removeFromParent();
    this.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.materials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); this.group.clear();
  }
}

const mergeOrThrow = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  // ShapeGeometry/PlaneGeometry carry no colour; normalise attributes first.
  const merged = mergeGeometries(parts.map(p => { for (const name of Object.keys(p.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) p.deleteAttribute(name); return p; }), false);
  parts.forEach(p => p.dispose());
  if (!merged) throw new Error('Cannot merge slide structure geometry');
  return merged;
};
