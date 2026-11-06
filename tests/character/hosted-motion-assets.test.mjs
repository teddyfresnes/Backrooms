import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THREE } from './support/headless-character.mjs';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CharacterAssetLoader, loadCharacterEmote } from '../../.character-test-dist/character/CharacterAssetLoader.js';

const manifest = JSON.parse(readFileSync('public/assets/character-motion.json', 'utf8'));
const loader = new CharacterAssetLoader();
const sourceLoader = new FBXLoader();
const hierarchy = object => ({
  name: object.name, bone: !!object.isBone,
  p: object.position.toArray(), q: object.quaternion.toArray(), s: object.scale.toArray(),
  children: object.children.filter(child => !child.isMesh).map(hierarchy),
});

test('all hosted animations preserve the source FBX bone transforms and clip samples', async () => {
  let animations = 0, tracks = 0;
  for (const url of manifest.paths.filter(path => path.endsWith('.fbx'))) {
    const bytes = readFileSync(`public${url}`);
    const source = sourceLoader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const hosted = await loader.loadAsync(url);
    assert.deepEqual(hierarchy(hosted), hierarchy(source), url);
    assert.equal(hosted.animations.length, source.animations.length, url);
    source.animations.forEach((clip, clipIndex) => {
      const expected = clip.clone().optimize(), actual = hosted.animations[clipIndex];
      assert.equal(actual.duration, expected.duration, url);
      assert.equal(actual.blendMode, expected.blendMode, url);
      assert.equal(actual.tracks.length, expected.tracks.length, url);
      expected.tracks.forEach((track, index) => {
        const encoded = actual.tracks[index];
        assert.equal(encoded.name, track.name, url);
        assert.equal(encoded.getInterpolation(), track.getInterpolation(), url);
        assert.deepEqual(encoded.times, track.times, `${url}: ${track.name} times`);
        assert.deepEqual(encoded.values, track.values, `${url}: ${track.name} values`);
        tracks++;
      });
    });
    animations++;
  }
  assert.equal(animations, 72);
  assert(tracks > 1000);
});

test('the visible character uses the original mesh and every emote keeps its original data', async () => {
  const model = await loader.loadAsync('/assets/character/character.fbx');
  let skinned = 0, bones = 0;
  model.traverse(object => {
    if (object.isSkinnedMesh) skinned++;
    if (object.isBone) bones++;
  });
  assert(skinned > 0);
  assert.equal(bones, 65);
  const urls = manifest.paths.filter(path => path.endsWith('.json'));
  assert.equal(urls.length, 10);
  for (const url of urls) {
    const original = JSON.parse(readFileSync(`public${url}`, 'utf8'));
    const loaded = await loadCharacterEmote(url);
    assert.deepEqual(loaded, original);
    loaded.sourceHipRestY = -999;
    assert.equal((await loadCharacterEmote(url)).sourceHipRestY, original.sourceHipRestY);
  }
});
