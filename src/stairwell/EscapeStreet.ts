import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom';

export interface EscapeStreetBounds {
  readonly halfWidth: number;
  readonly floorY: number;
  /** Facade side (larger z) and far end (smaller z). */
  readonly nearZ: number;
  readonly endZ: number;
}

/** Ground tile size in metres: one texture repeat. */
const TILE = 5;
/** The verge reaches well past the fog on every side. */
const GROUND_HALF_WIDTH = 90;
const GROUND_DEPTH = 120;
const GRASS_HALF_WIDTH = 15;
const GRASS_FAR = 34;

/** Tileable value noise on a periodic lattice (seeded, never Math.random). */
class TileNoise {
  private readonly values: Float32Array;
  constructor(random: SeededRandom, private readonly period: number) {
    this.values = new Float32Array(period * period);
    for (let i = 0; i < this.values.length; i++) this.values[i] = random.float(0, 1);
  }
  private at(x: number, y: number): number {
    const p = this.period;
    return this.values[(((y % p) + p) % p) * p + (((x % p) + p) % p)]!;
  }
  sample(x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = this.at(x0, y0), b = this.at(x0 + 1, y0), c = this.at(x0, y0 + 1), d = this.at(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
}

interface GroundMaps { color: THREE.DataTexture; roughness: THREE.DataTexture; normal: THREE.DataTexture }

/**
 * A wet, trodden verge: patchy grass over mud, dead straw, a few puddles.
 * Colour, roughness (puddles shine under the torch) and a normal map all come
 * from the same tileable height field.
 */
const createGroundMaps = (random: SeededRandom, size = 512): GroundMaps => {
  const octaves = [new TileNoise(random.fork('o1'), 4), new TileNoise(random.fork('o2'), 9), new TileNoise(random.fork('o3'), 23), new TileNoise(random.fork('o4'), 61)];
  const patches = new TileNoise(random.fork('patches'), 6), straw = new TileNoise(random.fork('straw'), 17);
  const height = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  const grain = random.fork('grain');
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const h = octaves[0]!.sample(u * 4, v * 4) * 0.5 + octaves[1]!.sample(u * 9, v * 9) * 0.27 + octaves[2]!.sample(u * 23, v * 23) * 0.15 + octaves[3]!.sample(u * 61, v * 61) * 0.08;
    const grassMask = THREE.MathUtils.smoothstep(patches.sample(u * 6, v * 6) * 0.75 + h * 0.4, 0.42, 0.62);
    const puddle = THREE.MathUtils.smoothstep(0.34 - h, 0, 0.05);
    const dry = THREE.MathUtils.smoothstep(straw.sample(u * 17, v * 17), 0.68, 0.8) * grassMask;
    const speck = grain.float(0.82, 1.12);
    // Mud: dark brown-grey, wet. Grass: deep, desaturated olive. Straw: pale ochre.
    let r = THREE.MathUtils.lerp(46, 34, grassMask), g = THREE.MathUtils.lerp(38, 48, grassMask), b = THREE.MathUtils.lerp(30, 22, grassMask);
    r = THREE.MathUtils.lerp(r, 92, dry); g = THREE.MathUtils.lerp(g, 80, dry); b = THREE.MathUtils.lerp(b, 46, dry);
    const shade = (0.7 + h * 0.5) * speck * (1 - puddle * 0.45);
    color[i * 4] = Math.min(255, r * shade); color[i * 4 + 1] = Math.min(255, g * shade); color[i * 4 + 2] = Math.min(255, b * shade); color[i * 4 + 3] = 255;
    const roughness = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.62, 0.86, grassMask), 0.08, puddle);
    rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = Math.round(roughness * 255); rough[i * 4 + 3] = 255;
    height[i] = h * (1 - puddle) + grassMask * 0.08;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const left = height[y * size + ((x - 1 + size) % size)]!, right = height[y * size + ((x + 1) % size)]!;
    const up = height[((y - 1 + size) % size) * size + x]!, down = height[((y + 1) % size) * size + x]!;
    const nx = (left - right) * 6, ny = (up - down) * 6, length = Math.hypot(nx, ny, 1);
    normal[i * 4] = Math.round((nx / length * 0.5 + 0.5) * 255);
    normal[i * 4 + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
    normal[i * 4 + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    normal[i * 4 + 3] = 255;
  }
  const texture = (data: Uint8Array, srgb: boolean): THREE.DataTexture => {
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    if (srgb) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = 8; map.needsUpdate = true;
    return map;
  };
  return { color: texture(color, true), roughness: texture(rough, false), normal: texture(normal, false) };
};

/**
 * One tuft: seven thin, tapered, curved blades from a common root. Vertex
 * colours run from a dark base to a paler tip; the shader sways the upper
 * part with the wind (weight in the `sway` attribute).
 */
const createTuftGeometry = (random: SeededRandom): THREE.BufferGeometry => {
  const positions: number[] = [], colors: number[] = [], sway: number[] = [], indices: number[] = [];
  const segments = 3;
  for (let blade = 0; blade < 7; blade++) {
    const angle = blade / 7 * Math.PI * 2 + random.float(-0.4, 0.4);
    const lean = random.float(0.18, 0.55), height = random.float(0.22, 0.48), width = random.float(0.0045, 0.0075);
    const rootX = Math.cos(angle) * random.float(0.005, 0.035), rootZ = Math.sin(angle) * random.float(0.005, 0.035);
    const dirX = Math.cos(angle), dirZ = Math.sin(angle);
    // Blade face turned a little away from its lean so it is not a ribbon seen edge-on.
    const sideX = -dirZ * Math.cos(0.5) + dirX * Math.sin(0.5), sideZ = dirX * Math.cos(0.5) + dirZ * Math.sin(0.5);
    const base = positions.length / 3;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments, bend = lean * t * t * height;
      const x = rootX + dirX * bend, z = rootZ + dirZ * bend, y = height * t * (1 - lean * 0.25 * t);
      const half = width * (1 - t * 0.92);
      positions.push(x - sideX * half, y, z - sideZ * half, x + sideX * half, y, z + sideZ * half);
      const tone = THREE.MathUtils.lerp(0.28, 1, t);
      for (let k = 0; k < 2; k++) colors.push(tone * 0.92, tone, tone * 0.86);
      sway.push(t * t, t * t);
      if (s < segments) { const a = base + s * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Normals lean up: lit grass reads as a canopy, not as dark slivers.
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) {
    const n = new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)).lerp(new THREE.Vector3(0, 1, 0), 0.6).normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  return geometry;
};

/**
 * The street the escape runs into, gone to grass: a wide wet verge and dense
 * tufts. There is no light out there, so it only shows where the flashlight
 * and the faint moon fall. Mounted hidden at load (its shaders warm with the
 * rest) and shown when the hall door opens.
 */
export class EscapeStreet {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly wind = { value: 0 };

  constructor(bounds: EscapeStreetBounds) {
    const random = new SeededRandom('escape-street').fork('verge');
    this.group.name = 'escape-street-grass';
    this.group.visible = false;
    const maps = createGroundMaps(random.fork('ground'));
    const width = GROUND_HALF_WIDTH * 2, depth = GROUND_DEPTH;
    for (const map of [maps.color, maps.roughness, maps.normal]) map.repeat.set(width / TILE, depth / TILE);
    const groundMaterial = new THREE.MeshStandardMaterial({
      name: 'escape-verge-ground', map: maps.color, roughnessMap: maps.roughness, normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0,
    });
    // Only in front of the facade: under the hall it would fight its floor.
    const groundGeometry = new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).translate(0, 0, -depth / 2);
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.name = 'escape-verge-ground';
    ground.position.set(0, bounds.floorY + 0.004, bounds.nearZ - 0.02);
    ground.receiveShadow = true;
    this.group.add(ground);

    const tuft = createTuftGeometry(random.fork('tuft'));
    const grassMaterial = new THREE.MeshStandardMaterial({ name: 'escape-verge-grass', vertexColors: true, color: 0x4a6232, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
    grassMaterial.onBeforeCompile = shader => {
      shader.uniforms.uWind = this.wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 root = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 root = vec2(0.0);
        #endif
        float gust = sin(uWind * 1.7 + root.x * 0.9 + root.y * 0.6) * 0.6 + sin(uWind * 3.1 + root.y * 1.7) * 0.25;
        transformed.x += gust * sway * 0.05;
        transformed.z += cos(uWind * 2.3 + root.x * 1.3) * sway * 0.03;`);
    };
    grassMaterial.customProgramCacheKey = () => 'escape-verge-grass-wind';
    const placement = random.fork('tufts');
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), euler = new THREE.Euler();
    const tint = new THREE.Color();
    const transforms: THREE.Matrix4[] = [], tints: THREE.Color[] = [];
    // Dense along the run, thinning out to the sides and the far end; none under the doorway sill.
    const area = (GRASS_HALF_WIDTH * 2) * GRASS_FAR;
    for (let attempt = 0; attempt < area * 3.5; attempt++) {
      const x = placement.float(-GRASS_HALF_WIDTH, GRASS_HALF_WIDTH), along = placement.float(0.35, GRASS_FAR);
      const density = 1 - THREE.MathUtils.smoothstep(Math.abs(x), GRASS_HALF_WIDTH * 0.55, GRASS_HALF_WIDTH);
      if (placement.float(0, 1) > 0.35 + density * 0.65) continue;
      position.set(x, bounds.floorY, bounds.nearZ - along);
      euler.set(placement.float(-0.12, 0.12), placement.float(0, Math.PI * 2), placement.float(-0.12, 0.12));
      rotation.setFromEuler(euler);
      const size = placement.float(0.65, 1.35);
      scale.set(size * placement.float(0.8, 1.3), size * placement.float(0.75, 1.25), size * placement.float(0.8, 1.3));
      transforms.push(matrix.compose(position, rotation, scale).clone());
      const dry = placement.float(0, 1) < 0.12;
      tints.push(dry ? tint.setRGB(1.55, 1.3, 0.85).clone() : tint.setRGB(placement.float(0.78, 1.08), placement.float(0.85, 1.15), placement.float(0.75, 1)).clone());
    }
    const tufts = new THREE.InstancedMesh(tuft, grassMaterial, transforms.length);
    tufts.name = 'escape-verge-tufts';
    transforms.forEach((transform, index) => { tufts.setMatrixAt(index, transform); tufts.setColorAt(index, tints[index]!); });
    tufts.instanceMatrix.needsUpdate = true;
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    tufts.computeBoundingSphere();
    tufts.castShadow = false; tufts.receiveShadow = true;
    this.group.add(tufts);
    this.disposables.push(maps.color, maps.roughness, maps.normal, groundMaterial, groundGeometry, tuft, grassMaterial, tufts);
  }

  setVisible(visible: boolean): void { this.group.visible = visible; }

  /** Played time, for the wind in the grass. */
  update(elapsed: number): void { this.wind.value = elapsed; }

  dispose(): void {
    this.group.removeFromParent();
    for (const item of this.disposables) item.dispose();
  }
}
