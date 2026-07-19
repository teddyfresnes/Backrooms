import * as THREE from 'three';

export interface MaterialSet {
  wall: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  baseboard: THREE.MeshStandardMaterial;
  pitWall: THREE.MeshStandardMaterial;
  pitBottom: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  fixtureFrame: THREE.MeshStandardMaterial;
  fixtureGlow: THREE.MeshBasicMaterial;
  void: THREE.MeshBasicMaterial;
  stain: THREE.MeshBasicMaterial;
}

const configureTexture = (
  texture: THREE.Texture,
  anisotropy: number,
  color = false,
): THREE.Texture => {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const makeStainAlpha = (): THREE.CanvasTexture => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable.');
  const image = context.createImageData(size, size);
  let state = 0x9e3779b9;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x / size - 0.5) * 2;
      const ny = (y / size - 0.5) * 2;
      const angle = Math.atan2(ny, nx);
      const radius = Math.hypot(nx * 0.82, ny * 1.12);
      const irregular =
        Math.sin(angle * 3 + 1.2) * 0.08 +
        Math.sin(angle * 7 - 0.7) * 0.045 +
        Math.sin(angle * 13 + 2.5) * 0.025;
      const edge = THREE.MathUtils.smoothstep(1 - radius + irregular, -0.08, 0.36);
      const mottling = 0.68 + random() * 0.32;
      const index = (y * size + x) * 4;
      image.data[index] = 255;
      image.data[index + 1] = 255;
      image.data[index + 2] = 255;
      image.data[index + 3] = Math.floor(255 * edge * mottling);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
};

export class MaterialLibrary {
  private constructor(readonly materials: MaterialSet, readonly textures: THREE.Texture[]) {}

  static async load(
    renderer: THREE.WebGLRenderer,
    onProgress?: (ratio: number) => void,
  ): Promise<MaterialLibrary> {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => onProgress?.(total === 0 ? 0 : loaded / total);
    const loader = new THREE.TextureLoader(manager);
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const base = '/assets/textures';

    const paths = {
      wallpaper: `${base}/wallpaper/backrooms-wallpaper-generated.webp`,
      plasterColor: `${base}/plaster/plaster-color.webp`,
      plasterNormal: `${base}/plaster/plaster-normal-gl.webp`,
      plasterArm: `${base}/plaster/plaster-arm.webp`,
      carpetColor: `${base}/carpet/carpet-color-v2.webp`,
      carpetNormal: `${base}/carpet/carpet-normal-gl.webp`,
      carpetArm: `${base}/carpet/carpet-arm.webp`,
      ceilingColor: `${base}/ceiling/ceiling-color.webp`,
      ceilingNormal: `${base}/ceiling/ceiling-normal-gl.webp`,
      ceilingArm: `${base}/ceiling/ceiling-arm.webp`,
    };

    const [
      wallpaper,
      plasterColor,
      plasterNormal,
      plasterArm,
      carpetColor,
      carpetNormal,
      carpetArm,
      ceilingColor,
      ceilingNormal,
      ceilingArm,
    ] = await Promise.all(
      Object.entries(paths).map(async ([key, path]) =>
        configureTexture(
          await loader.loadAsync(path),
          anisotropy,
          key.endsWith('Color') || key === 'wallpaper',
        ),
      ),
    );

    carpetArm.channel = 0;
    ceilingArm.channel = 0;

    const wall = new THREE.MeshStandardMaterial({
      name: 'aged-wallpaper',
      map: wallpaper,
      normalMap: plasterNormal,
      roughnessMap: plasterArm,
      color: 0xffefb0,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.94,
      metalness: 0,
      vertexColors: true,
    });

    const plaster = new THREE.MeshStandardMaterial({
      name: 'aged-painted-plaster',
      map: plasterColor,
      normalMap: plasterNormal,
      roughnessMap: plasterArm,
      color: 0xebd693,
      normalScale: new THREE.Vector2(0.36, 0.36),
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
    });

    const floor = new THREE.MeshStandardMaterial({
      name: 'damp-yellow-carpet',
      map: carpetColor,
      normalMap: carpetNormal,
      roughnessMap: carpetArm,
      aoMap: carpetArm,
      aoMapIntensity: 0.14,
      color: 0xf7e9bd,
      normalScale: new THREE.Vector2(0.34, 0.34),
      roughness: 0.98,
      metalness: 0,
    });

    const ceiling = new THREE.MeshStandardMaterial({
      name: 'office-drop-ceiling',
      map: ceilingColor,
      normalMap: ceilingNormal,
      roughnessMap: ceilingArm,
      aoMap: ceilingArm,
      aoMapIntensity: 0.28,
      color: 0xf0dda4,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughness: 0.97,
      side: THREE.FrontSide,
    });

    const baseboard = new THREE.MeshStandardMaterial({
      name: 'yellowed-baseboard',
      color: 0xc8b36f,
      roughness: 0.9,
      metalness: 0,
    });
    const pitWall = new THREE.MeshStandardMaterial({
      name: 'pit-plaster',
      map: plasterColor,
      normalMap: plasterNormal,
      roughnessMap: plasterArm,
      color: 0x8a7c4e,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 1,
    });
    const pitBottom = new THREE.MeshStandardMaterial({
      name: 'pit-darkness',
      color: 0x080806,
      roughness: 1,
      metalness: 0,
    });
    const metal = new THREE.MeshStandardMaterial({
      name: 'oxidized-trim',
      color: 0x4c4938,
      roughness: 0.68,
      metalness: 0.58,
    });
    const fixtureFrame = new THREE.MeshStandardMaterial({
      name: 'fluorescent-frame',
      color: 0xd6d2b3,
      roughness: 0.78,
      metalness: 0.03,
    });
    const fixtureGlow = new THREE.MeshBasicMaterial({
      name: 'fluorescent-diffuser',
      color: 0xfffee6,
      toneMapped: false,
      fog: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });
    const voidMaterial = new THREE.MeshBasicMaterial({ color: 0x020201, toneMapped: false });
    const stainTexture = makeStainAlpha();
    const stain = new THREE.MeshBasicMaterial({
      name: 'damp-carpet-stain',
      color: 0x2d2813,
      alphaMap: stainTexture,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
    });

    return new MaterialLibrary(
      {
        wall,
        plaster,
        floor,
        ceiling,
        baseboard,
        pitWall,
        pitBottom,
        metal,
        fixtureFrame,
        fixtureGlow,
        void: voidMaterial,
        stain,
      },
      [
        wallpaper,
        plasterColor,
        plasterNormal,
        plasterArm,
        carpetColor,
        carpetNormal,
        carpetArm,
        ceilingColor,
        ceilingNormal,
        ceilingArm,
        stainTexture,
      ],
    );
  }

  dispose(): void {
    this.textures.forEach((texture) => texture.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
  }
}
