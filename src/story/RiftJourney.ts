import { EPIC3_FACADE_HALF_DEPTH, EPIC3_OUTER_HALF_DEPTH, EPIC3_RIFT_CHUNK_Z } from '../world/EpicStructures';
import { INFINITE_CHUNK_SIZE, INFINITE_STORY_PITCH } from '../world/InfiniteWorld';
import { SeededRandom } from '../world/SeededRandom';

/**
 * The walk after the fall: follow Chloé's compass north to the rift, cross it
 * on a plank, then face what followed. Pure state and geometry; the runtime
 * (RiftEncounter) owns meshes, physics, camera and sound.
 */

/** World z of the rift's centre line (the void runs ±EPIC3_FACADE_HALF_DEPTH around it). */
export const RIFT_CENTER_Z = EPIC3_RIFT_CHUNK_Z * INFINITE_CHUNK_SIZE;
/** Facing portal pairs every 14 m along the whole rift, whatever the segment. */
export const RIFT_LANE_SPACING = 14;
export const riftLaneX = (lane: number): number => 7 + RIFT_LANE_SPACING * lane;
export const nearestRiftLane = (x: number): number => Math.round((x - 7) / RIFT_LANE_SPACING);
export const riftFloorY = (story: number): number => story * INFINITE_STORY_PITCH;
/** +1 on the south bank (where the compass walk starts), -1 on the north bank. */
export const riftBank = (z: number): 1 | -1 => (z >= RIFT_CENTER_Z ? 1 : -1);
/** Distance from the void's edge plane on the player's bank (negative = over the void). */
export const riftEdgeDistance = (z: number): number => Math.abs(z - RIFT_CENTER_Z) - EPIC3_FACADE_HALF_DEPTH;
export const isOverRiftVoid = (z: number, margin = 0): boolean => riftEdgeDistance(z) < -margin;
export const isInRiftGallery = (z: number): boolean =>
  riftEdgeDistance(z) > 0 && Math.abs(z - RIFT_CENTER_Z) < EPIC3_OUTER_HALF_DEPTH;

/** The plank spans the void with this much bearing on each gallery floor. */
export const PLANK_BEARING = 0.7;
export const PLANK_LENGTH = EPIC3_FACADE_HALF_DEPTH * 2 + PLANK_BEARING * 2;
export const PLANK_WIDTH = 0.5;
export const PLANK_THICKNESS = 0.07;

export { freshRiftProgress, sanitizeRiftProgress, type RiftProgress, type RiftStage } from './RiftProgress';

/** One-shot thoughts of the character, keyed so a save never replays them. */
export const RIFT_LINES = {
  wake: '… C’est quoi ce bordel ?',
  where: 'J’étais dans la rue… et maintenant, de la moquette. Des néons. À perte de vue.',
  items: 'J’ai encore la lampe… et la boussole de Chloé.',
  north: 'L’aiguille s’est calmée. Elle indique le nord… J’ai rien de mieux à suivre.',
  endless: 'Ça ne finit jamais… Chaque couloir ressemble au précédent.',
  hum: 'Ce bourdonnement… il me rentre dans le crâne.',
  wrongWay: 'La boussole dit que le nord est de l’autre côté.',
  draught: 'Un courant d’air… et cet écho, là-devant. C’est immense.',
  edge: '… Un gouffre. Comment je suis censé passer de l’autre côté ?',
  plank: 'Là… une planche, posée entre deux passages.',
  steady: 'Ne regarde pas en bas… ne regarde pas en bas…',
  across: 'J’y suis… J’y suis arrivé.',
  followed: 'Non… Elle m’a suivi jusqu’ici ?!',
  dropFall: 'Reste en bas !',
  dropLeave: 'Tu ne passeras pas.',
  lost: 'Je… je crois que je l’ai semée.',
  onward: 'Continuer. Toujours vers le nord.',
} as const;
export type RiftLineId = keyof typeof RIFT_LINES;

/**
 * The plank sways like an inverted pendulum: it falls toward the side it
 * leans to, gusts and the walker's own steps push it, the left/right keys
 * push back. Forgiving by design: damped, with a wide limit, and calmer when
 * the walker stands still.
 */
export class BalanceModel {
  static readonly LIMIT = 0.68;
  lean: number;
  rate = 0;
  private gust = 0;
  private gustTimer = 0;
  private readonly random: SeededRandom;

  constructor(seed: string, private readonly tuning = { instability: 2.1, damping: 1.7, control: 2.7, gust: 0.85 }) {
    this.random = new SeededRandom(`${seed}::rift-balance`);
    this.lean = (this.random.chance(0.5) ? 1 : -1) * 0.05;
  }

  get fallen(): boolean { return Math.abs(this.lean) >= BalanceModel.LIMIT; }
  /** 0 (steady) .. 1 (about to fall). */
  get danger(): number { return Math.min(1, Math.abs(this.lean) / BalanceModel.LIMIT); }

  /**
   * @param input -1 (lean back to the left) .. 1 (to the right)
   * @param walking 0 standing still .. 1 stepping forward
   * @param progress 0..1 along the plank (it is worst in the middle)
   */
  step(delta: number, input: number, walking: number, progress: number): number {
    const dt = Math.min(0.05, Math.max(0, delta));
    if (dt === 0 || this.fallen) return this.lean;
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = this.random.float(0.7, 1.6);
      this.gust = this.random.float(-1, 1) * this.tuning.gust;
    }
    const middle = 0.6 + 0.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
    const disturbance = this.gust * middle * (0.35 + 0.65 * Math.min(1, Math.max(0, walking)));
    const command = Math.min(1, Math.max(-1, input));
    const acceleration = this.tuning.instability * Math.sin(this.lean) + disturbance
      - this.tuning.damping * this.rate + this.tuning.control * command;
    this.rate += acceleration * dt;
    this.lean += this.rate * dt;
    return this.lean;
  }
}

/** Distance walked toward the compass's north (world -z) since the arrival. */
export const northProgress = (arrivalZ: number, z: number): number => arrivalZ - z;
