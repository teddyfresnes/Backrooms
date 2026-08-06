import * as THREE from 'three';
import { formatKeyLabel } from '../input/ControlBindings';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { MOVEMENT_TUNING } from '../player/MovementConfig';
import { PlayerController } from '../player/PlayerController';
import { loadGameSettings } from '../ui/settings';
import type { StaticCollider } from '../world/types';
import { createMovementLabPlan, MOVEMENT_LAB_SPAWN } from './MovementLabPlan';
import './MovementLab.css';

const FIXED_DELTA = 1 / 60;
const MAX_ACCUMULATOR = 0.12;

const materialForCollider = (collider: StaticCollider): THREE.MeshStandardMaterial => {
  if (collider.id === 'floor-main') return new THREE.MeshStandardMaterial({ color: 0x4b5158, roughness: 0.95 });
  if (collider.id.includes('tunnel-ceiling')) return new THREE.MeshStandardMaterial({ color: 0x776f5d, roughness: 0.88 });
  if (collider.id.includes('barrier-38cm') || collider.id.includes('momentum-catch-wall')) return new THREE.MeshStandardMaterial({ color: 0x925f5f, roughness: 0.82 });
  if (collider.id.includes('autostep-24cm')) return new THREE.MeshStandardMaterial({ color: 0x71906f, roughness: 0.82 });
  if (collider.id.includes('impact-')) return new THREE.MeshStandardMaterial({ color: 0x9b7c58, roughness: 0.82 });
  switch (collider.kind) {
    case 'floor': return new THREE.MeshStandardMaterial({ color: 0x5b626a, roughness: 0.92 });
    case 'step': return new THREE.MeshStandardMaterial({ color: 0xa8835f, roughness: 0.82 });
    case 'column': return new THREE.MeshStandardMaterial({ color: 0x687892, roughness: 0.8 });
    case 'barrier': return new THREE.MeshStandardMaterial({ color: 0x786b78, roughness: 0.84 });
    default: return new THREE.MeshStandardMaterial({ color: 0x59616b, roughness: 0.9 });
  }
};

const meshForCollider = (collider: StaticCollider): THREE.Mesh => {
  const geometry = new THREE.BoxGeometry(
    collider.halfExtents.x * 2,
    collider.halfExtents.y * 2,
    collider.halfExtents.z * 2,
  );
  const mesh = new THREE.Mesh(geometry, materialForCollider(collider));
  mesh.name = `movement-lab:${collider.id}`;
  mesh.position.set(collider.center.x, collider.center.y, collider.center.z);
  if (collider.rotation) {
    mesh.quaternion.set(
      collider.rotation.x,
      collider.rotation.y,
      collider.rotation.z,
      collider.rotation.w,
    );
  }
  return mesh;
};

export class MovementLab {
  private readonly root = document.createElement('main');
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.04, 120);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly plan = createMovementLabPlan();
  private readonly settings = loadGameSettings();
  private physics?: PhysicsWorld;
  private player?: PlayerController;
  private previousTime = performance.now();
  private accumulator = 0;
  private fps = 60;
  private hudTimer = 0;
  private disposed = false;
  private readonly stats = new Map<string, HTMLElement>();
  private readonly motionFx = document.createElement('div');
  private hint?: HTMLElement;

  constructor(private readonly container: HTMLElement) {
    this.root.className = 'movement-lab';
    this.renderer.domElement.className = 'movement-lab__canvas';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;
    this.root.append(this.renderer.domElement);
    this.motionFx.className = 'movement-lab__motion-fx';
    this.root.append(this.motionFx);
    this.container.append(this.root);
    this.configureScene();
    this.createHud();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
  }

  async initialize(): Promise<void> {
    const physics = await PhysicsWorld.create(this.plan);
    if (this.disposed) {
      physics.dispose();
      return;
    }
    this.physics = physics;

    this.camera.position.set(MOVEMENT_LAB_SPAWN.x, 1.6, MOVEMENT_LAB_SPAWN.z);
    this.camera.lookAt(-8, 1.35, -7);
    this.player = new PlayerController(this.camera, this.renderer.domElement, physics, {
      onLockChange: this.onPlayerLockChange,
      onFootstep: () => undefined,
      onInteract: () => undefined,
      onLand: () => undefined,
      onSafePosition: () => undefined,
      onFallReset: () => undefined,
    });
    this.player.setInputEnabled(false);
    this.player.setFieldOfView(this.settings.fieldOfView);
    this.player.setLookSensitivity(this.settings.lookSensitivity);
    this.player.setCameraMotionEnabled(this.settings.cameraMotion);
    this.player.setControlBindings(this.settings.controls);
    this.renderer.setAnimationLoop(this.frame);
    this.updateHud();
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0x16191d);
    this.scene.fog = new THREE.Fog(0x16191d, 35, 78);

    const hemisphere = new THREE.HemisphereLight(0xf0f4ff, 0x30343b, 1.4);
    hemisphere.position.set(0, 12, 0);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xfff4de, 1.6);
    key.position.set(-8, 16, -7);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8d9ff, 0.65);
    fill.position.set(12, 8, 12);
    this.scene.add(fill);

    for (const collider of this.plan.colliders) this.scene.add(meshForCollider(collider));

    const grid = new THREE.GridHelper(50, 50, 0x727a83, 0x42484f);
    grid.position.y = 0.012;
    this.scene.add(grid);
  }

  private createHud(): void {
    const controls = this.settings.controls;
    const panel = document.createElement('aside');
    panel.className = 'movement-lab__panel';
    panel.innerHTML = `
      <div class="movement-lab__title"><strong>MOVEMENT LAB</strong><span>DEV · 60 HZ FIXED</span></div>
      <div class="movement-lab__stats">
        <span>MODE</span><b data-stat="mode">IDLE</b>
        <span>ÉTATS</span><b data-stat="states">—</b>
        <span>VITESSE</span><b data-stat="speed">0.00 m/s</b>
        <span>ACCEL</span><b data-stat="accel">0.00 m/s²</b>
        <span>VERTICAL</span><b data-stat="vertical">0.00 m/s</b>
        <span>GROUNDED</span><b data-stat="grounded">YES</b>
        <span>POST LOCK</span><b data-stat="post-lock">0.00 s</b>
        <span>ACTION CD</span><b data-stat="cooldown">0.00 s</b>
        <span>FOV</span><b data-stat="fov">72.0°</b>
        <span>TURN FX</span><b data-stat="turn">0%</b>
        <span>LEAN A/E</span><b data-stat="lean">CENTER</b>
        <span>FPS</span><b data-stat="fps">60</b>
      </div>
      <div class="movement-lab__zones">
        <span>runway slide / jump</span><span>slalom / inertie</span><span>marches 18 cm</span>
        <span>rampe 1.1 m</span><span>tunnel crouch</span><span>drop / impacts</span>
      </div>
      <p class="movement-lab__controls">
        ${formatKeyLabel(controls.forward)}${formatKeyLabel(controls.left)}${formatKeyLabel(controls.backward)}${formatKeyLabel(controls.right)} ·
        ${formatKeyLabel(controls.sprint)} sprint · ${formatKeyLabel(controls.jump)} saut ·
        ${formatKeyLabel(controls.crouch)} crouch / glissade · slide+${formatKeyLabel(controls.jump)} sortie ·
        A/E lean gauche/droite · après slide : court verrou 0,22 s, puis avancer+${formatKeyLabel(controls.sprint)} pour se relever / repartir · Échap souris
      </p>
    `;
    for (const element of panel.querySelectorAll<HTMLElement>('[data-stat]')) {
      this.stats.set(element.dataset.stat!, element);
    }
    this.root.append(panel);

    const home = document.createElement('a');
    home.className = 'movement-lab__back';
    home.href = '/';
    home.textContent = '← ACCUEIL';
    this.root.append(home);

    const hint = document.createElement('div');
    hint.className = 'movement-lab__hint';
    hint.innerHTML = '<strong>CLIQUER POUR TESTER</strong><span>La scène est isolée du jeu, des niveaux et des sauvegardes.</span>';
    this.hint = hint;
    this.root.append(hint);

    if (this.settings.crosshair) {
      const crosshair = document.createElement('i');
      crosshair.className = 'movement-lab__crosshair';
      this.root.append(crosshair);
    }
  }

  private readonly onPlayerLockChange = (locked: boolean): void => {
    this.player?.setInputEnabled(locked);
    this.hint?.classList.toggle('is-hidden', locked);
    this.previousTime = performance.now();
    this.accumulator = 0;
    if (!locked) {
      this.motionFx.style.setProperty('--motion-blur', '0px');
      this.motionFx.style.setProperty('--motion-opacity', '0');
    }
  };

  private readonly onCanvasClick = (): void => {
    if (!this.player?.isLocked) this.player?.lock();
  };

  private readonly frame = (now: number): void => {
    if (this.disposed || !this.player) return;
    const measuredDelta = Math.max(0, (now - this.previousTime) / 1000);
    const rawDelta = Math.min(0.05, measuredDelta);
    this.previousTime = now;

    if (this.player.isLocked) {
      this.accumulator = Math.min(this.accumulator + rawDelta, MAX_ACCUMULATOR);
      while (this.accumulator >= FIXED_DELTA) {
        this.player.fixedUpdate(FIXED_DELTA);
        this.accumulator -= FIXED_DELTA;
      }
      this.player.renderUpdate(rawDelta, this.accumulator / FIXED_DELTA);
      this.updateMotionFx();
    } else {
      this.accumulator = 0;
    }

    const instantaneousFps = measuredDelta > 0 ? 1 / measuredDelta : 60;
    this.fps = THREE.MathUtils.lerp(this.fps, instantaneousFps, 0.055);
    this.hudTimer += rawDelta;
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0;
      this.updateHud();
    }
    this.renderer.render(this.scene, this.camera);
  };

  private updateHud(): void {
    if (!this.player) return;
    const state = this.player.getDebugState();
    const activeStates = [
      state.sprinting ? 'SPRINT' : '',
      state.crouching && !state.lowPosture ? 'CROUCH' : '',
      state.sliding ? 'SLIDE' : '',
      state.lowPosture ? 'LOW' : '',
      state.airborne ? 'AIRBORNE' : '',
      state.postSpecialRiseLock > 0 ? 'POST LOCK' : '',
      state.manualLean < -0.12 ? 'LEAN L' : state.manualLean > 0.12 ? 'LEAN R' : '',
    ].filter(Boolean);
    this.stats.get('mode')!.textContent = state.movementMode.toUpperCase();
    this.stats.get('states')!.textContent = activeStates.join(' · ') || (state.moving ? 'WALK' : 'IDLE');
    this.stats.get('speed')!.textContent = `${state.horizontalSpeed.toFixed(2)} m/s`;
    this.stats.get('accel')!.textContent = `${state.horizontalAcceleration.toFixed(2)} m/s²`;
    this.stats.get('vertical')!.textContent = `${state.verticalSpeed.toFixed(2)} m/s`;
    this.stats.get('grounded')!.textContent = state.grounded ? 'YES' : 'NO';
    this.stats.get('post-lock')!.textContent = `${state.postSpecialRiseLock.toFixed(2)} s`;
    this.stats.get('cooldown')!.textContent = `${state.specialCooldown.toFixed(2)} s`;
    this.stats.get('fov')!.textContent = `${state.fieldOfView.toFixed(1)}°`;
    this.stats.get('turn')!.textContent = `${Math.round(state.turnIntensity * 100)}%`;
    const leanPercent = Math.round(Math.abs(state.manualLean) * 100);
    this.stats.get('lean')!.textContent = state.manualLean < -0.02
      ? `LEFT ${leanPercent}%`
      : state.manualLean > 0.02
        ? `RIGHT ${leanPercent}%`
        : 'CENTER';
    this.stats.get('fps')!.textContent = `${Math.round(this.fps)}`;
  }


  private updateMotionFx(): void {
    if (!this.player || !this.settings.cameraMotion) {
      this.motionFx.style.setProperty('--motion-blur', '0px');
      this.motionFx.style.setProperty('--motion-opacity', '0');
      return;
    }
    const state = this.player.getDebugState();
    if (!state.sprinting) {
      // Keep ordinary walking crisp: speed blur is a sprint-only cue.
      this.motionFx.style.setProperty('--motion-blur', '0px');
      this.motionFx.style.setProperty('--motion-opacity', '0');
      return;
    }
    const speedBlend = THREE.MathUtils.clamp(
      (state.horizontalSpeed - MOVEMENT_TUNING.locomotion.walkSpeed)
        / Math.max(0.001, MOVEMENT_TUNING.locomotion.sprintSpeed - MOVEMENT_TUNING.locomotion.walkSpeed),
      0,
      1,
    );
    const accelerationBlend = THREE.MathUtils.clamp(Math.max(0, state.horizontalAcceleration) / 16, 0, 1);
    const intensity = THREE.MathUtils.clamp(0.12 + speedBlend * 0.34 + accelerationBlend * 0.1, 0, 0.58);
    const blur = 0.1 + speedBlend * 0.42 + accelerationBlend * 0.12;
    this.motionFx.style.setProperty('--motion-blur', `${blur.toFixed(2)}px`);
    this.motionFx.style.setProperty('--motion-opacity', intensity.toFixed(3));
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    this.player?.dispose();
    this.physics?.dispose();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      renderable.geometry?.dispose();
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of materials) material.dispose();
    });
    this.renderer.dispose();
    this.root.remove();
  }
}
