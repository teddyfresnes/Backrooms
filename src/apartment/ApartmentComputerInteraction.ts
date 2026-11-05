import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/** The authored computer remains outside static batching so its real meshes can be targeted. */
export class ApartmentComputerInteraction {
  private readonly ray = new THREE.Raycaster();
  private readonly direction = new THREE.Vector3();
  private readonly bounds = new THREE.Box3();
  private elapsed = .1;
  private prompted = false;
  constructor(private readonly computer: THREE.Object3D, private readonly camera: THREE.Camera,
    private readonly physics: PhysicsWorld, private readonly ui: { setInteraction(label: string | null): void },
    private readonly open: () => void, private readonly blocked: () => boolean = () => false) {
    computer.updateWorldMatrix(true, true); this.bounds.setFromObject(computer);
  }
  private hits(): boolean {
    for (let object: THREE.Object3D | null = this.computer; object; object = object.parent) if (!object.visible) return false;
    if (this.bounds.distanceToPoint(this.camera.position) > 2.3) return false;
    this.camera.getWorldDirection(this.direction); this.ray.set(this.camera.position, this.direction); this.ray.far = 2.3;
    if (!this.ray.ray.intersectsBox(this.bounds)) return false;
    const hit = this.ray.intersectObject(this.computer, true)[0]; if (!hit) return false;
    const wall = this.physics.world.castRay(new RAPIER.Ray(this.camera.position, this.direction), hit.distance, true,
      undefined, undefined, undefined, undefined, this.physics.isInteractionObstacle);
    return !wall || wall.timeOfImpact + .04 >= hit.distance;
  }
  update(delta: number, playing: boolean): void {
    if (!playing) { this.hide(); return; }
    this.elapsed += delta; if (this.elapsed < .1) return; this.elapsed = 0;
    if (this.hits()) { this.ui.setInteraction(this.blocked()?'Le PC ne répond plus.':'Utiliser le PC'); this.prompted = true; }
    else this.hide();
  }
  interact(): boolean { if (!this.hits()) return false; this.hide(); if(this.blocked()){this.ui.setInteraction('Le PC ne répond plus.');this.prompted=true;}else this.open(); return true; }
  private hide(): void { if (this.prompted) this.ui.setInteraction(null); this.prompted = false; }
  dispose(): void { this.hide(); }
}
