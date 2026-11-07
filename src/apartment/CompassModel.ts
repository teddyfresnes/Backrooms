import * as THREE from 'three';

/** Pocket compass, 5.4 cm across, in the hand's palm frame: the dial faces +Y,
 * the dial's N and the lid hinge are at -Z (away from the holder), the bow at +Z.
 * Units are metres. */
export const COMPASS_RADIUS = 0.027;
export const COMPASS_NEEDLE = 'compass-needle';
export const COMPASS_LID = 'compass-lid';
/** Lid swung open, standing behind the dial like a held hunter case. */
export const COMPASS_LID_OPEN = -1.92;

const dialTexture = (): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const c = size / 2;
  // Aged enamel, a little darker toward the rim.
  const enamel = context.createRadialGradient(c, c, 8, c, c, c);
  enamel.addColorStop(0, '#efe6cf'); enamel.addColorStop(0.82, '#e1d5b6'); enamel.addColorStop(1, '#b9aa86');
  context.fillStyle = enamel; context.fillRect(0, 0, size, size);
  context.strokeStyle = '#2a2219'; context.fillStyle = '#2a2219';
  context.lineCap = 'round';
  for (let degree = 0; degree < 360; degree += 5) {
    const angle = degree / 180 * Math.PI, major = degree % 30 === 0, mid = degree % 10 === 0;
    const outer = c - 10, inner = outer - (major ? 17 : mid ? 11 : 6);
    context.lineWidth = major ? 2.6 : mid ? 1.6 : 1;
    context.beginPath();
    context.moveTo(c + Math.sin(angle) * inner, c - Math.cos(angle) * inner);
    context.lineTo(c + Math.sin(angle) * outer, c - Math.cos(angle) * outer);
    context.stroke();
  }
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = '600 15px Georgia, "Times New Roman", serif';
  for (let degree = 30; degree < 360; degree += 30) {
    if (degree % 90 === 0) continue;
    const angle = degree / 180 * Math.PI, r = c - 42;
    context.save(); context.translate(c + Math.sin(angle) * r, c - Math.cos(angle) * r); context.rotate(angle);
    context.fillText(String(degree), 0, 0); context.restore();
  }
  context.font = '700 30px Georgia, "Times New Roman", serif';
  const letters: [string, number, string][] = [['N', 0, '#9c1f17'], ['E', 90, '#2a2219'], ['S', 180, '#2a2219'], ['O', 270, '#2a2219']];
  for (const [letter, degree, color] of letters) {
    const angle = degree / 180 * Math.PI, r = c - 46;
    context.save(); context.fillStyle = color; context.translate(c + Math.sin(angle) * r, c - Math.cos(angle) * r); context.rotate(angle);
    context.fillText(letter, 0, 1); context.restore();
  }
  // A fine compass rose under the needle.
  context.globalAlpha = 0.35; context.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * Math.PI * 2, r = i % 2 ? 34 : 56;
    context.beginPath(); context.moveTo(c, c); context.lineTo(c + Math.sin(angle) * r, c - Math.cos(angle) * r); context.stroke();
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

/** A small engraving inside the lid: « Pour me retrouver — C. » */
const lidTexture = (): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(size * 0.4, size * 0.38, 4, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, '#e9cf8e'); gradient.addColorStop(0.7, '#b8913f'); gradient.addColorStop(1, '#7c5e24');
  context.fillStyle = gradient; context.fillRect(0, 0, size, size);
  context.fillStyle = 'rgba(60,40,12,.78)'; context.textAlign = 'center';
  context.font = 'italic 15px Georgia, serif';
  context.fillText('Pour me', size / 2, size / 2 - 9);
  context.fillText('retrouver', size / 2, size / 2 + 8);
  context.font = 'italic 13px Georgia, serif';
  context.fillText('— C.', size / 2 + 16, size / 2 + 28);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

export function createCompassModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'quest-compass';
  const brass = new THREE.MeshStandardMaterial({ name: 'compass-brass', color: 0xb58b3a, roughness: 0.32, metalness: 0.92 });
  const darkBrass = new THREE.MeshStandardMaterial({ name: 'compass-brass-shadow', color: 0x6d5222, roughness: 0.45, metalness: 0.85 });
  const dialMap = dialTexture();
  const dial = new THREE.MeshStandardMaterial({ name: 'compass-dial', color: dialMap ? 0xffffff : 0xe3d7b8, map: dialMap, roughness: 0.62, metalness: 0 });
  const glass = new THREE.MeshPhysicalMaterial({
    name: 'compass-glass', color: 0xdfe9e6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18,
    clearcoat: 1, clearcoatRoughness: 0.04, depthWrite: false,
  });
  const red = new THREE.MeshStandardMaterial({ name: 'compass-needle-north', color: 0xa31d14, roughness: 0.4, metalness: 0.2, emissive: 0x2a0503 });
  const white = new THREE.MeshStandardMaterial({ name: 'compass-needle-south', color: 0xe8e4da, roughness: 0.45, metalness: 0.1 });
  const lidMap = lidTexture();
  const lidInside = new THREE.MeshStandardMaterial({ name: 'compass-lid-engraving', color: lidMap ? 0xffffff : 0xb8913f, map: lidMap, roughness: 0.38, metalness: 0.75 });

  // Case: a lathed brass pan with a rolled rim and a domed back.
  const R = COMPASS_RADIUS;
  const caseProfile = [
    [0, -0.0062], [R * 0.55, -0.0058], [R * 0.86, -0.0046], [R * 0.98, -0.003], [R * 1.04, -0.001],
    [R * 1.06, 0.0018], [R * 1.05, 0.0042], [R * 1.0, 0.0052], [R * 0.93, 0.0049], [R * 0.92, 0.0012],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(caseProfile, 48), brass);
  shell.name = 'compass-case';
  group.add(shell);
  // Knurled bezel: thin rings around the rim.
  const knurl = new THREE.Mesh(new THREE.TorusGeometry(R * 1.055, 0.0011, 6, 64), darkBrass);
  knurl.rotation.x = Math.PI / 2; knurl.position.y = 0.0016; group.add(knurl);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(R * 0.965, 0.0013, 8, 64), brass);
  bezel.rotation.x = Math.PI / 2; bezel.position.y = 0.0051; group.add(bezel);
  // Dial, sunk below the rim.
  const face = new THREE.Mesh(new THREE.CircleGeometry(R * 0.92, 48).rotateX(-Math.PI / 2), dial);
  face.name = 'compass-dial'; face.position.y = 0.0014; group.add(face);

  // Needle on its jewel: a thin lozenge, red to the north.
  const needle = new THREE.Group();
  needle.name = COMPASS_NEEDLE; needle.position.y = 0.0028;
  const half = (length: number, material: THREE.Material, sign: number): THREE.Mesh => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.0026, 0); shape.lineTo(0, length * sign); shape.lineTo(0.0026, 0); shape.lineTo(-0.0026, 0);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.0006, bevelEnabled: true, bevelThickness: 0.0002, bevelSize: 0.0002, bevelSegments: 1 });
    geometry.rotateX(Math.PI / 2);
    return new THREE.Mesh(geometry, material);
  };
  needle.add(half(R * 0.78, red, -1), half(R * 0.7, white, 1));
  const jewel = new THREE.Mesh(new THREE.CylinderGeometry(0.0021, 0.0026, 0.0016, 16), brass);
  jewel.position.y = 0.0005; needle.add(jewel);
  group.add(needle);

  const crystal = new THREE.Mesh(new THREE.SphereGeometry(R * 3.2, 32, 6, 0, Math.PI * 2, 0, 0.3), glass);
  crystal.position.y = 0.0049 - R * 3.2 * Math.cos(0.3) + 0.0012;
  crystal.name = 'compass-crystal'; crystal.renderOrder = 2; group.add(crystal);

  // Crown and bow on the holder's side, resting in the palm.
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.005, 12).rotateX(Math.PI / 2), brass);
  stem.position.set(0, 0.0005, R * 1.12); group.add(stem);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.0032, 18).rotateX(Math.PI / 2), darkBrass);
  crown.position.set(0, 0.0005, R * 1.25); group.add(crown);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.0062, 0.0011, 8, 28), brass);
  bow.position.set(0, 0.0005, R * 1.25 + 0.0076); bow.rotation.x = Math.PI / 2; group.add(bow);

  // Lid hinged on the far edge: open, it stands behind the dial, engraving to the holder.
  const lid = new THREE.Group();
  lid.name = COMPASS_LID; lid.position.set(0, 0.0052, -R * 1.02);
  const lidShell = new THREE.Mesh(new THREE.LatheGeometry([
    [0, 0.0032], [R * 0.6, 0.0029], [R * 0.92, 0.002], [R * 1.04, 0.0006], [R * 1.05, -0.0008], [R * 0.98, -0.0009],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 48), brass);
  lidShell.position.z = R * 1.02; lid.add(lidShell);
  const engraving = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 40).rotateX(Math.PI / 2), lidInside);
  engraving.position.set(0, -0.0006, R * 1.02); lid.add(engraving);
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.012, 12).rotateZ(Math.PI / 2), darkBrass);
  lid.add(hinge);
  lid.rotation.x = COMPASS_LID_OPEN;
  group.add(lid);

  group.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = false; } });
  return group;
}

export function disposeObjectTree(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
    material.dispose();
  }
}
