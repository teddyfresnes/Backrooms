import type { TransitionLayout } from './TransitionLayout';
import { restrictProfile, transitionTreads } from './TransitionLayout';
import { offsetProfile } from './SpatialGeometry';
import { surfaceNormal, type HeightProfile, type WalkableSurface } from './WalkableTopology';
import { rectDepth, rectWidth, type Rect } from './types';

/** Steps, ramp and landing are one solid mass bearing on the lowest floor of
 * their half: a podium on the lower side, the bottom of a trench on the upper
 * side. No tread floats and no flank shows the void. The ceiling policy is
 * materialized once, entirely inside this owner's story band. */
export const transitionSurfaces = (t: TransitionLayout, story: number) => {
  const surfaces: WalkableSurface[] = [], ceilings: WalkableSurface[] = [];
  const base = Math.min(t.approach.y, t.landing.y) - .16;
  const add = (id: string, bounds: Rect, profile: HeightProfile, role: WalkableSurface['role'], ceilingProfile: HeightProfile, solid: boolean) => {
    const sf: WalkableSurface = { id, roomId: t.roomId, ownerStory: story, layer: `regional/${story}`, bounds, profile, role, ceilingProfile,
      ceilingY: ceilingProfile.kind === 'flat' ? ceilingProfile.y : Math.max(ceilingProfile.startY, ceilingProfile.endY),
      thickness: .16, support: solid ? 'solid' : 'slab', ...(solid ? { supportBottom: base } : {}),
      access: 'open', edges: 'architecture', reachability: 'regional' };
    surfaces.push(sf); return sf;
  };
  const approach = add(`${t.id}/approach`, t.approach.bounds, { kind: 'flat', y: t.approach.y }, 'landing', { kind: 'flat', y: t.approachCeilingY }, false);
  const route = transitionTreads(t).map(step => add(t.kind === 'ramp' ? t.id : `${t.id}/step-${step.index}`, step.bounds, step.profile,
    t.kind === 'ramp' ? 'ramp' : 'stair', restrictProfile(t.run, t.roof, step.bounds), true));
  const landing = rectWidth(t.landing.bounds) > .005 && rectDepth(t.landing.bounds) > .005
    ? add(`${t.id}/landing`, t.landing.bounds, { kind: 'flat', y: t.landing.y }, 'landing', { kind: 'flat', y: t.landingCeilingY }, true) : undefined;
  // Suspended tiles: the approach is a plain slab, so no solid support leaks into them.
  const tile = (id: string, bounds: Rect, profile: HeightProfile): WalkableSurface => ({ ...approach, id, bounds, profile,
    ceilingProfile: undefined, thickness: .03, role: 'floor', access: 'sealed' });
  if (t.roofPolicy === 'flight') {
    for (const sf of [approach, ...(landing ? [landing] : [])]) ceilings.push(tile(`${sf.id}/ceiling`, sf.bounds, offsetProfile(sf.ceilingProfile!, .03)));
    ceilings.push(tile(`${t.id}/roof`, t.run, offsetProfile(t.roof, .03 / surfaceNormal({ ...route[0]!, bounds: t.run, profile: t.roof }).y)));
  } else ceilings.push(tile(`${t.id}/roof`, t.bounds, offsetProfile(t.roof, .03)));
  return { surfaces, ceilings, route };
};
