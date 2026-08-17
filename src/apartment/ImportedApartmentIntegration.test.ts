import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  APARTMENT_LIGHTS_OFF_SURFACE_FACTOR,
  closeDoorLeafWithBackFace,
  createApartmentDoorHardwareMaterial,
  createApartmentMainLight,
  hideObjectsRestingOnSupport,
  makeApartmentMainFixtureLuminous,
  makeApartmentWindowGlassTransparent,
  preciseBoxFromObject,
  suppressApartmentLightGlare,
  trimDoorFrameOverhang,
} from './ImportedApartmentEnvironment';

const loadNodeFs = async () => {
  // Test-only builtin; the browser tsconfig intentionally omits Node globals.
  // @ts-expect-error Node typings are not a production dependency.
  return import('node:fs/promises');
};

interface SerializedObject {
  name?: string;
  children?: SerializedObject[];
}

const objectNames = (root: SerializedObject): string[] => [
  root.name ?? '',
  ...(root.children ?? []).flatMap(objectNames),
];

describe('imported apartment integration', () => {
  it('closes the hollow entrance leaf with a flush rear face', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      // Decorated front.
      0.04, 0, -0.45, 0.04, 2, -0.45, 0.04, 2, 0.45, 0.04, 0, 0.45,
      // Top edge.
      0, 2, -0.45, 0.04, 2, -0.45, 0.04, 2, 0.45, 0, 2, 0.45,
      // Latch edge.
      0, 0, 0.45, 0.04, 0, 0.45, 0.04, 2, 0.45, 0, 2, 0.45,
      // Hinge edge.
      0, 0, -0.45, 0, 2, -0.45, 0.04, 2, -0.45, 0.04, 0, -0.45,
    ], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(48).fill(0), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(32).fill(0), 2));
    geometry.setIndex([
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
      8, 9, 10, 8, 10, 11,
      12, 13, 14, 12, 14, 15,
    ]);
    const leaf = new THREE.Group();
    leaf.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));

    const backFace = closeDoorLeafWithBackFace(leaf);

    expect(backFace?.name).toBe('front-door-authored-back-face');
    const box = new THREE.Box3().setFromObject(backFace!);
    expect(box.min.x).toBeCloseTo(0, 6);
    expect(box.max.x).toBeCloseTo(0, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(2, 6);
    expect(box.min.z).toBeCloseTo(-0.45, 6);
    expect(box.max.z).toBeCloseTo(0.45, 6);
  });

  it('suppresses sharp interior highlights without disabling local lights', () => {
    const roughnessMap = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.08,
      metalness: 0.82,
      roughnessMap,
      emissive: 0xffffff,
      emissiveIntensity: 2.4,
      envMapIntensity: 1.7,
    });

    suppressApartmentLightGlare(material);

    expect(material.roughness).toBe(0.72);
    expect(material.metalness).toBe(0.18);
    expect(material.roughnessMap).toBeNull();
    expect(material.emissiveIntensity).toBe(0.28);
    expect(material.envMapIntensity).toBe(0.25);
    material.dispose();
    roughnessMap.dispose();
  });

  it('uses one wide ceiling light centered just below the real fixture', () => {
    const fixtureBox = new THREE.Box3(
      new THREE.Vector3(-6.58, 11.44, -2.88),
      new THREE.Vector3(-6.24, 11.53, -2.54),
    );

    const light = createApartmentMainLight(fixtureBox);

    expect(light.name).toBe('imported-apartment-main-ceiling-light');
    expect(light.position.x).toBeCloseTo(-6.41, 5);
    expect(light.position.y).toBeCloseTo(11.16, 5);
    expect(light.position.z).toBeCloseTo(-2.71, 5);
    expect(light.distance).toBe(14);
    expect(light.decay).toBe(1);
    expect(light.castShadow).toBe(false);
  });

  it('makes the actual fixture visibly luminous without metallic glare', () => {
    const fixture = new THREE.Mesh(
      new THREE.SphereGeometry(0.15),
      new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.2, metalness: 0.8 }),
    );

    makeApartmentMainFixtureLuminous(fixture);

    const material = fixture.material as THREE.MeshStandardMaterial;
    expect(material.name).toBe('apartment-main-fixture-luminous');
    expect(material.emissive.getHex()).toBe(0xffd9a6);
    expect(material.emissiveIntensity).toBe(1.05);
    expect(material.roughness).toBe(0.72);
    expect(material.metalness).toBe(0.08);
  });

  it('uses a separate satin-metal finish for handles instead of the brown door material', () => {
    const material = createApartmentDoorHardwareMaterial();

    expect(material.name).toBe('apartment-door-hardware-brushed-nickel');
    expect(material.color.getHex()).toBe(0x9aa1a8);
    expect(material.map).toBeNull();
    expect(material.roughness).toBe(0.34);
    expect(material.metalness).toBe(0.82);
    expect(material.polygonOffset).toBe(true);
  });

  it('ships the attributed apartment without unlicensed editor additions', async () => {
    const { readFile } = await loadNodeFs();
    const file = new URL('../../public/assets/imported-apartment/apartment.json', import.meta.url);
    const data = JSON.parse(await readFile(file, 'utf8')) as { object: SerializedObject };
    const names = objectNames(data.object);

    expect(data.object.name).toBe('ImportedApartmentScene_v1.19.2');
    expect(data.object.children?.map((child) => child.name)).toEqual([
      'Sketchfab_model_v1.19.1_EDITABLE',
    ]);
    expect(names).toEqual(expect.arrayContaining([
      'DOOR',
      'Doorframe',
      'bathroom_door',
      'closet_door',
      'Base',
    ]));
    expect(names).not.toContain('world');
  });

  it('keeps imported frame stabilization and only the entrance interactive', async () => {
    const { readFile } = await loadNodeFs();
    const environment = await readFile(
      new URL('./ImportedApartmentEnvironment.ts', import.meta.url),
      'utf8',
    );
    const runtime = await readFile(
      new URL('../core/RussianStairwellGame.ts', import.meta.url),
      'utf8',
    );

    expect(environment).toContain('forceOpaqueTwoSided(entryLeaf)');
    expect(environment).toContain('stabilizeDoorFrame(entryFrame)');
    expect(environment).toContain('trimDoorFrameOverhang(entryFrame, APARTMENT_ENTRY_DOOR.width)');
    expect(environment).toContain("interiorHandle.name = 'front-door-interior-handle-metal-overlay'");
    expect(environment).toContain('mirroredHandle.position.x -= 0.012');
    expect(environment).not.toContain('mirroredHandle.position.x += 0.03');
    expect(environment).toContain('clone.polygonOffset = true');
    expect(environment).toContain("'imported-bathroom-door-static'");
    expect(environment).toContain("'imported-closet-door-static'");
    expect(runtime).toContain("chunkKey: 'imported-apartment-entry-door'");
    expect(runtime).not.toContain("chunkKey: 'imported-bathroom-door'");
  });

  it('trims the imported frame casing without changing its depth', () => {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 2.25, 1.2),
      new THREE.MeshStandardMaterial(),
    );
    frame.position.set(-2.02, 9.8, -2.71);
    const before = new THREE.Box3().setFromObject(frame).getSize(new THREE.Vector3());

    trimDoorFrameOverhang(frame, 0.924, 0.018);

    const after = new THREE.Box3().setFromObject(frame).getSize(new THREE.Vector3());
    expect(after.z).toBeCloseTo(0.96, 5);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('computes tight bounds from transformed vertices for thin doors', () => {
    const geometry = new THREE.BoxGeometry(0.85, 2.2, 0.08);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 4));
    const door = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    door.rotation.y = -Math.PI / 4;

    const loose = new THREE.Box3().setFromObject(door).getSize(new THREE.Vector3());
    const precise = preciseBoxFromObject(door).getSize(new THREE.Vector3());

    expect(loose.z).toBeGreaterThan(0.8);
    expect(precise.x).toBeCloseTo(0.85, 5);
    expect(precise.z).toBeCloseTo(0.08, 5);
  });

  it('hides only decor resting on the removed living-room table', () => {
    const room = new THREE.Group();
    const table = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 1));
    table.position.y = 0.25;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.3));
    basket.name = 'basket';
    basket.position.y = 0.6;
    const nearby = basket.clone();
    nearby.name = 'nearby';
    nearby.position.x = 1.5;
    room.add(table, basket, nearby);

    expect(hideObjectsRestingOnSupport(room, table)).toEqual(['basket']);
    expect(basket.visible).toBe(false);
    expect(nearby.visible).toBe(true);
  });

  it('moves the entrance bin inward, removes requested clutter and collides small furniture', async () => {
    const { readFile } = await loadNodeFs();
    const environment = await readFile(
      new URL('./ImportedApartmentEnvironment.ts', import.meta.url),
      'utf8',
    );

    expect(environment).toContain("moveObjectInWorld(requireObject(this.model, 'can'), new THREE.Vector3(-0.14, 0, 0))");
    expect(environment).toContain("const livingRoomTable = requireObject(this.model, 'table')");
    expect(environment).toContain("'pasted__polySurface26'");
    expect(environment).toContain("'chair'");
    expect(environment).toContain("'trashcan'");
    expect(environment).toContain("'can'");
    expect(environment).toContain('const box = preciseBoxFromObject(leaf)');
  });

  it('replaces only the apartment window panes with clear glass', () => {
    const root = new THREE.Group();
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0x000000 }),
    );
    pane.name = 'polySurface16_M_MainParts_0';
    const frame = pane.clone();
    frame.name = 'polySurface15_M_MainParts_0';
    root.add(pane, frame);

    makeApartmentWindowGlassTransparent(root);

    const glass = pane.material as unknown as THREE.MeshBasicMaterial;
    expect(glass).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(glass.name).toBe('apartment-window-reflection-free-glass');
    expect(glass.color.getHex()).toBe(0x000000);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBe(0.004);
    expect(glass.depthWrite).toBe(false);
    expect(glass.toneMapped).toBe(true);
    expect(frame.material).not.toBe(glass);
  });

  it('starts dark and mounts a visible wall switch beside the entrance', async () => {
    const { readFile } = await loadNodeFs();
    const environment = await readFile(
      new URL('./ImportedApartmentEnvironment.ts', import.meta.url),
      'utf8',
    );

    expect(environment).toContain("this.lightSwitch.name = 'apartment-light-switch'");
    expect(environment).toContain('this.lightSwitch.position.set(-2.13, this.floorY + 1.23, -2.04)');
    expect(environment.match(/new THREE\.PointLight\(0x[a-f0-9]+, 0,/g)).toHaveLength(1);
    expect(environment).toContain("requireObject(this.model, 'light1')");
    expect(environment).toContain('this.interiorLights = [{ light: mainLight, intensity: 1.35 }]');
    expect(environment).toContain("name: 'apartment-light-switch-visible-indicator'");
    expect(environment).toContain('setInteriorLightsEnabled(enabled: boolean)');
    expect(environment).toContain('rocker.rotation.z = enabled ? 0.16 : -0.16');
    expect(environment).not.toContain('rocker.position.y = enabled');
    expect(environment).toContain('this.prepareInteriorLightResponsiveMaterials()');
    expect(environment).toContain('state.material.color.copy(state.litColor).multiplyScalar(surfaceFactor)');
    expect(APARTMENT_LIGHTS_OFF_SURFACE_FACTOR).toBeLessThanOrEqual(0.15);
  });

  it('mounts a sliding security bolt on the apartment side of the entrance wall', async () => {
    const { readFile } = await loadNodeFs();
    const environment = await readFile(
      new URL('./ImportedApartmentEnvironment.ts', import.meta.url),
      'utf8',
    );

    expect(environment).toContain("this.doorLock.name = 'apartment-entry-door-wall-lock'");
    expect(environment).toContain('this.lightSwitch.position.x,');
    expect(environment).toContain('APARTMENT_ENTRY_DOOR.leafWidth * 0.5 + 0.075');
    expect(environment).toContain("lockCase.name = 'apartment-entry-door-lock-case'");
    expect(environment).toContain("keeper.name = 'apartment-entry-door-lock-keeper'");
    expect(environment).toContain("thumbGrip.name = 'apartment-entry-door-lock-thumb-grip'");
    expect(environment).toContain("this.doorLockBolt.name = 'apartment-entry-door-sliding-bolt'");
    expect(environment).toContain('this.doorLockBolt.position.z = locked ? -0.052 : 0.012');
    expect(environment).toContain('this.group.add(this.lightSwitch, this.doorLock)');
  });

  it('animates both imported blinds directly and preserves their individual closed sizes', async () => {
    const { readFile } = await loadNodeFs();
    const environment = await readFile(
      new URL('./ImportedApartmentEnvironment.ts', import.meta.url),
      'utf8',
    );

    expect(environment).toContain("requireObject(this.model, 'polySurface36')");
    expect(environment).toContain("requireObject(this.model, 'polySurface34')");
    expect(environment).not.toContain("requireObject(this.model, 'Curtain')");
    expect(environment).not.toContain("requireObject(this.model, 'Curtain1')");
    expect(environment).toContain("requireObject(this.model, 'Window2')");
    expect(environment).toContain("requireObject(this.model, 'Window')");
    expect(environment).toContain('pivot.attach(blind)');
    expect(environment).toContain('(blindBox.max.y - windowBox.min.y) / blindHeight');
    expect(environment).not.toContain('apartment-window-roller-blind-fabric');
  });
});
