import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab, stepLab, THREE } from './support/headless-character.mjs';

test('the selected wardrobe profile replaces the template in both views and survives a physical fall', async () => {
  localStorage.setItem('character-studio/current/v4', JSON.stringify({
    id: 'custom', name: 'Personnage sélectionné',
    body: { gender: 1, height: -.1, weight: .1, shoulders: -.15 },
    appearance: { skinColor: '#b87958', eyeColor: '#235b87', hairId: 'mh-hair-culturalibre_hair_14' },
    wardrobe: { top: 'mh-top-namuhekam_male_polo_shirt', bottom: 'mh-bottom-cortu_cargo_pants', shoes: 'mh-shoes-toigo_mj_cloth_shoes', colors: {} },
  }));
  const lab = await createLab({ useWardrobe: true });
  try {
    const profile = lab.character.userData.wardrobeProfile;
    assert.equal(profile.id, 'custom');
    assert.equal(profile.name, 'Personnage sélectionné');
    assert.equal(profile.appearance.eyeColor, '#235b87');
    const body = lab.character.getObjectByName('MakeHuman_HM08_Body');
    assert(body?.isSkinnedMesh, 'the fitted wardrobe body must replace the FBX mesh');
    assert(body.material.map, 'the wardrobe skin texture must be attached');
    const shirt = lab.character.getObjectByProperty('name', 'Polo_t-shirt')
      ?? (() => { let found; lab.character.traverse(node => { if (node.userData.makeHumanAsset?.id === profile.wardrobe.top) found = node; }); return found; })();
    assert(shirt?.isSkinnedMesh, 'the selected shirt must be skinned');
    assert.equal(shirt.skeleton, body.skeleton);
    const firstBody = lab.firstPersonAvatarAnchor.getObjectByName('MakeHuman_HM08_Body');
    assert(firstBody?.isSkinnedMesh);
    assert.notEqual(firstBody.skeleton.bones[0], body.skeleton.bones[0]);
    assert.notEqual(firstBody.geometry, body.geometry);
    assert.equal(lab.toggleView(), 'third-person');
    assert.equal(lab.toggleView(), 'first-person');
    lab.player.controls.isLocked = true;
    lab.setActive(true);
    for (let frame = 0; frame < 90; frame++) stepLab(lab);
    lab.killPlayer({ quietStart: true });
    for (let frame = 0; frame < 240; frame++) stepLab(lab);
    assert(lab.ragdoll);
    assert(lab.activeCorpseRoot.getObjectByName('MakeHuman_HM08_Body'));
    const bounds = new THREE.Box3().setFromObject(lab.activeCorpseRoot, true);
    assert(Number.isFinite(bounds.min.x) && Number.isFinite(bounds.max.y));
    assert(bounds.getSize(new THREE.Vector3()).length() < 5, 'the calibrated skin must stay attached to the physical skeleton');
  } finally { lab.dispose(); localStorage.clear(); }
});
