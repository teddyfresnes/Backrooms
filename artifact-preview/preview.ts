import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import compressedAssets from './preview-assets.mjs';
import { setMemoryAssets } from './memory-assets';
import { CharacterRuntime } from '../src/character/CharacterRuntime';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { PlayerController } from '../src/player/PlayerController';
import { defaultGameSettings } from '../src/ui/settings';
import { viewmodelCommand } from '../src/character/ViewmodelCommand';
import { SeededRandom } from '../src/world/SeededRandom';
import type { StaticCollider, WorldPlan } from '../src/world/types';

const root = document.getElementById('backrooms-artifact')!;
const status = root.querySelector<HTMLElement>('[data-status]')!;
const command = root.querySelector<HTMLFormElement>('[data-console]')!;
const commandInput = command.querySelector<HTMLInputElement>('input')!;
const feedback = root.querySelector<HTMLElement>('[data-feedback]')!;
let disposed = false;
let frame = 0;
let character: CharacterRuntime | undefined;
let player: PlayerController | undefined;
let physics: PhysicsWorld | undefined;
let renderer: THREE.WebGLRenderer | undefined;
let consoleOpen = false;
const teardown: Array<() => void> = [];
function listen(target: EventTarget, event: string, handler: EventListener, options?: AddEventListenerOptions) {
  target.addEventListener(event, handler, options);
  teardown.push(() => target.removeEventListener(event, handler, options));
}
const showError = (error: unknown) => {
  status.hidden = false;
  status.setAttribute('role', 'alert');
  status.textContent = error instanceof Error ? error.message : 'Aperçu indisponible dans ce navigateur.';
};

async function boot() {
  status.textContent = 'Préparation des animations…';
  const bytes = Uint8Array.from(atob(compressedAssets), character => character.charCodeAt(0));
  const decoded = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  setMemoryAssets(JSON.parse(await new Response(decoded).text()));
  await RAPIER.init();
  if (disposed) return;
  status.textContent = 'Préparation du personnage…';
  // The game already supplies deterministic procedural blood decals when image
  // textures are unavailable. Keep that path without making network requests.
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function(url, onLoad, progress, onError) {
    if (String(url).startsWith('/assets/blood/')) {
      const texture = new THREE.Texture();
      queueMicrotask(() => onError?.(new Error('Procedural decal fallback')));
      return texture;
    }
    return originalTextureLoad.call(this, url, onLoad, progress, onError);
  };
  teardown.push(() => { THREE.TextureLoader.prototype.load = originalTextureLoad; });

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor('#b2a36b');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Backrooms : personnages et mouvements intégrés');
  root.prepend(canvas);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#b2a36b', 14, 37);
  const playerCamera = new THREE.PerspectiveCamera(70, 1, .035, 70);
  const renderCamera = playerCamera.clone();
  const random = new SeededRandom('backrooms-conversation-preview');
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = textureCanvas.height = 128;
  const context = textureCanvas.getContext('2d')!;
  context.fillStyle = '#8b8052'; context.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 8000; i++) {
    context.fillStyle = random.chance(.5) ? '#9d9160' : '#766d47';
    context.fillRect(random.int(0, 127), random.int(0, 127), 1, 1);
  }
  const carpet = new THREE.CanvasTexture(textureCanvas);
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping; carpet.repeat.set(6, 6);
  carpet.colorSpace = THREE.SRGBColorSpace;
  const floorMaterial = new THREE.MeshStandardMaterial({ color: '#b9ad76', map: carpet, roughness: 1 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#bcb17c', roughness: .97 });
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#c4c1a2', roughness: 1 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: '#655f42', roughness: .93 });
  const colliders: StaticCollider[] = [];
  const staticMeshes: THREE.Mesh[] = [];
  const box = (id: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material, kind: StaticCollider['kind'] = 'wall') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z); mesh.receiveShadow = true;
    mesh.castShadow = kind !== 'floor'; scene.add(mesh); staticMeshes.push(mesh);
    colliders.push({ id, center: { x, y, z }, halfExtents: { x: sx / 2, y: sy / 2, z: sz / 2 }, kind });
    return mesh;
  };
  const floorRect = (id: string, minX: number, maxX: number, minZ: number, maxZ: number, y = 0) => box(id, (minX + maxX) / 2, y - .15, (minZ + maxZ) / 2, maxX - minX, .3, maxZ - minZ, floorMaterial, 'floor');
  floorRect('floor-left', -12, 3, -14, 9);
  floorRect('floor-right', 7, 12, -14, 9);
  floorRect('floor-near', 3, 7, -4, 9);
  floorRect('floor-far', 3, 7, -14, -8);
  floorRect('pit-bottom', 3, 7, -8, -4, -3.2);
  box('pit-left', 2.9, -1.7, -6, .2, 3.4, 4, wallMaterial);
  box('pit-right', 7.1, -1.7, -6, .2, 3.4, 4, wallMaterial);
  box('pit-front', 5, -1.7, -3.9, 4, 3.4, .2, wallMaterial);
  box('pit-back', 5, -1.7, -8.1, 4, 3.4, .2, wallMaterial);
  for (const [id, x, z, sx, sz] of [['north',0,-14,24,.3],['south',0,9,24,.3],['west',-12,-2.5,.3,23],['east',12,-2.5,.3,23]] as const) {
    box(id, x, 1.65, z, sx, 3.3, sz, wallMaterial);
    box(id + '-trim', x, .08, z, sx + .02, .16, sz + .02, trimMaterial);
  }
  for (const [i, [x,z]] of [[-6,2],[-5,-6],[7,3],[-1,-9],[7,-11]].entries()) box('column-'+i, x, 1.65, z, .85, 3.3, .85, wallMaterial, 'column');
  box('raised-landing', -8, .6, -8, 4, 1.2, 3, floorMaterial, 'floor');
  for (let i = 0; i < 6; i++) box('step-'+i, -8, (i+1)*.1, -3.65-i*.5, 2, (i+1)*.2, .51, floorMaterial, 'step');
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(24, 23), ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0,3.3,-2.5); scene.add(ceiling);
  colliders.push({id:'ceiling',center:{x:0,y:3.45,z:-2.5},halfExtents:{x:12,y:.15,z:11.5},kind:'wall'});
  scene.add(new THREE.HemisphereLight('#fff2c3', '#5d5135', 1.8));
  const lightMaterial = new THREE.MeshBasicMaterial({color:'#fff9d8'});
  const fixtureGeometries: THREE.BufferGeometry[] = [];
  for (const [x,z] of [[-4,3],[4,3],[-4,-4],[4,-4],[-4,-11],[4,-11]]) {
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.35,.045,.38),lightMaterial);
    fixtureGeometries.push(fixture.geometry);
    fixture.position.set(x,3.255,z); scene.add(fixture);
    const light = new THREE.PointLight('#fff4c7', 7, 11, 1.4); light.position.set(x,3.02,z); scene.add(light);
  }
  const key = new THREE.DirectionalLight('#fff4cf',2.2); key.position.set(1,5,4);
  key.castShadow = true; key.shadow.mapSize.set(1024,1024);
  key.shadow.camera.left=-12; key.shadow.camera.right=12; key.shadow.camera.top=12; key.shadow.camera.bottom=-12;
  scene.add(key);
  const plan: WorldPlan = { version: 1, seed: 'backrooms-conversation-preview', size: 24, wallHeight: 3.3,
    rooms: [], walls: [], columns: [], solidMasses: [], lights: [], missingCeilingTiles: [], features: [], detailSockets: [],
    colliders, floorRects: [], spawn: { x:0,y:.865,z:3 } };
  physics = await PhysicsWorld.create(plan);
  const settings = defaultGameSettings(); settings.masterVolume = .25; settings.fieldOfView = 70;
  player = new PlayerController(playerCamera, canvas, physics, {
    onLockChange: active => character?.setActive(active && !consoleOpen),
    onFootstep() {}, onInteract() {}, onSafePosition() {}, onFallReset() {},
    onLand: (speed, impact) => character?.handleLanding(speed, impact),
  });
  player.setFieldOfView(70); player.setControlBindings(settings.controls);
  player.setLookSensitivity(.65);
  player.setLookQuaternion(new THREE.Quaternion());
  character = new CharacterRuntime({ container: root, canvas, scene, playerCamera, renderCamera, physics, player,
    settings, seed: plan.seed, isPlaying: () => !disposed && !consoleOpen,
    getPits: () => [{ id:'preview-pit', minX:3,maxX:7,minZ:-8,maxZ:-4,bottom:-3.2,rimY:0 }],
  });
  await character.initialize();
  if (disposed) return;
  character.setInteractionPartner(new THREE.Vector3(0, 0, 1.4));
  character.toggleView();
  character.setActive(true);
  const resize = () => {
    const width = root.clientWidth, height = root.clientHeight;
    renderer!.setSize(width, height, false);
    playerCamera.aspect = renderCamera.aspect = width / height;
    playerCamera.updateProjectionMatrix(); renderCamera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(root); teardown.push(() => observer.disconnect()); resize();
  let previous = performance.now();
  const loop = (time: number) => {
    if (disposed || !root.isConnected) return;
    const delta = Math.min(.05, Math.max(0, (time-previous)/1000)); previous=time;
    character!.update(delta);
    renderer!.render(scene,renderCamera);
    frame=requestAnimationFrame(loop);
  };
  status.hidden = true;
  root.dataset.ready = 'true';
  frame=requestAnimationFrame(loop);
  listen(canvas,'pointerdown', () => { if (!consoleOpen) player!.lock(); });
  const openConsole = () => {
    consoleOpen=true; character!.setActive(false); command.hidden=false;
    commandInput.value='/'; commandInput.focus();
  };
  const closeConsole = () => {
    consoleOpen=false; command.hidden=true; character!.setActive(true);
  };
  listen(window,'keydown', ((event: KeyboardEvent) => {
    if (event.key==='/' && !consoleOpen && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault(); event.stopImmediatePropagation(); openConsole();
    } else if (event.key==='Escape' && consoleOpen) {
      event.preventDefault(); event.stopImmediatePropagation(); closeConsole();
    }
  }) as EventListener, {capture:true});
  listen(command,'submit', ((event: SubmitEvent) => {
    event.preventDefault(); const text=commandInput.value.trim();
    const [name,...args]=text.split(/\s+/);
    if (name.toLowerCase()==='/viewmodel') {
      const result=viewmodelCommand(character,args);
      feedback.textContent=result.feedback ?? '';
      if(result.close)closeConsole();
    } else feedback.textContent='Commande : /viewmodel';
  }) as EventListener);
  const originalDispose = () => {
    cancelAnimationFrame(frame); character?.dispose(); player?.dispose(); physics?.dispose();
    for (const mesh of staticMeshes) mesh.geometry.dispose(); ceiling.geometry.dispose();
    for (const geometry of fixtureGeometries) geometry.dispose();
    for (const material of [floorMaterial,wallMaterial,ceilingMaterial,trimMaterial,lightMaterial]) material.dispose();
    carpet.dispose(); key.shadow.dispose(); renderer?.dispose();
  };
  teardown.push(originalDispose);
  root.dispatchEvent(new CustomEvent('backrooms-ready'));
}
listen(window,'pagehide', () => { if(disposed)return; disposed=true; for(const dispose of teardown.reverse())dispose(); });
boot().catch(showError);
