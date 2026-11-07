import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom';

export interface EscapeStreetBounds {
  readonly halfWidth: number;
  readonly floorY: number;
  /** Facade side (larger z) and far end (smaller z). */
  readonly nearZ: number;
  readonly endZ: number;
}

/** Dark, wet, overgrown verge: muddy greens and straw. */
const createGroundTexture = (random: SeededRandom, size = 256): THREE.DataTexture => {
  const data = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    const tone = random.float(0, 1), dry = random.float(0, 1) < 0.12;
    data[index * 4] = dry ? 74 + tone * 30 : 26 + tone * 22;
    data[index * 4 + 1] = dry ? 66 + tone * 24 : 40 + tone * 34;
    data[index * 4 + 2] = dry ? 34 + tone * 14 : 18 + tone * 12;
    data[index * 4 + 3] = 255;
  }
  // Blade strokes over the speckle, mostly along one direction.
  for (let stroke = 0; stroke < 2600; stroke += 1) {
    let x = random.float(0, size), y = random.float(0, size);
    const angle = random.float(-0.5, 0.5) + Math.PI * 0.5, length = random.int(3, 9), light = random.float(0.7, 1.35);
    for (let step = 0; step < length; step += 1) {
      const px = ((Math.floor(x) % size) + size) % size, py = ((Math.floor(y) % size) + size) % size, i = (py * size + px) * 4;
      data[i] = Math.min(255, 30 * light); data[i + 1] = Math.min(255, 62 * light); data[i + 2] = Math.min(255, 24 * light);
      x += Math.cos(angle); y += Math.sin(angle);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

/**
 * The street the escape runs into, gone to grass: a ground plane and a few
 * thousand instanced blades. There is no light out there, so it only shows
 * where the flashlight falls. Mounted hidden at load (its shaders warm with
 * the rest) and shown when the hall door opens.
 */
export class EscapeStreet {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(bounds: EscapeStreetBounds) {
    const random = new SeededRandom('escape-street').fork('grass');
    this.group.name = 'escape-street-grass';
    this.group.visible = false;
    const width = bounds.halfWidth * 2 + 6, length = bounds.nearZ - bounds.endZ + 6;
    const texture = createGroundTexture(random.fork('ground'));
    texture.repeat.set(width / 1.6, length / 1.6);
    const groundMaterial = new THREE.MeshStandardMaterial({ name: 'escape-grass-ground', map: texture, roughness: 0.92, metalness: 0, color: 0xb8c4a8 });
    const groundGeometry = new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.name = 'escape-grass-ground';
    ground.position.set(0, bounds.floorY + 0.005, (bounds.nearZ + bounds.endZ) * 0.5 - 3);
    ground.receiveShadow = false;
    this.group.add(ground);

    // A blade: a narrow bent triangle pair, tip leaning forward.
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.012, 0, 0, 0.012, 0, 0, -0.007, 0.09, 0.01,
      0.012, 0, 0, 0.007, 0.09, 0.01, -0.007, 0.09, 0.01,
      -0.007, 0.09, 0.01, 0.007, 0.09, 0.01, 0, 0.17, 0.045,
    ], 3));
    blade.computeVertexNormals();
    const bladeMaterial = new THREE.MeshStandardMaterial({ name: 'escape-grass-blades', color: 0x3f5a2a, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    const count = 7000;
    const blades = new THREE.InstancedMesh(blade, bladeMaterial, count);
    blades.name = 'escape-grass-blades';
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), euler = new THREE.Euler();
    const tint = new THREE.Color(), blades0 = random.fork('blades');
    for (let index = 0; index < count; index += 1) {
      position.set(blades0.float(-bounds.halfWidth - 1.5, bounds.halfWidth + 1.5), bounds.floorY, blades0.float(bounds.endZ - 1, bounds.nearZ - 0.15));
      euler.set(blades0.float(-0.25, 0.25), blades0.float(0, Math.PI * 2), blades0.float(-0.25, 0.25));
      rotation.setFromEuler(euler);
      const height = blades0.float(0.55, 1.6);
      scale.set(blades0.float(0.8, 1.4), height, height);
      matrix.compose(position, rotation, scale);
      blades.setMatrixAt(index, matrix);
      const dry = blades0.float(0, 1) < 0.15;
      blades.setColorAt(index, dry ? tint.setRGB(0.55, 0.5, 0.3) : tint.setRGB(blades0.float(0.7, 1.15), blades0.float(0.8, 1.2), blades0.float(0.7, 1)));
    }
    blades.instanceMatrix.needsUpdate = true;
    if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
    blades.computeBoundingSphere();
    this.group.add(blades);
    this.disposables.push(texture, groundMaterial, groundGeometry, blade, bladeMaterial, blades);
  }

  setVisible(visible: boolean): void { this.group.visible = visible; }

  dispose(): void {
    this.group.removeFromParent();
    for (const item of this.disposables) item.dispose();
  }
}
