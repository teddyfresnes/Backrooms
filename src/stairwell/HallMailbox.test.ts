import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHallMailbox } from './HallMailbox';
import { HallArrivalStory } from './HallArrivalStory';
import { STAIRWELL_BOUNDS, STAIRWELL_WALL_THICKNESS } from './layout';

/** Decode the real source geometry with its original transforms. Image decoding
 * needs WebGL/DOM, so only material/texture references are omitted in this test. */
async function sourceModel(): Promise<THREE.Object3D> {
  // @ts-expect-error Node builtins are test-only.
  const { readFile } = await import('node:fs/promises');
  const bytes: Uint8Array = await readFile(new URL('../../public/assets/stairwell-mailbox/old_soviet_mailbox.glb', import.meta.url));
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), jsonLength=view.getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+jsonLength)));
  json.images=[]; json.textures=[]; json.materials=[];
  for(const mesh of json.meshes) for(const primitive of mesh.primitives) delete primitive.material;
  const encoded=new TextEncoder().encode(JSON.stringify(json)), padded=(encoded.length+3)&~3;
  const binary=bytes.subarray(20+jsonLength+8), total=12+8+padded+8+binary.length;
  const glb=new Uint8Array(total); glb.fill(32,20,20+padded);
  const header=new DataView(glb.buffer);
  header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,total,true);
  header.setUint32(12,padded,true);header.setUint32(16,0x4e4f534a,true);glb.set(encoded,20);
  header.setUint32(20+padded,binary.length,true);header.setUint32(24+padded,0x004e4942,true);glb.set(binary,28+padded);
  return (await new GLTFLoader().parseAsync(glb.buffer,'')).scene;
}

describe('the actual entrance mailbox asset', () => {
  it('moves to the opposite wall, keeps four leaves and opens the selected one outward on its original hinge', async () => {
    const template=await sourceModel(), mailbox=createHallMailbox(template,-6.03);
    const box=new THREE.Box3().setFromObject(mailbox);
    expect(box.min.x).toBeCloseTo(STAIRWELL_BOUNDS.minX+STAIRWELL_WALL_THICKNESS+.006);
    expect(box.max.x).toBeLessThan(-1);
    for(const name of ['Door_1_Bent','Door_2','Door_3','Door_4_Bent']) expect(mailbox.getObjectByName(name)).toBeDefined();
    mailbox.traverse(object=>expect(object.userData.noBatch).toBe(true));
    const caption={say:vi.fn(),update:vi.fn(),hide:vi.fn(),dispose:vi.fn()};
    const story=new HallArrivalStory(mailbox,{setInteraction:vi.fn()},caption,'mail',vi.fn(),vi.fn());
    const leaf=mailbox.getObjectByName('Door_3')!, hinge=leaf.getWorldPosition(new THREE.Vector3());
    const center=new THREE.Box3().setFromObject(leaf).getCenter(new THREE.Vector3());
    const player=new THREE.Vector3(-.3,.865,center.z), eye=player.clone().add(new THREE.Vector3(0,.73,0));
    const direction=center.clone().sub(eye).normalize();
    expect(story.interact(player,direction,true)).toBe(true);
    for(let i=0;i<40;i++)story.update(.02,player,direction,true);
    mailbox.updateMatrixWorld(true);
    expect(leaf.getWorldPosition(new THREE.Vector3()).distanceTo(hinge)).toBeLessThan(1e-6);
    expect(new THREE.Box3().setFromObject(leaf).max.x).toBeGreaterThan(center.x+.15);
    story.dispose();
  });
});
