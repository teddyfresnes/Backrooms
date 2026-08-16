import * as THREE from 'three';

export interface StairwellMaterialSet {
  upperPlaster: THREE.MeshStandardMaterial;
  lowerPaint: THREE.MeshStandardMaterial;
  landingTerrazzo: THREE.MeshStandardMaterial;
  stairTerrazzo: THREE.MeshStandardMaterial;
  slabUnderside: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  railing: THREE.MeshStandardMaterial;
  doorSteel: THREE.MeshStandardMaterial;
  doorInset: THREE.MeshStandardMaterial;
  frameMetal: THREE.MeshStandardMaterial;
  galvanized: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  windowFrame: THREE.MeshStandardMaterial;
  fixtureBody: THREE.MeshStandardMaterial;
  fixtureGlow: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  pipe: THREE.MeshStandardMaterial;
}

interface TextureSet {
  color: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

const configure = (
  texture: THREE.Texture,
  renderer: THREE.WebGLRenderer,
  repeatX: number,
  repeatY: number,
  color = false,
): THREE.Texture => {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const configureSet = (
  set: TextureSet,
  renderer: THREE.WebGLRenderer,
  repeatX: number,
  repeatY: number,
): TextureSet => ({
  color: configure(set.color, renderer, repeatX, repeatY, true),
  normal: configure(set.normal, renderer, repeatX, repeatY),
  roughness: configure(set.roughness, renderer, repeatX, repeatY),
});

const nameMaterials = (materials: StairwellMaterialSet): void => {
  for (const [name, material] of Object.entries(materials)) material.name = name;
};

export class StairwellMaterials {
  readonly materials: StairwellMaterialSet;
  private readonly textures: THREE.Texture[];

  private constructor(materials: StairwellMaterialSet, textures: THREE.Texture[]) {
    this.materials = materials;
    this.textures = textures;
  }

  static async load(
    renderer: THREE.WebGLRenderer,
    assetRoot = '/assets/stairwell/textures',
  ): Promise<StairwellMaterials> {
    const loader = new THREE.TextureLoader();
    const loadedTextures: THREE.Texture[] = [];
    const loadSet = async (prefix: string): Promise<TextureSet> => {
      const [color, normal, roughness] = await Promise.all([
        loader.loadAsync(`${assetRoot}/${prefix}-color.jpg`).then((texture) => {
          loadedTextures.push(texture);
          return texture;
        }),
        loader.loadAsync(`${assetRoot}/${prefix}-normal.jpg`).then((texture) => {
          loadedTextures.push(texture);
          return texture;
        }),
        loader.loadAsync(`${assetRoot}/${prefix}-roughness.jpg`).then((texture) => {
          loadedTextures.push(texture);
          return texture;
        }),
      ]);
      return { color, normal, roughness };
    };

    let textureSets: TextureSet[];
    try {
      textureSets = await Promise.all([
        loadSet('plaster'),
        loadSet('paint'),
        loadSet('tile'),
        loadSet('concrete'),
        loadSet('door'),
        loadSet('metal'),
        loadSet('rail'),
        loadSet('pipe'),
      ]);
    } catch (error) {
      loadedTextures.forEach((texture) => texture.dispose());
      throw error;
    }
    const [plaster, paint, terrazzo, concrete, door, metal, rail, pipe] = textureSets;

    configureSet(plaster, renderer, 0.32, 0.32);
    configureSet(paint, renderer, 0.42, 0.42);
    configureSet(terrazzo, renderer, 1.08, 1.08);
    configureSet(concrete, renderer, 0.72, 0.72);
    configureSet(door, renderer, 0.78, 0.78);
    configureSet(metal, renderer, 1.35, 1.35);
    configureSet(rail, renderer, 1.8, 1.8);
    configureSet(pipe, renderer, 2.4, 2.4);

    const terrazzoParameters = {
      map: terrazzo.color,
      normalMap: terrazzo.normal,
      roughnessMap: terrazzo.roughness,
      color: 0xa8a59d,
      normalScale: new THREE.Vector2(0.24, 0.24),
      roughness: 0.8,
      metalness: 0,
    } satisfies THREE.MeshStandardMaterialParameters;

    const concreteParameters = {
      map: concrete.color,
      normalMap: concrete.normal,
      roughnessMap: concrete.roughness,
      color: 0xc4c1b9,
      normalScale: new THREE.Vector2(0.15, 0.15),
      roughness: 0.94,
      metalness: 0,
    } satisfies THREE.MeshStandardMaterialParameters;

    const doorParameters = {
      map: door.color,
      normalMap: door.normal,
      roughnessMap: door.roughness,
      normalScale: new THREE.Vector2(0.12, 0.12),
      roughness: 0.76,
      metalness: 0.14,
    } satisfies THREE.MeshStandardMaterialParameters;

    const metalParameters = {
      map: metal.color,
      normalMap: metal.normal,
      roughnessMap: metal.roughness,
      normalScale: new THREE.Vector2(0.16, 0.16),
      roughness: 0.68,
      metalness: 0.32,
    } satisfies THREE.MeshStandardMaterialParameters;

    const materials: StairwellMaterialSet = {
      upperPlaster: new THREE.MeshStandardMaterial({
        map: plaster.color,
        normalMap: plaster.normal,
        roughnessMap: plaster.roughness,
        color: 0xd3cfc6,
        normalScale: new THREE.Vector2(0.055, 0.055),
        roughness: 0.95,
      }),
      lowerPaint: new THREE.MeshStandardMaterial({
        map: paint.color,
        normalMap: paint.normal,
        roughnessMap: paint.roughness,
        color: 0x73877d,
        normalScale: new THREE.Vector2(0.06, 0.06),
        roughness: 0.82,
      }),
      landingTerrazzo: new THREE.MeshStandardMaterial(terrazzoParameters),
      stairTerrazzo: new THREE.MeshStandardMaterial(terrazzoParameters),
      // Ces deux matériaux utilisent strictement les mêmes cartes et réglages :
      // le plafond d'un palier et le dessous d'une volée ont enfin le même rendu.
      slabUnderside: new THREE.MeshStandardMaterial(concreteParameters),
      ceiling: new THREE.MeshStandardMaterial(concreteParameters),
      railing: new THREE.MeshStandardMaterial({
        map: rail.color,
        normalMap: rail.normal,
        roughnessMap: rail.roughness,
        color: 0x4e565d,
        normalScale: new THREE.Vector2(0.18, 0.18),
        roughness: 0.66,
        metalness: 0.4,
      }),
      doorSteel: new THREE.MeshStandardMaterial({
        ...doorParameters,
        color: 0x6b655d,
      }),
      doorInset: new THREE.MeshStandardMaterial({
        ...doorParameters,
        color: 0x55514b,
        roughness: 0.8,
      }),
      frameMetal: new THREE.MeshStandardMaterial({
        ...metalParameters,
        color: 0x6c7278,
      }),
      galvanized: new THREE.MeshStandardMaterial({
        ...metalParameters,
        color: 0xb1b6b9,
        roughness: 0.56,
        metalness: 0.58,
      }),
      glass: new THREE.MeshStandardMaterial({
        color: 0xe8f2f7,
        roughness: 0.025,
        metalness: 0,
        transparent: true,
        opacity: 0.025,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      windowFrame: new THREE.MeshStandardMaterial({
        ...metalParameters,
        color: 0x646b72,
        roughness: 0.48,
        metalness: 0.22,
      }),
      fixtureBody: new THREE.MeshStandardMaterial({
        ...metalParameters,
        color: 0xcac8c0,
        roughness: 0.76,
        metalness: 0.14,
      }),
      fixtureGlow: new THREE.MeshStandardMaterial({
        color: 0xe7dfc8,
        emissive: 0xe1dac1,
        emissiveIntensity: 1.18,
        roughness: 0.55,
      }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x2e302f, roughness: 0.92 }),
      pipe: new THREE.MeshStandardMaterial({
        map: pipe.color,
        normalMap: pipe.normal,
        roughnessMap: pipe.roughness,
        color: 0x767e78,
        normalScale: new THREE.Vector2(0.16, 0.16),
        roughness: 0.73,
        metalness: 0.24,
      }),
    };

    nameMaterials(materials);
    const textures = [plaster, paint, terrazzo, concrete, door, metal, rail, pipe]
      .flatMap((set) => [set.color, set.normal, set.roughness]);
    return new StairwellMaterials(materials, textures);
  }

  dispose(): void {
    const uniqueMaterials = new Set(Object.values(this.materials));
    uniqueMaterials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
  }
}
