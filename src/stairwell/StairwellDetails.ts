import * as THREE from 'three';
import { APARTMENT_ENTRY_DOOR } from '../apartment/layout';
import type { StaticCollider } from '../world/types';
import { SeededRandom } from '../world/SeededRandom';
import type { StairwellMaterialSet } from './StairwellMaterials';
import { makeBox, makeCylinder, makeCylinderBetween } from './geometry';
import { createCastIronSection, roundedFixtureOutline } from './StairwellFixtures';
import { floorY, midLandingY, STAIRWELL_BOUNDS, STAIRWELL_FLIGHT_COUNT, STAIRWELL_LEVEL_COUNT,
  STAIRWELL_STEPS_PER_FLIGHT, STAIRWELL_STEP_DEPTH, STAIRWELL_STEP_RISE } from './layout';

/** One small opaque atlas: signage is lit scenery, never a DOM label. */
export function createStairwellDetailAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Impossible de préparer les détails du hall.');
  const random = new SeededRandom('stairwell-details:paper');
  for (let tile = 0; tile < 16; tile++) {
    const x = tile % 4 * 256, y = Math.floor(tile / 4) * 256;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = tile === 7 ? '#35483b' : tile === 4 ? '#625747' : '#b6b29d';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#66695d'; ctx.lineWidth = 9; ctx.strokeRect(6, 6, 244, 244);
    ctx.textAlign = 'center'; ctx.fillStyle = '#343c36';
    if (tile < 4) {
      ctx.font = 'bold 152px sans-serif'; ctx.fillText(String(tile + 1), 128, 171);
      ctx.font = '22px sans-serif'; ctx.fillText('Э Т А Ж', 128, 217);
    } else if (tile === 4) {
      ctx.fillStyle = '#dfd7b7'; ctx.font = 'bold 22px sans-serif'; ctx.fillText('ОБЪЯВЛЕНИЯ', 128, 35);
      for (let paper = 0; paper < 6; paper++) {
        ctx.save(); ctx.translate(23 + paper % 3 * 76, 58 + Math.floor(paper / 3) * 92);
        ctx.rotate(random.float(-.07, .07)); ctx.fillStyle = ['#d2ccb6', '#c4c7b7', '#d9d3bc'][paper % 3];
        ctx.fillRect(0, 0, 64, 77); ctx.fillStyle = '#747667';
        ctx.fillRect(7, 11, 49, 3);
        for (let line = 0; line < 7; line++) ctx.fillRect(7, 21 + line * 6, random.int(27, 48), 1.5);
        ctx.fillStyle = '#4e5149'; ctx.beginPath(); ctx.arc(32, 3, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    } else if (tile === 5) {
      ctx.fillStyle = '#323b36'; ctx.fillRect(18, 35, 220, 180);
      ctx.fillStyle = '#b6b9a5'; ctx.font = '42px monospace'; ctx.fillText('04817', 128, 98);
      ctx.strokeStyle = '#828976'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(128, 156, 30, 0, Math.PI * 2); ctx.stroke();
      ctx.fillRect(91, 155, 73, 3); ctx.font = '17px sans-serif'; ctx.fillText('кВт·ч', 128, 205);
    } else if (tile === 6) {
      ctx.fillStyle = '#c8b866'; ctx.beginPath(); ctx.moveTo(128, 20); ctx.lineTo(230, 182); ctx.lineTo(26, 182); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#353c34'; ctx.beginPath(); ctx.moveTo(139, 51); ctx.lineTo(100, 114); ctx.lineTo(130, 114);
      ctx.lineTo(113, 161); ctx.lineTo(161, 96); ctx.lineTo(131, 96); ctx.closePath(); ctx.fill();
      ctx.font = 'bold 33px sans-serif'; ctx.fillText('220 В', 128, 229);
    } else if (tile === 7) {
      ctx.fillStyle = '#d0d5ba'; ctx.font = 'bold 56px sans-serif'; ctx.fillText('ВЫХОД', 128, 124, 220);
      ctx.font = '88px sans-serif'; ctx.fillText('↓', 128, 215);
    } else {
      ctx.fillStyle = '#454e45'; ctx.font = '25px sans-serif'; ctx.fillText('КВАРТИРА', 128, 65);
      ctx.font = 'bold 100px sans-serif'; ctx.fillText(String(tile - 7).padStart(2, '0'), 128, 178);
      ctx.fillStyle = '#7b8070'; ctx.fillRect(40, 212, 176, 3);
    }
    // Tea-stained paper, rubbed enamel and tape are baked into the opaque tile.
    const dirt = ctx.createRadialGradient(142, 124, 45, 142, 124, 175);
    dirt.addColorStop(0, 'rgba(75,57,29,0)'); dirt.addColorStop(.68, 'rgba(75,57,29,.06)'); dirt.addColorStop(1, 'rgba(63,44,20,.42)');
    ctx.fillStyle = dirt; ctx.fillRect(0, 0, 256, 256);
    for (let stain = 0; stain < 9; stain++) {
      ctx.fillStyle = 'rgba(77,60,31,.08)'; ctx.beginPath();
      ctx.ellipse(random.int(7, 249), random.int(7, 249), random.int(3, 17), random.int(7, 32), random.float(-.5, .5), 0, Math.PI * 2); ctx.fill();
    }
    if (tile === 4) {
      for (let paper = 0; paper < 6; paper++) {
        const x = 23 + paper % 3 * 76, y = 58 + Math.floor(paper / 3) * 92;
        ctx.fillStyle = 'rgba(143,119,63,.32)'; ctx.fillRect(x + 15, y - 3, 31, 9);
        ctx.strokeStyle = 'rgba(85,73,48,.22)'; ctx.lineWidth = .7;
        ctx.beginPath(); ctx.moveTo(x + 4, y + 25); ctx.lineTo(x + 39, y + 29); ctx.lineTo(x + 58, y + 24); ctx.stroke();
        ctx.fillStyle = '#625747'; ctx.beginPath(); ctx.moveTo(x + 64, y + 65); ctx.lineTo(x + 54, y + 77); ctx.lineTo(x + 66, y + 79); ctx.fill();
      }
    } else {
      ctx.strokeStyle = 'rgba(204,197,166,.5)'; ctx.lineWidth = 1;
      for (let scratch = 0; scratch < 10; scratch++) {
        const x = random.int(14, 220), y = random.int(12, 241);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + random.int(3, 21), y - random.int(0, 3)); ctx.stroke();
      }
    }
    for (let speck = 0; speck < 95; speck++) {
      ctx.fillStyle = random.chance(.5) ? 'rgba(47,47,34,.12)' : 'rgba(236,229,201,.16)';
      ctx.fillRect(random.int(10, 244), random.int(10, 244), random.int(1, 3), random.int(1, 3));
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'stairwell-details-atlas'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  return texture;
}

/** Static, batchable detail only: no extra lights, shadows, downloads or frame loop. */
export class StairwellDetails {
  readonly group = new THREE.Group();
  readonly colliders: StaticCollider[] = [];
  private readonly owned: THREE.Material[] = [];
  private readonly wood: THREE.MeshStandardMaterial;
  private readonly iron: THREE.MeshStandardMaterial;
  private readonly clay: THREE.MeshStandardMaterial;
  private readonly leaf: THREE.MeshStandardMaterial;
  private readonly labels: THREE.MeshStandardMaterial;

  constructor(private readonly base: StairwellMaterialSet, private readonly atlas: THREE.Texture = createStairwellDetailAtlas()) {
    this.group.name = 'stairwell-residential-details';
    this.wood = this.material('stairwell-worn-wood', 0x645340);
    this.iron = this.material('stairwell-aged-enamel', 0xa5a28c, .08);
    this.iron.map = base.fixtureBody.map;
    this.clay = this.material('stairwell-terracotta', 0x695244);
    this.leaf = this.material('stairwell-foliage', 0x414e3d);
    this.leaf.side = THREE.DoubleSide;
    this.labels = new THREE.MeshStandardMaterial({ name: 'stairwell-detail-signs', map: atlas, roughness: .95 });
    this.owned.push(this.labels);
    this.landings(); this.stairs(); this.entrance(); this.residentialCorners();
    this.group.updateMatrixWorld(true);
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.receiveShadow = false;
        if (object.material === this.iron) {
          const random = new SeededRandom(`enamel-wear:${object.name}`);
          const p = object.geometry.getAttribute('position'), colors = new Float32Array(p.count * 3);
          for (let i = 0; i < p.count; i++) {
            const rust = p.getY(i) < -.13 && random.chance(.12);
            colors.set(rust ? [.49, .35, .22] : [.94, .91, .84], i * 3);
          }
          object.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
      }
      object.matrixAutoUpdate = false;
    });
    this.iron.vertexColors = true;
  }

  private material(name: string, color: number, metalness = 0): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ name, color, roughness: .86, metalness });
    this.owned.push(material); return material;
  }

  private box(name: string, size: readonly [number, number, number], position: readonly [number, number, number], material = this.base.railing): THREE.Mesh {
    const mesh = makeBox(name, size, position, material, false, false);
    this.group.add(mesh); return mesh;
  }

  private sign(name: string, tile: number, width: number, height: number, position: readonly [number, number, number], yaw = 0): void {
    const geometry = new THREE.PlaneGeometry(width, height);
    const uv = geometry.getAttribute('uv');
    const u0 = tile % 4 / 4, v0 = 1 - (Math.floor(tile / 4) + 1) / 4;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + .002 + uv.getX(i) * .246, v0 + .002 + uv.getY(i) * .246);
    const mesh = new THREE.Mesh(geometry, this.labels);
    mesh.name = name; mesh.position.set(...position); mesh.rotation.y = yaw;
    this.group.add(mesh);
  }

  private solid(name: string, pieces: readonly THREE.Mesh[]): void {
    const bounds = new THREE.Box3();
    for (const mesh of pieces) { mesh.updateMatrixWorld(true); bounds.union(new THREE.Box3().setFromObject(mesh)); }
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    this.colliders.push({ id: name, kind: 'barrier', center: { x: center.x, y: center.y, z: center.z },
      halfExtents: { x: size.x / 2, y: size.y / 2, z: size.z / 2 } });
  }

  private radiator(name: string, x: number, y: number, z: number): void {
    const pieces: THREE.Mesh[] = [];
    const wallSide = z > 0 ? 1 : -1;
    for (let fin = 0; fin < 8; fin++) {
      const section = new THREE.Mesh(createCastIronSection(fin === 0 || fin === 7), this.iron);
      section.name = `${name}-cast-section-${fin}`;
      section.position.set(x - .35 + fin * .10, y + .41, z);
      this.group.add(section); pieces.push(section);
    }
    for (const h of [.23, .59]) {
      const manifold = makeCylinder(`${name}-manifold-${h}`, .032, .91, [x, y + h, z], this.iron, 8);
      manifold.rotation.z = Math.PI / 2; this.group.add(manifold); pieces.push(manifold);
    }
    for (const side of [-1, 1]) {
      pieces.push(this.box(`${name}-bracket-${side}`, [.055, .12, .11], [x + side * .29, y + .24, z + wallSide * .105], this.base.pipe));
      const valve = makeCylinder(`${name}-valve-${side}`, .028, .08, [x + side * .49, y + (side < 0 ? .23 : .59), z], this.base.galvanized, 6);
      valve.rotation.z = Math.PI / 2; this.group.add(valve); pieces.push(valve);
      const pipeY = y + (side < 0 ? .23 : .59);
      const elbow = new THREE.Vector3(x + side * .54, pipeY, z);
      const wallZ = wallSide > 0 ? 3.89 : -6.14;
      const wallEnd = new THREE.Vector3(elbow.x, pipeY, wallZ - wallSide * .009);
      const pipe = makeCylinderBetween(`${name}-wall-connection-${side}`, elbow, wallEnd, .014, this.base.pipe, 6);
      this.group.add(pipe); pieces.push(pipe);
      const rose = makeCylinder(`${name}-wall-rose-${side}`, .025, .018, [elbow.x, pipeY, wallEnd.z], this.iron, 6);
      rose.rotation.x = Math.PI / 2; this.group.add(rose); pieces.push(rose);
    }
    const stem = makeCylinder(`${name}-valve-stem`, .009, .046, [x + .49, y + .626, z], this.base.galvanized, 6);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(.029, .005, 4, 10), this.clay);
    wheel.name = `${name}-valve-wheel`; wheel.rotation.x = Math.PI / 2; wheel.position.set(x + .49, y + .65, z);
    this.group.add(stem, wheel); pieces.push(stem, wheel);
    for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      const spoke = makeCylinderBetween(`${name}-valve-spoke-${angle}`,
        new THREE.Vector3(x + .49 - Math.cos(angle) * .029, y + .65, z - Math.sin(angle) * .029),
        new THREE.Vector3(x + .49 + Math.cos(angle) * .029, y + .65, z + Math.sin(angle) * .029), .003, this.clay, 4);
      this.group.add(spoke);
    }
    this.solid(name, pieces);
  }

  private doorbell(name: string, side: number, y: number, z: number): void {
    const housing = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedFixtureOutline(.052, .088, .013), {
      depth: .009, bevelEnabled: true, bevelSize: .0015, bevelThickness: .0015, bevelSegments: 1, curveSegments: 3,
    }), this.iron);
    housing.geometry.clearGroups(); housing.name = `${name}-housing`;
    housing.position.set(side * 1.938, y, z); housing.rotation.y = -side * Math.PI / 2;
    this.group.add(housing);
    for (const [part, radius, depth, x, material] of [
      ['recess', .016, .003, 1.925, this.base.rubber],
      ['bezel', .014, .004, 1.923, this.base.galvanized],
      ['button', .011, .004, 1.920, this.base.fixtureBody],
    ] as const) {
      const disc = makeCylinder(`${name}-${part}`, radius, depth, [side * x, y, z], material, 8);
      disc.rotation.z = Math.PI / 2; this.group.add(disc);
    }
    for (const end of [-1, 1]) {
      const screw = makeCylinder(`${name}-screw-${end}`, .0025, .0015, [side * 1.926, y + end * .031, z], this.base.galvanized, 6);
      screw.rotation.z = Math.PI / 2; this.group.add(screw);
      this.box(`${name}-screw-slot-${end}`, [.0008, .0007, .003], [side * 1.9245, y + end * .031, z], this.base.rubber);
    }
  }

  private landings(): void {
    const sideX = STAIRWELL_BOUNDS.maxX - .143;
    for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level++) {
      const y = floorY(level);
      this.sign(`floor-number-${level}`, level, .37, .42, [1.62, y + 1.58, -6.105]);
      for (const side of [-1, 1]) {
        // Skirting is cut around the actual doorway, with no cap in its opening.
        for (const [start, end] of [[-6.08, APARTMENT_ENTRY_DOOR.centerZ - .53], [APARTMENT_ENTRY_DOOR.centerZ + .53, -1.22]]) {
          this.box(`skirting-${level}-${side}-${start}`, [.04, .105, end - start], [side * sideX, y + .053, (start + end) / 2]);
        }
        this.box(`doormat-${level}-${side}`, [.46, .014, .72], [side * 1.67, y + .014, APARTMENT_ENTRY_DOOR.centerZ], level % 2 ? this.wood : this.base.rubber);
        for (let rib = 0; rib < 5; rib++) this.box(`mat-rib-${level}-${side}-${rib}`, [.39, .003, .012], [side * 1.67, y + .0225, APARTMENT_ENTRY_DOOR.centerZ - .25 + rib * .125], this.base.rubber);
        const plateZ = APARTMENT_ENTRY_DOOR.centerZ - .71;
        this.sign(`apartment-number-${level}-${side}`, 8 + level * 2 + (side > 0 ? 1 : 0), .16, .23,
          [side * 1.930, y + 1.63, plateZ], side < 0 ? Math.PI / 2 : -Math.PI / 2);
        this.box(`number-plate-backing-${level}-${side}`, [.008, .24, .17], [side * 1.936, y + 1.63, plateZ], this.iron);
        this.doorbell(`doorbell-${level}-${side}`, side, y + 1.22, plateZ);
      }
      if (level === 1 || level === 3) this.radiator(`window-radiator-${level}`, 0, y, -5.98);
    }
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level++) {
      const y = midLandingY(level), northZ = STAIRWELL_BOUNDS.maxZ - .23;
      this.sign(`mid-landing-number-${level}`, level + 1, .42, .46, [0, y + 1.44, northZ + .01], Math.PI);
      this.radiator(`mid-landing-radiator-${level}`, 0, y, northZ - .045);
      const cabinet = this.box(`electrical-cabinet-${level}`, [.52, .74, .16], [-1.22, y + 1.28, northZ + .035], this.iron);
      this.solid(`electrical-cabinet-${level}`, [cabinet]);
      this.sign(`meter-${level}`, 5, .3, .3, [-1.22, y + 1.39, northZ - .047], Math.PI);
      this.sign(`electrical-warning-${level}`, 6, .12, .12, [-1.22, y + 1.07, northZ - .048], Math.PI);
      for (const x of [-1.43, -.995]) this.box(`cabinet-hinge-${level}-${x}`, [.025, .09, .03], [x, y + 1.25, northZ - .057], this.base.galvanized);
      this.group.add(makeCylinderBetween(`meter-conduit-${level}`, new THREE.Vector3(-1.22, y + 1.65, northZ + .045),
        new THREE.Vector3(-1.22, y + 2.28, northZ + .045), .018, this.base.pipe, 6));
      this.box(`conduit-box-${level}`, [.12, .1, .065], [-1.22, y + 2.27, northZ + .035], this.iron);
    }
  }

  private stairs(): void {
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level++) {
      for (const side of [-1, 1]) {
        const base = side < 0 ? floorY(level) : midLandingY(level);
        for (let step = 0; step < STAIRWELL_STEPS_PER_FLIGHT; step++) {
          const top = base + STAIRWELL_STEP_RISE * (step + 1);
          const z = side < 0 ? -1.2 + STAIRWELL_STEP_DEPTH * (step + .5) : 1.2 - STAIRWELL_STEP_DEPTH * (step + .5);
          const front = z + side * (STAIRWELL_STEP_DEPTH * .5 + .005);
          // A real projecting nosing: neither its upper face nor its leading
          // face is coplanar with the underlying concrete tread/riser.
          this.box(`stair-nosing-${level}-${side}-${step}`, [1.64, .02, .022], [side * 1.05, top - .007, front], this.base.galvanized);
        }
        const startZ = side < 0 ? -1.04 : 1.04, endZ = -startZ;
        const a = new THREE.Vector3(side * 1.86, base + STAIRWELL_STEP_RISE + .94, startZ);
        const b = new THREE.Vector3(side * 1.86, base + STAIRWELL_STEP_RISE * STAIRWELL_STEPS_PER_FLIGHT + .94, endZ);
        const rail = makeCylinderBetween(`wall-handrail-${level}-${side}`, a, b, .029, this.wood, 8);
        this.group.add(rail); this.solid(`wall-handrail-${level}-${side}`, [rail]);
        for (const t of [.08, .5, .92]) {
          const point = a.clone().lerp(b, t);
          this.group.add(makeCylinderBetween(`handrail-bracket-${level}-${side}-${t}`, point,
            new THREE.Vector3(side * 1.937, point.y - .07, point.z), .014, this.base.galvanized, 6));
        }
      }
    }
  }

  private entrance(): void {
    this.box('entrance-ribbed-mat', [1.65, .018, .64], [0, .016, -5.28], this.base.rubber);
    for (let rib = 0; rib < 13; rib++) this.box(`entrance-mat-rib-${rib}`, [.014, .004, .56], [-.72 + rib * .12, .027, -5.28], this.wood);
    const board = this.box('noticeboard-back', [.052, .88, 1.06], [1.88, 1.5, -4.48], this.wood);
    this.solid('noticeboard-back', [board]);
    this.sign('entrance-noticeboard', 4, 1, .82, [1.851, 1.5, -4.48], -Math.PI / 2);
    this.sign('exit-direction-sign', 7, .28, .2, [1.62, 2.27, -6.105]);
    const bin = makeCylinder('entrance-metal-bin', .155, .42, [1.63, .22, -5.69], this.base.railing, 10);
    this.group.add(bin); this.solid('entrance-metal-bin', [bin]);
    this.group.add(makeCylinder('bin-dark-opening', .135, .008, [1.63, .435, -5.69], this.base.rubber, 10));
  }

  private residentialCorners(): void {
    const floor = floorY(1);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.15, .105, .24, 10), this.clay);
    pot.name = 'resident-plant-pot'; pot.position.set(-1.48, floor + .12, -5.66);
    this.group.add(pot); this.solid('resident-plant-pot', [pot]);
    this.group.add(makeCylinder('resident-plant-soil', .135, .012, [-1.48, floor + .237, -5.66], this.base.rubber, 10));
    for (let stem = 0; stem < 5; stem++) {
      const angle = stem * 2.4, tip = new THREE.Vector3(-1.48 + Math.sin(angle) * .12, floor + .5 + stem * .055, -5.66 + Math.cos(angle) * .12);
      this.group.add(makeCylinderBetween(`plant-stem-${stem}`, new THREE.Vector3(-1.48, floor + .23, -5.66), tip, .006, this.wood, 5));
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.quadraticCurveTo(.07, .04, .035, .2); shape.quadraticCurveTo(-.055, .09, 0, 0);
      const leaf = new THREE.Mesh(new THREE.ShapeGeometry(shape, 3), this.leaf);
      leaf.name = `plant-leaf-${stem}`; leaf.position.copy(tip); leaf.rotation.set(-.45, angle, .4); this.group.add(leaf);
    }
    const box = this.box('resident-parcel', [.42, .29, .36], [1.59, floorY(3) + .145, -5.67], this.wood);
    this.box('parcel-tape', [.065, .006, .35], [1.59, floorY(3) + .293, -5.67], this.iron);
    this.solid('resident-parcel', [box]);
  }

  /** Geometry is owned/disposed by the environment after its static batching. */
  dispose(): void {
    for (const material of this.owned) material.dispose();
    this.atlas.dispose();
  }
}
