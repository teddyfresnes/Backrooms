import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EMOTES, type EmoteId } from './EmoteCatalog';

/** One independent, reusable preview rig; the gameplay skeleton is never sampled. */
export class EmotePreview {
  readonly canvas: HTMLCanvasElement;
  readonly thumbnails = new Map<EmoteId, string>();
  private readonly renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, .01, 30);
  private readonly rig: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly materials: THREE.Material[] = [];
  private action?: THREE.AnimationAction;

  constructor(character: THREE.Group, private readonly clips: ReadonlyMap<EmoteId, THREE.AnimationClip>) {
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.rig = clone(character) as THREE.Group;
    this.rig.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material.clone());
      this.materials.push(...materials);
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    });
    this.scene.add(this.rig);
    this.scene.add(new THREE.HemisphereLight(0xe6fff5, 0x657880, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.6);
    light.position.set(3, 5, 4);
    this.scene.add(light);
    this.mixer = new THREE.AnimationMixer(this.rig);
    this.renderer.setSize(160, 160, false);
    for (const emote of EMOTES) {
      this.select(emote.id);
      this.mixer.setTime(this.clips.get(emote.id)!.duration * emote.sample);
      this.fitCamera();
      this.renderer.render(this.scene, this.camera);
      this.thumbnails.set(emote.id, this.canvas.toDataURL('image/png'));
    }
    this.renderer.setSize(320, 320, false);
    this.select(EMOTES[0].id);
  }

  select(id: EmoteId): void {
    const clip = this.clips.get(id);
    if (!clip) return;
    this.mixer.stopAllAction();
    this.mixer.setTime(0);
    this.action = this.mixer.clipAction(clip).reset().setLoop(THREE.LoopRepeat, Infinity).play();
    // Fit across representative poses so a wave or a dance stays within the preview.
    const bounds = new THREE.Box3();
    for (const fraction of [.12, .35, .6, .85]) {
      this.mixer.setTime(clip.duration * fraction);
      bounds.union(this.poseBounds());
    }
    this.fitCamera(bounds);
    this.mixer.setTime(0);
  }

  private poseBounds(): THREE.Box3 {
    this.rig.updateMatrixWorld(true);
    this.rig.traverse(object => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) mesh.computeBoundingBox();
    });
    return new THREE.Box3().setFromObject(this.rig);
  }

  private fitCamera(bounds = this.poseBounds()): void {
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const distance = Math.max(size.y, size.x, size.z, .8) / (2 * Math.tan(THREE.MathUtils.degToRad(17))) * 1.28;
    this.camera.position.copy(center).add(new THREE.Vector3(.22, .1, 1).normalize().multiplyScalar(distance));
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
  }

  update(delta: number): void {
    this.mixer.update(delta);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.rig);
    this.materials.forEach(material => material.dispose());
    this.renderer.dispose();
    this.canvas.remove();
  }
}
