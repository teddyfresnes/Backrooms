import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createLab, THREE, testAssetRoot } from './support/headless-character.mjs';

await build({entryPoints:['src/stairwell/ArrivalCinematic.ts','src/stairwell/EntryMotion.ts','tests/support/load-geometry-glb.ts'],outbase:'.',outdir:'.character-test-dist/entry',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const {ArrivalCinematic}=await import('../../.character-test-dist/entry/src/stairwell/ArrivalCinematic.js');
const {loadEntryMotions}=await import('../../.character-test-dist/entry/src/stairwell/EntryMotion.js');
const {loadGeometryGlb}=await import('../../.character-test-dist/entry/tests/support/load-geometry-glb.js');
const lab=await createLab({useWardrobe:true});
let cinematic;
after(()=>{cinematic?.dispose();lab.dispose();});

test('the chosen wardrobe avatar enters, then the playable body and camera meet the cinematic endpoint',async()=>{
  const chosen=lab.createArrivalAvatar();
  assert.ok(chosen.avatar.userData.wardrobeProfile,'The entry must use the actual wardrobe identity');
  const door=await loadGeometryGlb(readFileSync(path.join(testAssetRoot,'assets/stairwell-hall-door/double_doors_with_windows.glb')));
  const size=new THREE.Box3().setFromObject(door).getSize(new THREE.Vector3());
  door.scale.set(2.3/size.x,2.66/size.y,2.3/size.x);door.updateMatrixWorld(true);
  const center=new THREE.Box3().setFromObject(door).getCenter(new THREE.Vector3());
  door.position.set(-center.x,1.33-center.y,-6.1-center.z);door.updateMatrixWorld(true);lab.scene.add(door);
  let completed=0, musicFade=0;
  cinematic=new ArrivalCinematic(lab.scene,lab.host.container,chosen.avatar,chosen.idle,await loadEntryMotions(),door,{
    onPOVBlend(){musicFade++;},onDoorSound(){},onComplete(){completed++;lab.setArrivalPresentation(false);},
  });
  assert.ok(cinematic.finalStandingPosition.z>-5.8&&cinematic.finalStandingPosition.z<-4.3,'The endpoint must be inside the entrance hall');
  lab.player.teleport(cinematic.finalStandingPosition);lab.player.setLookQuaternion(new THREE.Quaternion(0,1,0,0));
  const target=new THREE.PerspectiveCamera();lab.getArrivalPOV(target);lab.setArrivalPresentation(true);
  assert.equal(lab.avatarAnchor.visible,false);assert.equal(lab.firstPersonAvatarAnchor.visible,false);
  const camera=target.clone();cinematic.start(target);
  for(let i=0;i<850;i++)cinematic.update(1/60,camera);
  assert.equal(completed,0);assert.equal(musicFade,0);
  for(let i=0;i<120;i++)cinematic.update(1/60,camera);
  assert.equal(completed,1);assert.equal(musicFade,1);assert.equal(lab.cameraMode,'first-person');
  assert.ok(camera.position.distanceTo(lab.host.renderCamera.position)<1e-7,'No camera position snap at control handoff');
  assert.ok(camera.quaternion.angleTo(lab.host.renderCamera.quaternion)<1e-6,'No orientation snap at handoff');
  assert.equal(lab.firstPersonAvatarAnchor.visible,true);assert.equal(lab.avatarAnchor.visible,false);
});
