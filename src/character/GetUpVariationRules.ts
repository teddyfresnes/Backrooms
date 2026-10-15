import { characterRandom } from './CharacterRandom';
import type { GetUpSide } from './GetUpRecoveryRules';

export type GetUpSupportSide = 'left' | 'right';
export type GetUpVariantId = 'floor' | 'floor-opposite' | 'thigh' | 'thigh-opposite';
export const GET_UP_VARIANT_IDS: readonly GetUpVariantId[] = [
  'floor', 'floor-opposite', 'thigh', 'thigh-opposite',
];
export interface GetUpVariantChoice {
  id: GetUpVariantId;
  support: GetUpSupportSide;
  thighBrace: boolean;
}

/** Each actor keeps its own history. Failed/blocked recoveries do not consume
 * a choice, and a shuffle is exhausted before it can repeat. Side-lying bodies
 * use the nearer support rather than reaching across themselves at entry. */
export class GetUpVariationSelector {
  private readonly remaining = new Map<GetUpSide, GetUpVariantId[]>();
  private readonly previous = new Map<GetUpSide, GetUpVariantChoice>();
  constructor(private readonly random: () => number = characterRandom('recovery')) {}

  choose(side: GetUpSide, rightUpDot: number, choices: readonly GetUpVariantChoice[]): GetUpVariantChoice {
    let pool = this.remaining.get(side);
    if (!pool?.length) {
      pool = choices.map(choice => choice.id);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(Math.max(0, this.random()) * (i + 1)));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      this.remaining.set(side, pool);
    }
    const last = this.previous.get(side);
    // If body-right points up, its left side is on the ground.
    const preferredSupport = Math.abs(rightUpDot) > 0.55 ? (rightUpDot > 0 ? 'left' : 'right') : undefined;
    let candidates = choices.filter(choice => !preferredSupport || choice.support === preferredSupport);
    const fresh = candidates.filter(choice => pool.includes(choice.id) && choice.id !== last?.id);
    if (fresh.length) candidates = fresh;
    else {
      const different = candidates.filter(choice => choice.id !== last?.id);
      if (different.length) candidates = different;
    }
    const differentStyle = candidates.filter(choice => choice.thighBrace !== last?.thighBrace);
    if (last && differentStyle.length) candidates = differentStyle;
    return candidates.sort((a, b) => {
      const rank = (id: GetUpVariantId): number => {
        const i = pool.indexOf(id); return i < 0 ? choices.length : i;
      };
      return rank(a.id) - rank(b.id);
    })[0]!;
  }

  commit(side: GetUpSide, choice: GetUpVariantChoice): void {
    const pool = this.remaining.get(side);
    if (pool) this.remaining.set(side, pool.filter(id => id !== choice.id));
    this.previous.set(side, choice);
  }
}
