import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import type { ApartmentQuest } from '../story/ApartmentQuest';
import type { ApartmentDeviceAudio, DeviceAudioPositions } from '../audio/ApartmentDeviceAudio';
import { SeededRandom } from '../world/SeededRandom';
import { geometryIslands } from './GeometryIslands';
import { burnerTop, GasFlame, panBase } from './GasFlame';

type Device = 'tv' | 'radio' | 'gas';
const boundsOf = (object?: THREE.Object3D) => object ? new THREE.Box3().setFromObject(object, true) : new THREE.Box3();
/** Original knob grips and bases are separate islands in the hob's own mesh. */
export function gasControlBounds(stove?: THREE.Object3D): THREE.Box3[] {
  if (!stove) return [];
  const appliance = boundsOf(stove), controls: THREE.Box3[] = [];
  stove.traverse(object => {
    const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
    for (const island of geometryIslands(mesh)) {
      const size = island.bounds.getSize(new THREE.Vector3()), center = island.bounds.getCenter(new THREE.Vector3());
      if (size.x > .065 || size.y > .065 || size.z > .065 || center.z > appliance.min.z + .12) continue;
      const existing = controls.find(box => Math.abs(box.getCenter(new THREE.Vector3()).x - center.x) < .035);
      if (existing) existing.union(island.bounds); else controls.push(island.bounds.clone());
    }
  });
  return controls.sort((a,b) => a.min.x - b.min.x);
}
export function apartmentDevicePositions(apartment: ImportedApartmentEnvironment): DeviceAudioPositions {
  const point = (object?: THREE.Object3D) => boundsOf(object).getCenter(new THREE.Vector3());
  return { tv: point(apartment.television), radio: point(apartment.radio), pc: point(apartment.computer), gas: point(apartment.pan ?? apartment.stove) };
}

/** A 256×192 original cartoon, drawn at 12 fps into the existing TV mesh.
 * CanvasTexture only: no renderer, camera, timer, or independent scene. */
export class TelevisionPicture {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private readonly context: CanvasRenderingContext2D;
  private readonly grain = document.createElement('canvas');
  private previous = -1;
  private previousOutage = false;
  private disposed = false;
  private readonly smile = new Image();
  private imageReady = false;
  readonly ready: Promise<void>;
  private finishReady: () => void = () => {};
  constructor() {
    this.canvas.width = 256; this.canvas.height = 192;
    this.context = this.canvas.getContext('2d')!;
    this.grain.width = 64; this.grain.height = 48;
    const ctx = this.grain.getContext('2d')!, data = ctx.createImageData(64, 48), random = new SeededRandom('bonne-nuit-vhs');
    for (let i = 0; i < data.data.length; i += 4) {
      const light = random.int(20, 230); data.data[i] = light; data.data[i + 1] = light; data.data[i + 2] = light; data.data[i + 3] = 38;
    }
    ctx.putImageData(data, 0, 0);
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false; this.texture.minFilter = THREE.LinearFilter;
    this.ready = new Promise(resolve => { this.finishReady = resolve; });
    this.smile.onload = () => { if(!this.disposed) { this.imageReady=true; this.previous=-1; } this.finishReady(); };
    this.smile.onerror = () => this.finishReady();
    this.smile.src='/assets/apartment/tv-pressure-smile.webp';
    this.draw(0, false);
  }
  draw(elapsed: number, outage: boolean): void {
    const frame = Math.floor(elapsed * 12); if (frame === this.previous && outage === this.previousOutage) return; this.previous = frame; this.previousOutage = outage;
    const c = this.context, t = frame / 12;
    c.fillStyle = outage ? '#2c3236' : '#7b8d88'; c.fillRect(0, 0, 256, 192);
    c.fillStyle = '#b6ae85'; c.beginPath(); c.ellipse(198, 38, 22, 22, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#424c48'; c.fillRect(185 + Math.sin(t * .7) * 2, 34, 4, 8); c.fillRect(201 + Math.sin(t * .7) * 2, 34, 4, 8);
    c.fillStyle = '#535f59'; c.fillRect(0, 125, 256, 67);
    for (let i = 0; i < 4; i++) {
      const x = i * 76 - (t * 7 % 76); c.fillStyle = '#64726a'; c.fillRect(x, 72, 36, 70);
      c.fillStyle = '#2d3d39'; c.fillRect(x + 10, 102, 16, 40);
      c.fillStyle = '#bcb485'; c.fillRect(x + 13, 111, 3, 3); c.fillRect(x + 21, 111, 3, 3);
    }
    const walk = Math.sin(t * 4), x = 111 + Math.sin(t * .25) * 10, y = 119 + Math.abs(walk) * 2;
    // The little paper rabbit never quite reaches any door.
    c.strokeStyle = '#c2b99a'; c.lineWidth = 7; c.beginPath(); c.moveTo(x - 5, y + 20); c.lineTo(x - 10 - walk * 8, 159);
    c.moveTo(x + 5, y + 20); c.lineTo(x + 10 + walk * 8, 159); c.stroke();
    c.fillStyle = '#a4a892'; c.beginPath(); c.ellipse(x, y + 4, 15, 22, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c7bea4'; c.beginPath(); c.ellipse(x, y - 20, 16, 15, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(x - 12, y - 56, 7, 30); c.fillRect(x + 5, y - 53, 7, 28);
    c.fillStyle = '#303c38'; const blink = frame % 71 < 3 ? 1 : 6;
    c.fillRect(x - 7, y - 23, 3, blink); c.fillRect(x + 4, y - 23, 3, blink);
    c.font = '10px monospace'; c.fillStyle = '#d0c9ae'; c.fillText('BONNE NUIT', 10, 18);
    if (outage && this.imageReady) { c.drawImage(this.smile, Math.sin(frame * .71) * .7, 0, 256, 192); }
    c.drawImage(this.grain, frame % 5 - 4, frame % 3 - 2, 264, 198);
    c.fillStyle = '#151d2636'; for (let line = 0; line < 192; line += 3) c.fillRect(0, line, 256, 1);
    const tracking = (frame * 3) % 192;
    c.drawImage(this.canvas, 0, tracking, 256, Math.min(5, 192 - tracking), 3, tracking, 256, Math.min(5, 192 - tracking));
    c.fillStyle = '#d4dcc533'; c.fillRect(0, tracking, 256, 1);
    this.texture.needsUpdate = true;
  }
  dispose(): void { this.disposed=true; this.smile.onload=this.smile.onerror=null; this.finishReady(); this.texture.dispose(); this.canvas.width = this.grain.width = 1; this.canvas.height = this.grain.height = 1; }
}

export class ApartmentDevices {
  private readonly created: THREE.Object3D[] = [];
  private readonly geometry = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly picture = new TelevisionPicture();
  private readonly screenMaterial = new THREE.MeshBasicMaterial({ color: 0, map: this.picture.texture, toneMapped: false, fog: false });
  private readonly pcMaterial = new THREE.MeshBasicMaterial({ color: 0, toneMapped: false, fog: false });
  private readonly radioMaterial = new THREE.MeshBasicMaterial({ color: 0x222018, toneMapped: false });
  private readonly flame: GasFlame;
  private readonly gasControls: THREE.Box3[];
  private readonly gasRay = new THREE.Ray();
  private readonly gasPoint = new THREE.Vector3();
  private readonly tvLight = new THREE.PointLight(0x9fc7d9, 0, 4.5, 1.6);
  private readonly radioLight = new THREE.PointLight(0xffc16c, 0, 2.1, 1.4);
  private readonly pcLight = new THREE.PointLight(0xa5c8bf, 0, 3.1, 1.4);
  private readonly gasLight = new THREE.PointLight(0x487eff, 0, 1.6, 1.8);
  private readonly ray = new THREE.Raycaster();
  private readonly direction = new THREE.Vector3();
  private readonly targets = new Map<Device, THREE.Object3D>();
  private readonly radioLocalCenter = new THREE.Vector3();
  private readonly radioPosition = new THREE.Vector3();
  private readonly tvScreen?: THREE.Mesh;
  private readonly originalScreen?: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] };
  private readonly pcTexture: THREE.CanvasTexture;
  private readonly pcCanvas: HTMLCanvasElement;
  private blueScreen=false;
  private hoverElapsed = .1;
  private prompted = false;
  private elapsed = 0;
  constructor(private readonly apartment: ImportedApartmentEnvironment, private readonly physics: PhysicsWorld,
    private readonly camera: THREE.Camera, private readonly ui: { setInteraction(label: string | null): void },
    private readonly quest: ApartmentQuest, private readonly audio: ApartmentDeviceAudio) {
    const positions = apartmentDevicePositions(apartment);
    this.materials.add(this.screenMaterial); this.materials.add(this.pcMaterial); this.materials.add(this.radioMaterial);
    const screen = apartment.television?.getObjectByName('90sTV_mat_screen_0') as THREE.Mesh | undefined;
    if (screen?.isMesh) {
      this.tvScreen = screen; this.originalScreen = { geometry: screen.geometry, material: screen.material };
      const geometry = screen.geometry.clone(), uv = geometry.getAttribute('uv');
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (let i = 0; i < uv.count; i++) { minU = Math.min(minU, uv.getX(i)); maxU = Math.max(maxU, uv.getX(i)); minV = Math.min(minV, uv.getY(i)); maxV = Math.max(maxV, uv.getY(i)); }
      for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, (v - minV) / (maxV - minV), (u - minU) / (maxU - minU)); }
      screen.geometry = geometry; screen.material = this.screenMaterial; this.geometry.add(geometry);
      this.targets.set('tv', apartment.television!);
    }
    if (apartment.radio) this.targets.set('radio', apartment.radio);
    const tv = positions.tv;
    this.tvLight.position.set(tv.x + .07, tv.y + .12, boundsOf(apartment.television).min.z - .14);
    this.radioLight.position.copy(positions.radio).add(new THREE.Vector3(0, .03, .2));
    // This overlay fits the two original screen triangles, inside the bezel.
    const pcScreen = this.mesh(new THREE.PlaneGeometry(.326, .253), this.pcMaterial);
    pcScreen.name = 'apartment-pc-powered-screen'; pcScreen.position.set(-7.0259, 9.7429, -5.4550);
    this.pcLight.position.set(-7.026, 9.76, -5.14);
    const pcCanvas = document.createElement('canvas'); this.pcCanvas=pcCanvas; pcCanvas.width = 256; pcCanvas.height = 196;
    const c = pcCanvas.getContext('2d')!; c.fillStyle = '#314b4a'; c.fillRect(0, 0, 256, 196);
    c.fillStyle = '#c4cabc'; c.fillRect(0, 177, 256, 19); c.font = '9px monospace'; c.fillStyle = '#182b2d'; c.fillText('VOSTOK 98', 7, 189); c.fillText('00:30', 214, 189);
    for (let i = 0; i < 4; i++) { c.fillStyle = '#c5b88f'; c.fillRect(16, 15 + i * 37, 14, 13); c.fillStyle = '#cbd2c0'; c.fillRect(12, 33 + i * 37, 27, 2); }
    this.pcTexture = new THREE.CanvasTexture(pcCanvas); this.pcTexture.colorSpace = THREE.SRGBColorSpace; this.pcTexture.generateMipmaps = false; this.pcTexture.minFilter = THREE.LinearFilter;
    this.pcMaterial.map = this.pcTexture;
    const radioBounds = boundsOf(apartment.radio), indicator = this.mesh(new THREE.BoxGeometry(.09, .013, .005), this.radioMaterial);
    indicator.name = 'apartment-radio-powered-dial'; indicator.position.set(positions.radio.x, positions.radio.y + .015, radioBounds.max.z + .003);
    if (apartment.radio) {
      this.radioLocalCenter.copy(positions.radio); apartment.radio.worldToLocal(this.radioLocalCenter);
      apartment.radio.attach(indicator);
      // Not under the radio: the interior model is hidden from the landing, and a
      // hidden light changes Three's light count, recompiling every lit shader.
      this.radioLight.position.applyMatrix4(apartment.group.matrixWorld.clone().invert()); apartment.group.add(this.radioLight);
    }
    this.gasControls = gasControlBounds(apartment.stove).map(box => box.expandByScalar(.008));
    if (apartment.stove) this.targets.set('gas', apartment.stove);
    const pan = boundsOf(apartment.pan), center = pan.getCenter(new THREE.Vector3());
    const base = panBase(apartment.pan) ?? { center: center.clone().setY(pan.min.y), radius: .08, bottomY: pan.min.y };
    const burner = burnerTop(apartment.stove, base);
    const gap = THREE.MathUtils.clamp(burner === null ? .022 : base.bottomY - burner, .012, .045);
    this.flame = new GasFlame(THREE.MathUtils.clamp(base.radius * .5, .03, .065), gap);
    this.flame.group.position.set(base.center.x, base.bottomY - gap, base.center.z); this.add(this.flame.group);
    this.geometry.add(this.flame.geometry); this.materials.add(this.flame.material);
    this.gasLight.position.set(base.center.x, base.bottomY - gap * .5, base.center.z);
    const meal = new THREE.Group(); meal.name = 'apartment-pan-food'; meal.position.set(base.center.x, pan.min.y + .071, base.center.z); this.add(meal);
    const food = new THREE.MeshStandardMaterial({ color: 0xc39248, roughness: .94 }); this.materials.add(food);
    const vegetables = new THREE.MeshStandardMaterial({ color: 0x617345, roughness: .92 }); this.materials.add(vegetables);
    const morsel = new THREE.BoxGeometry(.052, .017, .027); this.geometry.add(morsel);
    const random = new SeededRandom('apartment-meal');
    for (let i = 0; i < 14; i++) { const bit = new THREE.Mesh(morsel, i % 4 ? food : vegetables), a = random.float(0, Math.PI * 2), r = random.float(.01, .09); bit.position.set(Math.cos(a) * r, random.float(0, .008), Math.sin(a) * r); bit.rotation.y = a; meal.add(bit); }
    if (apartment.pan) { apartment.pan.updateWorldMatrix(true, false); apartment.pan.attach(meal); }
    this.tvLight.name = 'apartment-tv-light'; this.radioLight.name = 'apartment-radio-light'; this.pcLight.name = 'apartment-pc-light'; this.gasLight.name = 'apartment-gas-flame-light';
    for (const light of [this.tvLight, this.pcLight, this.gasLight]) { light.castShadow = false; this.add(light); }
    this.radioLight.castShadow = false; this.created.push(this.radioLight);
    this.update(0, false, false);
  }
  prepare(): Promise<void> { return this.picture.ready; }
  private add<T extends THREE.Object3D>(object: T): T { this.apartment.group.add(object); this.created.push(object); return object; }
  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometry.add(geometry); const mesh = new THREE.Mesh(geometry, material); mesh.userData.noBatch = true; return this.add(mesh);
  }
  private hit(allowRadio = true): Device | undefined {
    this.camera.getWorldDirection(this.direction); this.ray.set(this.camera.position, this.direction); this.ray.far = 2.35;
    let nearest = 2.35, selected: Device | undefined;
    for (const [device, root] of this.targets) {
      if (!allowRadio && device === 'radio') continue;
      root.updateWorldMatrix(true, true);
      let visible = true; for (let p: THREE.Object3D | null = root; p; p = p.parent) visible &&= p.visible;
      if (!visible) continue;
      let distance: number;
      if (device === 'gas') {
        this.gasRay.set(this.camera.position, this.direction);
        distance = Math.min(...this.gasControls.map(box => {
          const point = this.gasRay.intersectBox(box, this.gasPoint);
          return point ? point.distanceTo(this.camera.position) : Infinity;
        }));
      } else distance = this.ray.intersectObject(root, true)[0]?.distance ?? Infinity;
      if (distance >= nearest) continue;
      const wall = this.physics.world.castRay(new RAPIER.Ray(this.camera.position, this.direction), distance, true,
        undefined, undefined, undefined, undefined, this.physics.isInteractionObstacle);
      const selfRadio = device === 'radio' && (wall?.collider.parent()?.userData as { appliance?: string } | undefined)?.appliance === 'radio';
      if (wall && !selfRadio && wall.timeOfImpact + .04 < distance) continue;
      nearest = distance; selected = device;
    }
    return selected;
  }
  interact(allowRadio = true): boolean {
    const device = this.hit(allowRadio); if (!device) return false;
    this.audio.unlock();
    const state = this.quest.devices;
    this.updateRadioPosition();
    if ((device === 'tv' && !state.tvOn || device === 'radio' && !state.radioOn && !state.outageTriggered) && !this.quest.canUseMediaDevices) {
      // Refused before the meal is on: no switch, no power-on sound.
      this.ui.setInteraction('Le repas d’abord : allumer le gaz.'); this.prompted = true; return true;
    }
    if (device === 'tv') {
      const before = state.tvOn; this.quest.setTelevision(!state.tvOn);
      if (this.quest.devices.tvOn !== before) this.audio.televisionSwitch(this.quest.devices.tvOn);
    }
    if (device === 'radio') { this.audio.buttonClick(!state.radioOn); if (state.outageTriggered) this.audio.radioStatic(); else this.quest.setRadio(!state.radioOn); }
    if (device === 'gas') this.quest.setGas(!state.gasOn);
    // In particular, TV-off must pause Pressure in this input event.
    this.audio.sync(this.quest.devices, true); this.update(0, true, false); return true;
  }
  update(delta: number, active: boolean, canInteract: boolean): void {
    const state = this.quest.devices;
    this.updateRadioPosition();
    if (active) this.elapsed += delta;
    this.screenMaterial.color.setHex(state.tvOn ? 0xffffff : 0x000000);
    if(state.outageTriggered&&!this.blueScreen){
      this.blueScreen=true;const c=this.pcCanvas.getContext('2d')!;c.fillStyle='#052ba5';c.fillRect(0,0,256,196);
      c.font='bold 13px monospace';c.fillStyle='#e7e9ff';c.fillText('VOSTOK 98',12,24);c.font='10px monospace';
      for(const [i,line] of ['ERREUR FATALE','Le système a été arrêté.','','Défaillance d’alimentation','ARRET : 0x0000007A','','Aucune réponse du contrôleur.','Redémarrage impossible.'].entries())c.fillText(line,12,49+i*15);
      this.pcTexture.needsUpdate=true;
    }
    this.pcMaterial.color.setHex(state.outageTriggered?0xffffff:state.pcUsed ? 0xc9dfd7 : 0x000000);
    this.pcLight.color.setHex(state.outageTriggered?0x467dff:0xa5c8bf);
    this.radioMaterial.color.setHex(state.radioOn ? 0xe3a657 : 0x28231b);
    this.tvLight.intensity = state.tvOn ? 2.1 : 0; this.radioLight.intensity = state.radioOn ? .65 : 0; this.pcLight.intensity = state.outageTriggered ? .8 : state.pcUsed ? 1.35 : 0;
    this.flame.update(state.gasOn, this.elapsed, delta);
    this.gasLight.intensity = .8 * this.flame.intensity * (.9 + .1 * Math.sin(this.elapsed * 21));
    this.audio.sync(state, active, delta);
    if (state.tvOn && active) this.picture.draw(this.elapsed, state.outageTriggered && this.audio.pressureBroadcastReady);
    if (!canInteract) { if (this.prompted) this.ui.setInteraction(null); this.prompted = false; return; }
    this.hoverElapsed += delta; if (this.hoverElapsed < .075) return; this.hoverElapsed = 0;
    const device = this.hit();
    if (device) {
      const waiting = !this.quest.canUseMediaDevices;
      this.ui.setInteraction(device === 'tv' ? waiting && !state.tvOn ? 'TV · le repas d’abord (allumer le gaz)' : `${state.tvOn ? 'Éteindre' : 'Allumer'} la TV`
        : device === 'radio' ? state.outageTriggered ? 'Radio · parasites' : waiting && !state.radioOn ? 'Radio · le repas d’abord (allumer le gaz)' : `${state.radioOn ? 'Éteindre' : 'Allumer'} la radio`
        : `${state.gasOn ? 'Couper' : 'Allumer'} le gaz`); this.prompted = true;
    } else if (this.prompted) { this.ui.setInteraction(null); this.prompted = false; }
  }
  private updateRadioPosition(): void {
    if (!this.apartment.radio) return;
    this.apartment.radio.updateWorldMatrix(true, false);
    this.radioPosition.copy(this.radioLocalCenter); this.apartment.radio.localToWorld(this.radioPosition);
    this.audio.moveRadio(this.radioPosition);
  }
  dispose(): void {
    if (this.tvScreen && this.originalScreen) { this.tvScreen.geometry = this.originalScreen.geometry; this.tvScreen.material = this.originalScreen.material; }
    for (const object of this.created) object.removeFromParent();
    for (const geometry of this.geometry) geometry.dispose(); for (const material of this.materials) material.dispose();
    this.pcTexture.dispose(); this.picture.dispose(); this.targets.clear(); this.created.length = 0;
  }
}
