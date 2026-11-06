import * as THREE from 'three';

const clock = (): string => new Date().toLocaleTimeString('fr-FR', { hour12: false });

type MaterialProperties = { currentProgram?: { cacheKey?: string }; programs?: Map<string, unknown> };

/** Lights Three unrolls into every lit shader: a change here recompiles everything. */
const lightSignature = (scene: THREE.Object3D): string => {
  const counts: Record<string, number> = {};
  scene.traverseVisible(object => {
    const light = object as THREE.Light;
    if (!light.isLight) return;
    const key = light.type + (light.castShadow ? '+shadow' : '');
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([type, count]) => `${type}:${count}`).join(' ');
};

/** Fields that differ between two program cache keys (comma-joined parameter lists). */
const keyDiff = (before: string, after: string): string => {
  const a = before.split(','), b = after.split(',');
  const changes: string[] = [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) changes.push(`#${index}: ${(a[index] ?? '∅').slice(0, 60)} → ${(b[index] ?? '∅').slice(0, 60)}`);
  }
  return changes.slice(0, 8).join(' | ') || '(identical keys)';
};

/** Names what a long gameplay frame paid for: shader programs compiled on
 * first sight (and for which materials, and why), textures or geometries
 * uploaded. Costs two integer reads per frame; the scene is traversed only on
 * a hitch that compiled something. */
export class FrameHitchMonitor {
  private programs: number;
  private textures: number;
  private geometries: number;
  private lights: string;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Object3D, private readonly thresholdMs = 150) {
    this.programs = renderer.info.programs?.length ?? 0;
    this.textures = renderer.info.memory.textures;
    this.geometries = renderer.info.memory.geometries;
    this.lights = lightSignature(scene);
  }

  check(frameStart: number, where?: THREE.Vector3): void {
    const duration = performance.now() - frameStart;
    const programs = this.renderer.info.programs ?? [];
    const { textures, geometries } = this.renderer.info.memory;
    const added = programs.length - this.programs, uploads = textures - this.textures, meshes = geometries - this.geometries;
    if (duration >= this.thresholdMs) {
      const position = where ? ` at (${where.x.toFixed(1)}, ${where.y.toFixed(1)}, ${where.z.toFixed(1)})` : '';
      console.info(`${clock()} [frame] ${Math.round(duration)} ms hitch${position}: +${Math.max(0, added)} shader programs, +${Math.max(0, uploads)} textures, +${Math.max(0, meshes)} geometries`);
      if (added > 0) this.explain(new Set<unknown>(programs.slice(-added)));
    }
    this.programs = programs.length; this.textures = textures; this.geometries = geometries;
  }

  private explain(fresh: Set<unknown>): void {
    const lights = lightSignature(this.scene);
    if (lights !== this.lights) console.info(`${clock()} [frame] visible lights changed: ${this.lights} → ${lights}`);
    this.lights = lights;
    const culprits = new Set<string>();
    const reasons = new Map<string, number>();
    let firstTime = 0;
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const properties = this.renderer.properties.get(material) as MaterialProperties;
        const program = properties.currentProgram;
        if (!fresh.has(program)) continue;
        culprits.add(`${material.type}"${material.name}" on ${object.name || object.type}${mesh.visible ? '' : ' (hidden)'}`);
        const keys = [...(properties.programs?.keys() ?? [])];
        if (keys.length < 2) { firstTime += 1; continue; }
        const reason = keyDiff(keys.find(key => key !== program?.cacheKey) ?? keys[0]!, program?.cacheKey ?? keys[keys.length - 1]!);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    });
    console.info(`${clock()} [frame] compiled for:`, culprits.size ? [...culprits] : '(post-processing or shadow-depth materials)');
    if (firstTime) console.info(`${clock()} [frame] ${firstTime} material(s) were never compiled before (missed by the warmup)`);
    for (const [reason, count] of reasons) console.info(`${clock()} [frame] key changed on ${count} material(s): ${reason}`);
  }
}
