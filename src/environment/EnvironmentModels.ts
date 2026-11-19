import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom';

export interface EventModel { root: THREE.Group; head?: THREE.Group; receiver?: THREE.Group; lever?: THREE.Group; lens?: THREE.MeshBasicMaterial; dispose(): void }
const roundedCase = (w: number, h: number, depth: number, radius = .035): THREE.BufferGeometry => {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2, r = Math.min(radius, w / 3, h / 3);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(.004, depth - .014), bevelEnabled: true, bevelSize: .007, bevelThickness: .007, bevelSegments: 2, steps: 1, curveSegments: 5 });
  g.translate(0, 0, .014); return g;
};

/** Authored assemblies, in metres with +Z pointing out of the mounting wall.
 * Chamfered Bakelite, rotary dial, coiled lead, bell grilles, gimbal and lens
 * are final geometry; no placeholder meshes or external model dependencies. */
export const createEnvironmentModel = (kind: 'fire-alarm' | 'telephone' | 'surveillance' | 'circuit-breaker', seed: string): EventModel => {
  const root = new THREE.Group(), rng = new SeededRandom(seed), ownedTextures: THREE.Texture[] = [];
  root.name = `environment-${kind}`;
  const makeMaterial = (name: string, color: number, roughness = .62, metalness = .1): THREE.MeshStandardMaterial => {
    const bytes = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < bytes.length; i += 4) {
      const v = rng.int(168, 255); bytes[i] = v; bytes[i + 1] = v; bytes[i + 2] = v; bytes[i + 3] = 255;
    }
    const patina = new THREE.DataTexture(bytes, 32, 32); patina.wrapS = patina.wrapT = THREE.RepeatWrapping; patina.needsUpdate = true;
    ownedTextures.push(patina);
    return new THREE.MeshStandardMaterial({ name, color, roughness, metalness, map: patina });
  };
  const shell = makeMaterial('aged-painted-enclosure', kind === 'fire-alarm' ? 0x782a20 : 0x99907d);
  const dark = makeMaterial('worn-bakelite', 0x151916, .35, .08), metal = makeMaterial('tarnished-steel', 0x656456, .4, .65);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Vector3Like = { x: 0, y: 0, z: 0 }, parent: THREE.Object3D = root) => {
    const o = new THREE.Mesh(g, m); o.position.copy(p); parent.add(o); return o;
  };
  const screw = (x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const s = mesh(new THREE.CylinderGeometry(.008, .008, .004, 8).rotateX(Math.PI / 2), metal, { x, y, z }, parent);
    const slot = mesh(new THREE.BoxGeometry(.009, .0018, .001), dark, { x: 0, y: 0, z: .003 }, s); slot.rotation.z = rng.float(-1, 1);
  };
  let head: THREE.Group | undefined, receiver: THREE.Group | undefined, lever: THREE.Group | undefined, lens: THREE.MeshBasicMaterial | undefined;
  if (kind === 'circuit-breaker') {
    mesh(roundedCase(.34, .48, .07), shell);
    mesh(roundedCase(.27, .39, .018), metal, { x: 0, y: 0, z: .085 });
    mesh(roundedCase(.085, .18, .012, .012), dark, { x: 0, y: -.01, z: .111 });
    lever = new THREE.Group(); lever.name = 'circuit-breaker-lever'; lever.position.set(0, -.01, .13); root.add(lever);
    mesh(new THREE.CylinderGeometry(.012, .012, .085, 12).rotateX(Math.PI / 2), metal, { x: 0, y: 0, z: .035 }, lever);
    mesh(roundedCase(.095, .037, .035, .01), dark, { x: 0, y: 0, z: .085 }, lever);
    for (const x of [-.14, .14]) for (const y of [-.21, .21]) screw(x, y, .092);
    // I/O marks are ordinary paint: no luminous hint in a dead circuit.
    mesh(new THREE.BoxGeometry(.004, .023, .002), dark, { x: 0, y: .155, z: .113 });
    mesh(new THREE.TorusGeometry(.013, .002, 5, 18), dark, { x: 0, y: -.158, z: .113 });
    for (const y of [-.24, .24]) mesh(new THREE.CylinderGeometry(.018, .018, .065, 10), metal, { x: 0, y, z: .035 });
  } else if (kind === 'fire-alarm') {
    mesh(roundedCase(.34, .46, .085), shell);
    mesh(roundedCase(.28, .25, .012, .025), dark, { x: 0, y: -.065, z: .093 });
    for (let i = 0; i < 9; i++) mesh(roundedCase(.235, .009, .006, .002), shell, { x: 0, y: -.16 + i * .023, z: .112 });
    lens = new THREE.MeshBasicMaterial({ name: 'red-strobe-lens', color: 0x430603, toneMapped: true });
    const beacon = mesh(new THREE.SphereGeometry(.078, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), lens, { x: 0, y: .135, z: .105 });
    beacon.scale.set(1, .58, .55);
    for (let i = -1; i <= 1; i++) mesh(new THREE.TorusGeometry(.067 - Math.abs(i) * .004, .002, 4, 24), metal, { x: 0, y: .135 + i * .018, z: .126 });
    for (const x of [-.14, .14]) for (const y of [-.2, .2]) screw(x, y, .095);
    // Stamped manufacturer's plate, with narrow engraved markings.
    mesh(roundedCase(.12, .022, .003, .003), metal, { x: 0, y: -.213, z: .099 });
    for (let i = 0; i < 7; i++) mesh(new THREE.BoxGeometry(.008, .009, .002), dark, { x: -.045 + i * .014, y: -.213, z: .107 });
  } else if (kind === 'telephone') {
    mesh(roundedCase(.27, .43, .075, .045), shell);
    const dial = mesh(new THREE.CylinderGeometry(.091, .099, .018, 40).rotateX(Math.PI / 2), metal, { x: 0, y: -.055, z: .107 });
    mesh(new THREE.CylinderGeometry(.037, .037, .021, 28).rotateX(Math.PI / 2), shell, { x: 0, y: 0, z: .012 }, dial);
    for (let i = 0; i < 10; i++) {
      const a = -.5 + i * Math.PI * .165;
      mesh(new THREE.CylinderGeometry(.012, .012, .023, 12).rotateX(Math.PI / 2), dark, { x: Math.sin(a) * .067, y: Math.cos(a) * .067, z: .013 }, dial);
    }
    const stop = mesh(new THREE.BoxGeometry(.012, .037, .028), metal, { x: .079, y: -.104, z: .125 }); stop.rotation.z = -.6;
    mesh(roundedCase(.13, .035, .004, .003), dark, { x: 0, y: -.181, z: .082 });
    for (const x of [-.085, .085]) mesh(new THREE.CylinderGeometry(.008, .008, .065, 8).rotateX(Math.PI / 2), metal, { x, y: .124, z: .115 });
    receiver = new THREE.Group(); receiver.name = 'telephone-handset'; receiver.position.set(0, .145, .125); root.add(receiver);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-.13, -.012, 0), new THREE.Vector3(-.105, .025, .012), new THREE.Vector3(0, .042, .025), new THREE.Vector3(.105, .025, .012), new THREE.Vector3(.13, -.012, 0)]);
    mesh(new THREE.TubeGeometry(curve, 20, .021, 10, false), dark, { x: 0, y: 0, z: 0 }, receiver);
    for (const sign of [-1, 1]) {
      const ear = mesh(new THREE.CylinderGeometry(.038, .033, .049, 18).rotateX(Math.PI / 2), dark, { x: sign * .127, y: -.013, z: .01 }, receiver);
      for (let i = 0; i < 7; i++) {
        const a = i * Math.PI * 2 / 7;
        mesh(new THREE.SphereGeometry(.0027, 5, 4), metal, { x: Math.sin(a) * .021, y: Math.cos(a) * .021, z: .026 }, ear);
      }
    }
    const cord = Array.from({ length: 241 }, (_, i) => { const t = i / 240, a = t * Math.PI * 36; return new THREE.Vector3(-.13 + Math.sin(a) * .011, .12 - t * .58, .11 + Math.cos(a) * .011); });
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cord), 240, .003, 5, false), dark);
    screw(0, -.198, .085);
  } else {
    mesh(roundedCase(.16, .22, .035), metal);
    for (const x of [-.055, .055]) for (const y of [-.08, .08]) screw(x, y, .05);
    mesh(new THREE.CylinderGeometry(.021, .021, .24, 10).rotateX(Math.PI / 2), metal, { x: 0, y: -.04, z: .16 });
    mesh(new THREE.CylinderGeometry(.05, .05, .095, 16), metal, { x: 0, y: .015, z: .27 });
    head = new THREE.Group(); head.position.set(0, .085, .28); head.name = 'surveillance-gimbal'; root.add(head);
    const casing = mesh(roundedCase(.22, .17, .38, .026), shell, { x: 0, y: 0, z: -.08 }, head);
    mesh(roundedCase(.192, .138, .011, .018), dark, { x: 0, y: 0, z: .32 }, casing);
    mesh(new THREE.CylinderGeometry(.051, .054, .048, 24).rotateX(Math.PI / 2), dark, { x: 0, y: -.005, z: .36 }, casing);
    mesh(new THREE.TorusGeometry(.047, .003, 5, 24), metal, { x: 0, y: -.005, z: .39 }, casing);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x142325, metalness: .45, roughness: .08, clearcoat: 1 });
    mesh(new THREE.SphereGeometry(.041, 18, 10), glass, { x: 0, y: -.005, z: .369 }, casing).scale.z = .22;
    mesh(new THREE.BoxGeometry(.26, .012, .44), shell, { x: 0, y: .095, z: .15 }, casing);
    lens = new THREE.MeshBasicMaterial({ color: 0x480b04 });
    mesh(new THREE.SphereGeometry(.004, 8, 6), lens, { x: .075, y: .047, z: .335 }, casing);
    for (let i = 0; i < 7; i++) mesh(new THREE.BoxGeometry(.003, .065, .018), dark, { x: .111, y: -.02, z: -.025 + i * .032 }, casing);
    const lead = new THREE.CatmullRomCurve3([new THREE.Vector3(-.03, -.02, .015), new THREE.Vector3(-.08, -.14, .15), new THREE.Vector3(-.06, -.02, .25)]);
    mesh(new THREE.TubeGeometry(lead, 12, .006, 6, false), dark);
  }
  const materials = new Set<THREE.Material>([shell, dark, metal]);
  root.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
  return { root, head, receiver, lever, lens, dispose() {
    root.removeFromParent(); root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    materials.forEach(m => m.dispose()); ownedTextures.forEach(t => t.dispose()); root.clear();
  } };
};
