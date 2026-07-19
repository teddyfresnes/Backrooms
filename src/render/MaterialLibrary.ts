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
      // The wallpaper albedo already carries most of the yellow. Keep the
      // material tint close to neutral so it reads as faded paper instead of
      // a second coat of saturated ochre.
      color: 0xf1efc9,
      emissive: 0x5c5826,
      emissiveIntensity: 0.032,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.94,
      metalness: 0,
      vertexColors: true,
      dithering: true,
    });

    const plaster = new THREE.MeshStandardMaterial({
      name: 'aged-painted-plaster',
      map: plasterColor,
      normalMap: plasterNormal,
      roughnessMap: plasterArm,
      color: 0xeee8af,
      emissive: 0x5c5920,
      emissiveIntensity: 0.026,
      normalScale: new THREE.Vector2(0.36, 0.36),
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
      dithering: true,
    });

    const floor = new THREE.MeshStandardMaterial({
      name: 'damp-yellow-carpet',
      map: carpetColor,
      normalMap: carpetNormal,
      roughnessMap: carpetArm,
      aoMap: carpetArm,
      aoMapIntensity: 0.14,
      // Lift the brown carpet albedo toward the same pale yellow family as
      // the walls while preserving all of its woven detail.
      color: 0xfaf5cc,
      emissive: 0x5d592f,
      emissiveIntensity: 0.024,
      normalScale: new THREE.Vector2(0.34, 0.34),
      roughness: 0.98,
      metalness: 0,
      dithering: true,
    });

    const ceiling = new THREE.MeshStandardMaterial({
      name: 'office-drop-ceiling',
      map: ceilingColor,
      normalMap: ceilingNormal,
      roughnessMap: ceilingArm,
      aoMap: ceilingArm,
      aoMapIntensity: 0.46,
      // Unlike the wallpaper, the ceiling albedo is almost white, so its
      // yellowing has to come from the material itself.
      color: 0xddd080,
      emissive: 0x827a32,
      emissiveIntensity: 0.027,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughness: 0.97,
      side: THREE.FrontSide,
      dithering: true,
    });

    const baseboard = new THREE.MeshStandardMaterial({
      name: 'yellowed-baseboard',
      // With no albedo texture, a pale tint is washed almost white by the
      // fluorescent fill. Use the carpet/wall midtone directly instead.
      color: 0xbeb574,
      emissive: 0x45411e,
      emissiveIntensity: 0.016,
      roughness: 0.9,
      metalness: 0,
      dithering: true,
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
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    const voidMaterial = new THREE.MeshBasicMaterial({ color: 0x020201, toneMapped: false });

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
      ],
    );
  }

  dispose(): void {
    this.textures.forEach((texture) => texture.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
  }
}
