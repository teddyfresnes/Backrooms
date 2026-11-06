import test from 'node:test';
import assert from 'node:assert/strict';
import { PairInteractionCoordinator, pairUnavailableReason, rpsWinner } from '../../.character-test-dist/character/PairInteractionRules.js';

const ready = { distance: 1.05, heightDifference: 0, lookDot: 1, lineOfSight: true,
  senderStanding: true, targetStanding: true, targetDown: false, targetReady: true, alive: true, busy: false };
test('requests require a nearby visible living partner in the aim cone', () => {
  assert.equal(pairUnavailableReason('high-five', ready), null);
  for (const patch of [{distance:1.91},{lookDot:.5},{lineOfSight:false},{heightDifference:.6},{alive:false},{busy:true},{senderStanding:false}]) {
    assert.ok(pairUnavailableReason('high-five', {...ready,...patch}));
  }
  assert.equal(pairUnavailableReason('high-five',{...ready,lookDot:.2},false),null);
});
test('help is only offered to an actually downed, stable living recipient', () => {
  assert.ok(pairUnavailableReason('help-up', ready));
  assert.equal(pairUnavailableReason('help-up',{...ready,targetStanding:false,targetDown:true}),null);
  assert.ok(pairUnavailableReason('help-up',{...ready,targetDown:true,targetReady:false}));
  assert.ok(pairUnavailableReason('help-up',{...ready,targetDown:true,heightDifference:3}));
});
test('only the intended recipient can accept and no motion starts before acceptance', () => {
  const pair=new PairInteractionCoordinator(); assert.equal(pair.request('high-five','npc',10),true);
  assert.equal(pair.session,null); assert.equal(pair.accept('npc',10.5,true),false);
  assert.equal(pair.accept('player',10.5,true),true); assert.equal(pair.session.stage,'aligning');
  assert.equal(pair.request('rps','npc',11),false);
});
test('acceptance at the exact four-second deadline is rejected', () => {
  const pair=new PairInteractionCoordinator();pair.request('rps','npc',10);
  assert.equal(pair.accept('player',14,true),false);assert.equal(pair.session,null);assert.equal(pair.invitation,null);
});
test('separation cancels the offer immediately and a stale Tab cannot resurrect it', () => {
  const pair=new PairInteractionCoordinator();pair.request('fist-bump','npc',10);
  assert.equal(pair.updateInvitation(10.2,false),'separated');assert.equal(pair.accept('player',10.3,true),false);
});
test('both secret choices lock before one shared reveal clock can expose them', () => {
  const pair=new PairInteractionCoordinator();pair.request('rps','npc',0);pair.accept('player',.1,true);
  pair.choose('npc','rock');assert.equal(pair.visibleChoices(),null);
  pair.choose('player','paper');assert.equal(pair.choose('player','scissors'),false);
  assert.equal(pair.visibleChoices(),null);pair.beginPlayback();pair.advance(2.119);
  assert.equal(pair.visibleChoices(),null);pair.advance(.001);
  assert.deepEqual(pair.visibleChoices(),{player:'paper',npc:'rock'});
});
for (const [a,b,result] of [['rock','rock','tie'],['paper','paper','tie'],['scissors','scissors','tie'],['rock','scissors','a'],['paper','rock','a'],['scissors','paper','a'],['scissors','rock','b'],['rock','paper','b'],['paper','scissors','b']])
  test(`simultaneous result: ${a} / ${b}`,()=>assert.equal(rpsWinner(a,b),result));
