import type { TransitionLayout } from './TransitionLayout';
import { restrictProfile, transitionTreads } from './TransitionLayout';
import { offsetProfile } from './SpatialGeometry';
import { surfaceNormal, type HeightProfile, type WalkableSurface } from './WalkableTopology';
import { rectDepth, rectWidth, type Rect } from './types';

/** The ceiling policy is materialized once. In particular an open flight has
 * no independent roof geometry in this owner, including approach and landing. */
export const transitionSurfaces = (t: TransitionLayout, story: number) => {
  const surfaces: WalkableSurface[] = [], ceilings: WalkableSurface[] = [];
  const add = (id: string, bounds: Rect, profile: HeightProfile, role: WalkableSurface['role'], ceilingProfile: HeightProfile, thickness = .16) => {
    const sf: WalkableSurface = { id, roomId: t.roomId, ownerStory: story, layer: `regional/${story}`, bounds, profile, role, ceilingProfile,
      ceilingY: ceilingProfile.kind === 'flat' ? ceilingProfile.y : Math.max(ceilingProfile.startY, ceilingProfile.endY),
      thickness, support: 'slab', access: 'open', edges: 'architecture', reachability: 'regional' };
    surfaces.push(sf); return sf;
  };
  const approach = add(`${t.id}/approach`,t.approach.bounds,{kind:'flat',y:t.approach.y},'landing',{kind:'flat',y:t.approachCeilingY});
  const route = transitionTreads(t).map(step => add(t.kind==='ramp'?t.id:`${t.id}/step-${step.index}`,step.bounds,step.profile,t.kind==='ramp'?'ramp':'stair',
    t.roofPolicy==='upper-slab'&&t.kind==='stairs' ? offsetProfile(step.profile,5.4-.27) : restrictProfile(t.run,t.roof,step.bounds),t.kind==='stairs'?.27:.16));
  const landing = rectWidth(t.landing.bounds)>.005 && rectDepth(t.landing.bounds)>.005
    ? add(`${t.id}/landing`,t.landing.bounds,{kind:'flat',y:t.landing.y},'landing',{kind:'flat',y:t.landingCeilingY}) : undefined;
  if (t.roofPolicy === 'flight') {
    for (const sf of [approach, ...(landing?[landing]:[])]) ceilings.push({...sf,id:sf.id+'/ceiling',profile:offsetProfile(sf.ceilingProfile!,.03),thickness:.03});
    ceilings.push({...route[0]!,id:`${t.id}/roof`,bounds:t.run,profile:offsetProfile(t.roof,.03/surfaceNormal({...route[0]!,bounds:t.run,profile:t.roof}).y),
      ceilingProfile:undefined,thickness:.03,role:'floor',support:'slab',access:'sealed'});
  }
  return { surfaces, ceilings, route };
};
