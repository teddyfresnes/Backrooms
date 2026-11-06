import * as THREE from 'three';

const clock = (): string => new Date().toLocaleTimeString('fr-FR', { hour12: false });

/** Names what a long gameplay frame paid for: shader programs compiled on
 * first sight (and for which materials), textures or geometries uploaded.
 * Costs two integer reads per frame; the scene is traversed only on a hitch
 * that compiled something. */
export class FrameHitchMonitor {
  private programs: number;
  private textures: number;
  private geometries: number;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Object3D, private readonly thresholdMs = 150) {
    this.programs = renderer.info.programs?.length ?? 0;
    this.textures = renderer.info.memory.textures;
    this.geometries = renderer.info.memory.geometries;
  }

  check(frameStart: number, where?: THREE.Vector3): void {
    const duration = performance.now() - frameStart;
    const programs = this.renderer.info.programs ?? [];
    const { textures, geometries } = this.renderer.info.memory;
    const added = programs.length - this.programs, uploads = textures - this.textures, meshes = geometries - this.geometries;
    if (duration >= this.thresholdMs) {
      const position = where ? ` at (${where.x.toFixed(1)}, ${where.y.toFixed(1)}, ${where.z.toFixed(1)})` : '';
      console.info(`${clock()} [frame] ${Math.round(duration)} ms hitch${position}: +${Math.max(0, added)} shader programs, +${Math.max(0, uploads)} textures, +${Math.max(0, meshes)} geometries`);
      if (added > 0) {
        const fresh = new Set<unknown>(programs.slice(-added));
        const culprits = new Set<string>();
        this.scene.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.material) return;
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            const program = (this.renderer.properties.get(material) as { currentProgram?: unknown }).currentProgram;
            if (fresh.has(program)) culprits.add(`${material.type}"${material.name}" on ${object.name || object.type}${mesh.visible ? '' : ' (hidden)'}`);
          }
        });
        console.info(`${clock()} [frame] compiled for:`, culprits.size ? [...culprits] : '(post-processing or shadow-depth materials)');
      }
    }
    this.programs = programs.length; this.textures = textures; this.geometries = geometries;
  }
}
