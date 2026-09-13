import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, stepLab } from './support/headless-lab.mjs';

const lab = await createLab();
const ids = ['greeting', 'clapping', 'pointing', 'salute', 'hip-hop', 'wave', 'freeze', 'sweat', 'laying', 'kip-up'].map(name => `emote-${name}`);
const key = (code, value = '') => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: value, bubbles: true, cancelable: true }));
const release = (code, value = '') => window.dispatchEvent(new KeyboardEvent('keyup', { code, key: value, bubbles: true, cancelable: true }));
const moveMouse = (x, y) => {
  const event = new MouseEvent('mousemove', { bubbles: true, cancelable: true });
  Object.defineProperties(event, { movementX: { value: x }, movementY: { value: y } });
  document.dispatchEvent(event);
  return event;
};
const run = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i++) stepLab(lab); };
const menu = lab.emoteMenu;
const enter = () => { lab.player.controls.isLocked = false; lab.player.lock(); lab.npcAttackCooldown = 100; };

afterEach(() => {
  menu.close(); menu.onBlur(); lab.stopEmote(); lab.player.controls.isLocked = false;
  lab.player.input.clear();
  lab.player.fallbackPlaying = false; lab.player.setInputEnabled(false); lab.resetCombatState(true);
});
after(() => lab.dispose());

test('all ten supplied animations have real, compatible channels and retargeted root height', () => {
  const bones = new Set(); lab.character.traverse(object => { if (object.isBone) bones.add(object.name); });
  for (const id of ids) {
    const clip = lab.animations.get(id)?.clip;
    assert.ok(clip?.duration > 0, `${id} has no playable take`);
    assert.ok(clip.tracks.length > 40);
    assert.equal(lab.firstPersonAnimations.get(id).clip, clip);
    for (const track of clip.tracks) {
      assert.ok(bones.has(track.name.split('.')[0]), `unbound channel: ${track.name}`);
      assert.ok([...track.values].every(Number.isFinite));
    }
    const hip = clip.tracks.find(track => track.name.endsWith('Hips.position'));
    assert.ok(hip, `${id} lost its vertical movement`);
    for (let i = 0; i < hip.values.length; i += 3) {
      assert.ok(Math.abs(hip.values[i + 1]) < 2.5, `${id} retained FBX centimetres`);
      assert.equal(hip.values[i], lab.hipsBone.position.x);
      assert.equal(hip.values[i + 2], lab.hipsBone.position.z);
    }
  }
});

test('C opens eight HUD slots while movement, pointer capture, aim and world updates continue', () => {
  enter(); lab.player.controls.isLocked = true; key('KeyC', 'c');
  assert.equal(menu.isOpen, true); assert.equal(lab.player.isLocked, true);
  assert.equal(lab.player.controls.isLocked, true);
  assert.equal(menu.element.querySelectorAll('[data-slot]').length, 8);
  assert.ok(menu.element.querySelector('[data-action="collection"]'));
  assert.equal(menu.element.querySelector('[aria-modal]'), null);
  assert.equal(lab.root.querySelector('.emote-launcher'), null);
  assert.equal(menu.element.querySelector('canvas'), null);
  const clock = lab.combatClock, time = lab.currentAnimationElapsed;
  const position = lab.player.position.clone(), yaw = lab.player.getContinuousAimYawRadians();
  const mouse = moveMouse(40, 0); key(lab.settings.controls.forward, 'z'); run(.25);
  assert.equal(mouse.defaultPrevented, false);
  assert.notEqual(lab.player.getContinuousAimYawRadians(), yaw);
  assert.ok(lab.combatClock > clock); assert.ok(lab.currentAnimationElapsed > time);
  assert.ok(position.distanceTo(lab.player.position) > .1);
  assert.equal(menu.isOpen, true);
  menu.element.querySelector('[data-action="collection"]').click();
  const nextClock = lab.combatClock; run(.1);
  assert.ok(lab.combatClock > nextClock); assert.equal(lab.player.isLocked, true);
});

test('central collection supports replacing a full favorite wheel without playing an emote', () => {
  menu.favorites = ids.slice(0, 8); enter(); menu.open();
  menu.element.querySelector('[data-action="collection"]').click();
  assert.equal(menu.element.querySelectorAll('[data-card]').length, 10);
  menu.element.querySelector('[data-favorite="emote-laying"]').click();
  assert.equal(menu.replacement, 'emote-laying'); assert.equal(lab.activeEmote, null);
  menu.element.querySelector('[data-replace="2"]').click();
  assert.equal(menu.favorites[2], 'emote-laying'); assert.equal(menu.replacement, null);
  assert.equal(new Set(menu.favorites).size, 8);
  assert.deepEqual(JSON.parse(localStorage.getItem('backrooms.emote-favorites.v1')), menu.favorites);
  const restored = new menu.constructor(lab.root, { onOpen() {}, onClose() {}, onPlay() { return false; }, isPointerLocked() { return false; }, isGameControl() { return false; } });
  assert.deepEqual(restored.favorites, menu.favorites); restored.dispose();
});

test('favorite toggles preserve the slot and a free slot accepts a new favorite', () => {
  menu.favorites = ids.slice(0, 8); enter(); menu.open();
  menu.element.querySelector('[data-action="collection"]').click();
  menu.element.querySelector('[data-favorite="emote-pointing"]').click();
  assert.equal(menu.favorites[2], null);
  menu.element.querySelector('[data-favorite="emote-kip-up"]').click();
  assert.equal(menu.favorites[2], 'emote-kip-up'); assert.equal(menu.replacement, null);
});

test('a wheel click plays immediately without changing the view and a new movement interrupts it', () => {
  menu.favorites = ids.slice(0, 8); enter(); lab.setViewMode('first-person'); menu.open();
  menu.element.querySelector('[data-emote="emote-clapping"]').click();
  assert.equal(menu.isOpen, false); assert.equal(lab.player.isLocked, true);
  assert.equal(lab.activeEmote, 'emote-clapping'); assert.equal(lab.viewMode, 'first-person');
  run(1.5); assert.equal(lab.activeEmote, 'emote-clapping'); assert.equal(lab.currentAnimation, 'emote-clapping');
  key(lab.settings.controls.forward, 'z'); stepLab(lab);
  assert.equal(lab.activeEmote, null); assert.equal(lab.viewMode, 'first-person');
});

test('a one-shot returns to exploration after its clip completes', () => {
  enter(); assert.equal(lab.playEmote('emote-salute'), true); run(3.2);
  assert.equal(lab.activeEmote, null); assert.ok(!lab.currentAnimation.startsWith('emote-'));
});

test('a static laying pose holds its lowered hips and stops on a damage event', () => {
  enter(); assert.equal(lab.playEmote('emote-laying'), true); run(.7);
  assert.equal(lab.activeEmote, 'emote-laying'); assert.ok(lab.hipsBone.position.y < .4);
  assert.ok(lab.character.position.toArray().every(Number.isFinite));
  lab.applyDamage(5); assert.equal(lab.activeEmote, null);
});

test('keyboard shortcuts select immediately, leave jump and Tab available, and Escape closes in one press', () => {
  menu.favorites = ids.slice(0, 8); enter(); menu.open();
  key('ArrowRight', 'ArrowRight'); assert.ok(document.activeElement.hasAttribute('data-slot'));
  key('Digit2', 'é'); assert.equal(lab.activeEmote, 'emote-clapping'); assert.equal(menu.isOpen, false);
  menu.open(); menu.element.querySelector('[data-action="collection"]').click();
  const tab = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true, cancelable: true });
  window.dispatchEvent(tab); assert.equal(tab.defaultPrevented, false);
  const jump = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
  let passed = false; const observe = event => { if (event === jump) passed = true; };
  window.addEventListener('keydown', observe);
  window.dispatchEvent(jump); window.removeEventListener('keydown', observe);
  assert.equal(passed, true); assert.equal(menu.isOpen, true);
  release('Space', ' ');
  key('Escape', 'Escape'); assert.equal(menu.isOpen, false); assert.equal(lab.player.isLocked, true);
});

test('a short C tap stays open and a held C flick selects on release without waiting for a frame', () => {
  menu.favorites = ids.slice(0, 8); enter(); lab.player.controls.isLocked = true;
  key('KeyC', 'c'); menu.heldAt = performance.now(); release('KeyC', 'c');
  assert.equal(menu.isOpen, true);
  key('KeyC', 'c'); assert.equal(menu.isOpen, false);
  key('KeyC', 'c'); menu.heldAt = performance.now() - 250;
  moveMouse(0, -2000); release('KeyC', 'c');
  assert.equal(menu.isOpen, false); assert.equal(lab.activeEmote, 'emote-greeting');
  assert.equal(lab.player.controls.isLocked, true);
});

test('a native pointer click selects the virtual sector without punching or reopening the menu', () => {
  menu.favorites = ids.slice(0, 8); enter(); lab.player.controls.isLocked = true; menu.open();
  moveMouse(150, 0);
  for (const type of ['mousedown', 'mouseup', 'click']) lab.renderer.domElement.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true }));
  assert.equal(lab.activeEmote, 'emote-pointing'); assert.equal(menu.isOpen, false);
  assert.equal(lab.combatAttack, null); assert.equal(lab.combatPhase, 'none');
  assert.equal(lab.player.controls.isLocked, true);
});

test('choosing while a movement key is held keeps moving and starts the emote in the current view', () => {
  menu.favorites = ids.slice(0, 8); enter(); lab.setViewMode('third-person');
  key(lab.settings.controls.forward, 'z'); run(.15);
  const position = lab.player.position.clone(); menu.open(); key('Digit2', 'é'); run(.2);
  assert.equal(lab.activeEmote, 'emote-clapping'); assert.equal(lab.viewMode, 'third-person');
  assert.ok(position.distanceTo(lab.player.position) > .1);
  assert.equal(lab.player.isLocked, true);
});

test('the collection plays in one click and an empty sector opens favorite management', () => {
  enter(); menu.favorites = ids.slice(0, 8); menu.favorites[0] = null; menu.open();
  menu.element.querySelector('[data-ring-slot="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(menu.element.querySelectorAll('[data-card]').length, 10);
  menu.element.querySelector('[data-emote="emote-hip-hop"]').click();
  assert.equal(lab.activeEmote, 'emote-hip-hop'); assert.equal(menu.isOpen, false);
});

test('a number remapped to movement remains available while the wheel is open', () => {
  const bindings = { ...lab.settings.controls };
  try {
    lab.settings.controls.forward = 'Digit1'; lab.player.input.setBindings(lab.settings.controls);
    enter(); menu.open(); key('Digit1', '&');
    assert.equal(lab.player.getMovementIntent().forward, 1);
    assert.equal(menu.isOpen, true); assert.equal(lab.activeEmote, null);
  } finally {
    lab.settings.controls = bindings; lab.player.input.setBindings(bindings);
  }
});

test('an emote is refused while airborne and combat can interrupt a dancing player', () => {
  enter(); lab.player.grounded = false;
  assert.equal(lab.playEmote('emote-wave'), false); lab.player.grounded = true;
  assert.equal(lab.playEmote('emote-wave'), true);
  lab.onCombatMouseDown(new MouseEvent('mousedown', { button: 2 }));
  // A genuine canvas press passes the target guard; a UI press does not attack.
  assert.equal(lab.activeEmote, 'emote-wave');
  lab.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
  assert.equal(lab.activeEmote, null);
});
