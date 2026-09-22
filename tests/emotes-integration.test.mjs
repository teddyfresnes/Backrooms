import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLab, stepLab, THREE } from './support/headless-lab.mjs';

const lab = await createLab();
const ids = ['greeting', 'clapping', 'pointing', 'salute', 'hip-hop', 'wave', 'freeze', 'sweat', 'laying', 'kip-up', 'middle-finger', 'follow-me', 'wait'].map(name => `emote-${name}`);
const key = (code, value = '') => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: value, bubbles: true, cancelable: true }));
const release = (code, value = '') => window.dispatchEvent(new KeyboardEvent('keyup', { code, key: value, bubbles: true, cancelable: true }));
const moveMouse = (x, y) => {
  const event = new MouseEvent('mousemove', { bubbles: true, cancelable: true });
  Object.defineProperties(event, { movementX: { value: x }, movementY: { value: y } });
  document.dispatchEvent(event);
  return event;
};
const clickPointer = () => {
  for (const type of ['mousedown', 'mouseup', 'click']) lab.renderer.domElement.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true }));
};
const run = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i++) stepLab(lab); };
const menu = lab.emoteMenu;
const enter = () => { lab.player.controls.isLocked = false; lab.player.lock(); lab.npcAttackCooldown = 100; };
const place = (x = -10, z = -12) => {
  enter(); lab.player.input.clear(); lab.health = 100;
  lab.player.teleport({ x, y: .865, z }); lab.player.grounded = true;
  lab.player.continuousAimYaw = -Math.PI; lab.player.lookCamera.rotation.set(0, -Math.PI, 0);
  lab.updateAvatarTransform(0, true);
};
const wall = (x, z, width = .1, depth = .3, y = 1, height = 1) => lab.physics.addChunk('emote-test-obstacle', [{
  id: 'obstacle', kind: 'wall', center: { x, y, z }, halfExtents: { x: width, y: height, z: depth },
}], { x: 0, y: 0, z: 0 });

beforeEach(() => {
  // These cases exercise the solo picker. Facing a nearby actor now opens
  // the paired picker, which has its own integration coverage.
  lab.idleNpcAnchor.position.x = -18; lab.syncNpcPlayerBlocker(true); place();
});

afterEach(() => {
  if (lab.physics.hasChunk('emote-test-obstacle')) lab.physics.removeChunk('emote-test-obstacle');
  lab.syncNpcPlayerBlocker(true);
  menu.close(); menu.onBlur(); lab.stopEmote(); lab.player.controls.isLocked = false;
  lab.player.input.clear();
  lab.player.fallbackPlaying = false; lab.player.setInputEnabled(false); lab.resetCombatState(true);
});
after(() => lab.dispose());

test('all thirteen emotes have real, compatible channels and retargeted root height', () => {
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

test('Tab opens eight HUD slots without blocking aim or the world and movement closes immediately', () => {
  enter(); lab.player.controls.isLocked = true; key('Tab', 'Tab');
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
  assert.equal(menu.isOpen, false);
  release(lab.settings.controls.forward, 'z');
  menu.open(); menu.element.querySelector('[data-action="collection"]').click();
  const nextClock = lab.combatClock; run(.1);
  assert.ok(lab.combatClock > nextClock); assert.equal(lab.player.isLocked, true);
});

test('the standing collection filters out ground emotes and saves its own favorites without playing', () => {
  menu.favorites = ids.slice(0, 8); enter(); menu.open();
  menu.element.querySelector('[data-action="collection"]').click();
  assert.equal(menu.element.querySelectorAll('[data-card]').length, 11);
  assert.equal(menu.element.querySelector('[data-card="emote-laying"]'), null);
  assert.equal(menu.element.querySelector('[data-card="emote-kip-up"]'), null);
  menu.element.querySelector('[data-favorite="emote-pointing"]').click();
  assert.equal(menu.favorites[2], null); assert.equal(lab.activeEmote, null);
  menu.element.querySelector('[data-favorite="emote-pointing"]').click();
  assert.equal(menu.favorites[2], 'emote-pointing');
  assert.deepEqual(JSON.parse(localStorage.getItem('backrooms.emote-favorites.v1')), menu.favorites);
  const restored = new menu.constructor(lab.root, {
    onOpen() {}, onClose() {}, onPlay() { return false; }, isPointerLocked() { return false; },
    isGameControl() { return false; }, isMovementControl() { return false; }, isMoving() { return false; },
    getPosture() { return 'standing'; }, getUnavailableReason() { return null; },
  });
  assert.deepEqual(restored.favorites, menu.favorites); restored.dispose();
});

test('favorite toggles preserve another empty slot and put the chosen emote in the first free slot', () => {
  menu.favorites = ids.slice(0, 8); menu.favorites[0] = null; enter(); menu.open();
  menu.element.querySelector('[data-action="collection"]').click();
  menu.element.querySelector('[data-favorite="emote-pointing"]').click();
  assert.equal(menu.favorites[2], null);
  menu.element.querySelector('[data-favorite="emote-pointing"]').click();
  assert.equal(menu.favorites[0], 'emote-pointing'); assert.equal(menu.favorites[2], null);
});

test('Tout keeps short card labels and shows availability in one shared status only',()=>{
  enter();menu.open();menu.element.querySelector('[data-action="collection"]').click();
  const cards=[...menu.element.querySelectorAll('[data-card]')];assert.equal(cards.length,11);
  assert.equal(menu.element.querySelectorAll('[role="status"]').length,1);
  assert.equal(menu.element.querySelector('[data-favorite-status]').textContent,'');
  for(const card of cards){
    assert.equal(card.querySelectorAll('small, p').length,0);
    assert.ok(card.querySelector('[data-emote] > span').textContent.length<=9);
    assert.ok(card.querySelector('[data-emote] img'));assert.ok(card.querySelector('[data-favorite]'));
  }
  const first=cards[0].querySelector('[data-emote]');first.dispatchEvent(new Event('focusin',{bubbles:true}));
  assert.equal(menu.element.querySelector('[data-favorite-status]').textContent,first.getAttribute('aria-label').replace('Jouer : ',''));
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

test('ground-only emotes cannot start from a standing avatar or appear in saved standing slots', () => {
  place(); assert.equal(lab.playEmote('emote-laying'), false); assert.equal(lab.playEmote('emote-kip-up'), false);
  menu.favorites = ['emote-laying', 'emote-kip-up', ...ids.slice(2, 8)]; menu.open();
  assert.equal(menu.element.querySelector('[data-emote="emote-laying"]'), null);
  assert.equal(menu.element.querySelector('[data-emote="emote-kip-up"]'), null);
  assert.equal(menu.element.querySelector('[data-slot="0"]').classList.contains('is-empty'), true);
});

test('keyboard shortcuts select immediately, leave jump and C available, and Escape closes in one press', () => {
  menu.favorites = ids.slice(0, 8); enter(); menu.open();
  key('ArrowRight', 'ArrowRight'); assert.ok(document.activeElement.hasAttribute('data-slot'));
  key('Digit2', 'é'); assert.equal(lab.activeEmote, 'emote-clapping'); assert.equal(menu.isOpen, false);
  menu.open(); menu.element.querySelector('[data-action="collection"]').click();
  const tab = new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true, cancelable: true });
  window.dispatchEvent(tab); assert.equal(tab.defaultPrevented, false);
  const jump = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
  let passed = false; const observe = event => { if (event === jump) passed = true; };
  window.addEventListener('keydown', observe);
  window.dispatchEvent(jump); window.removeEventListener('keydown', observe);
  assert.equal(passed, true); assert.equal(menu.isOpen, false);
  release('Space', ' ');
  menu.open(); key('Escape', 'Escape'); assert.equal(menu.isOpen, false); assert.equal(lab.player.isLocked, true);
});

test('a single Tab tap fades linearly for two seconds without release selecting or changing capture', () => {
  menu.favorites = ids.slice(0, 8); place(); lab.player.controls.isLocked = true;
  key('Tab', 'Tab'); release('Tab', 'Tab');
  assert.equal(menu.isOpen, true); assert.equal(menu.element.style.opacity, '1');
  run(.5); assert.ok(Math.abs(Number(menu.element.style.opacity) - .75) < .001);
  run(.5); assert.ok(Math.abs(Number(menu.element.style.opacity) - .5) < .001);
  moveMouse(0, -2000); release('Tab', 'Tab');
  assert.equal(menu.isOpen, true); assert.equal(lab.activeEmote, null);
  run(1.02); assert.equal(menu.isOpen, false); assert.equal(menu.element.hidden, true);
  assert.equal(lab.player.controls.isLocked, true);
  key('Tab', 'Tab'); assert.equal(menu.element.style.opacity, '1');
  key('Tab', 'Tab'); assert.equal(menu.isOpen, false);
});

test('a native pointer click selects the virtual sector without punching or reopening the menu', () => {
  menu.favorites = ids.slice(0, 8); enter(); lab.player.controls.isLocked = true; menu.open();
  moveMouse(150, 0);
  for (const type of ['mousedown', 'mouseup', 'click']) lab.renderer.domElement.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true }));
  assert.equal(lab.activeEmote, 'emote-pointing'); assert.equal(menu.isOpen, false);
  assert.equal(lab.combatAttack, null); assert.equal(lab.combatPhase, 'none');
  assert.equal(lab.player.controls.isLocked, true);
});

test('the central return button closes in one click and all emotes is an icon of four dots', () => {
  menu.favorites = ids.slice(0, 8); lab.player.controls.isLocked = true; menu.open();
  assert.equal(menu.wheelRect.left + menu.wheelRect.width / 2, window.innerWidth / 2);
  assert.equal(menu.wheelRect.top + menu.wheelRect.height / 2, window.innerHeight / 2);
  const back = menu.element.querySelector('.emote-wheel-back');
  const all = menu.element.querySelector('.emote-wheel-all');
  assert.equal(back.getAttribute('aria-label'), 'Revenir au jeu');
  assert.equal(all.querySelectorAll('circle').length, 4);
  assert.equal(all.textContent.trim(), '');
  clickPointer();
  assert.equal(menu.isOpen, false); assert.equal(lab.combatAttack, null);
  assert.equal(lab.player.controls.isLocked, true);
});

test('hovering with the game cursor restores opacity, pauses expiry and restarts a linear fade on leaving', () => {
  menu.favorites = ids.slice(0, 8); lab.player.controls.isLocked = true; menu.open();
  run(1); assert.ok(Math.abs(Number(menu.element.style.opacity) - .5) < .001);
  const mouse = moveMouse(menu.wheelRect.width / 3, 0);
  assert.equal(mouse.defaultPrevented, false);
  run(3); assert.equal(menu.isOpen, true); assert.equal(menu.element.style.opacity, '1');
  moveMouse(menu.wheelRect.width, 0);
  menu.update();
  assert.equal(menu.hoveredButton, null); assert.equal(menu.element.style.opacity, '1');
  run(.5); assert.ok(Math.abs(Number(menu.element.style.opacity) - .75) < .001);
  // Re-entering restores the full menu, rather than resuming an almost expired timer.
  moveMouse(-menu.wheelRect.width, 0); run(2.2);
  assert.equal(menu.isOpen, true); assert.equal(menu.element.style.opacity, '1');
  key(lab.settings.controls.forward, 'z'); assert.equal(menu.isOpen, false);
  release(lab.settings.controls.forward, 'z');
});

test('the small four-dot target opens the collection under pointer lock without moving the cursor', () => {
  menu.favorites = ids.slice(0, 8); lab.player.controls.isLocked = true; menu.open();
  moveMouse(0, 37.2 * menu.wheelRect.width / 360);
  menu.update();
  assert.equal(menu.hoveredButton?.className.includes('emote-wheel-all'), true);
  const point = [menu.pointerX, menu.pointerY]; clickPointer();
  assert.equal(menu.element.querySelectorAll('[data-card]').length, 11);
  assert.deepEqual([menu.pointerX, menu.pointerY], point);
  assert.equal(lab.combatAttack, null); assert.equal(lab.player.controls.isLocked, true);
  run(3); assert.equal(menu.isOpen, true); assert.equal(menu.element.style.opacity, '1');
  menu.element.querySelector('[data-favorite="emote-pointing"]').click();
  assert.deepEqual([menu.pointerX, menu.pointerY], point);
  run(2.2); assert.equal(menu.isOpen, true);
  menu.element.querySelector('[data-action="wheel"]').click();
  assert.ok(menu.element.querySelector('.emote-wheel-back'));
  assert.deepEqual([menu.pointerX, menu.pointerY], point);
  moveMouse(-window.innerWidth, -window.innerHeight); run(2.02);
  assert.equal(menu.isOpen, false);
});

test('a normal cursor keeps the picker visible across slots and resumes expiry outside it', () => {
  menu.favorites = ids.slice(0, 8); lab.player.controls.isLocked = false; menu.open();
  const x = menu.wheelRect.left + menu.wheelRect.width * .8;
  const y = menu.wheelRect.top + menu.wheelRect.height * .5;
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
  run(3); assert.equal(menu.isOpen, true); assert.equal(menu.element.style.opacity, '1');
  menu.element.querySelector('[data-action="collection"]').click();
  const first = menu.element.querySelector('[data-emote="emote-greeting"]');
  const second = menu.element.querySelector('[data-emote="emote-clapping"]');
  first.dispatchEvent(new window.PointerEvent('pointerout', { relatedTarget: second, bubbles: true }));
  second.dispatchEvent(new window.PointerEvent('pointerover', { relatedTarget: first, bubbles: true }));
  run(3); assert.equal(menu.isOpen, true);
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true }));
  run(1); assert.ok(Math.abs(Number(menu.element.style.opacity) - .5) < .001);
  run(1.02); assert.equal(menu.isOpen, false);
});

test('clicking a gap inside the wheel does not punch the character', () => {
  lab.player.controls.isLocked = true; menu.open();
  moveMouse(0, 66 * menu.wheelRect.width / 360);
  menu.update();
  assert.equal(menu.hoveredButton, null); clickPointer();
  assert.equal(menu.isOpen, true); assert.equal(lab.activeEmote, null);
  assert.equal(lab.combatAttack, null); assert.equal(lab.combatPhase, 'none');
});

test('pressing Tab while movement is held leaves exploration uninterrupted and does not display the overlay', () => {
  menu.favorites = ids.slice(0, 8); place(); lab.setViewMode('third-person');
  key(lab.settings.controls.forward, 'z'); run(.15);
  const position = lab.player.position.clone(); key('Tab', 'Tab'); run(.2);
  assert.equal(menu.isOpen, false); assert.equal(lab.activeEmote, null); assert.equal(lab.viewMode, 'third-person');
  assert.ok(position.distanceTo(lab.player.position) > .1);
  assert.equal(lab.player.isLocked, true);
});

test('the collection plays in one click and an empty sector opens favorite management', () => {
  enter(); menu.favorites = ids.slice(0, 8); menu.favorites[0] = null; menu.open();
  menu.element.querySelector('[data-ring-slot="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(menu.element.querySelectorAll('[data-card]').length, 11);
  menu.element.querySelector('[data-emote="emote-hip-hop"]').click();
  assert.equal(lab.activeEmote, 'emote-hip-hop'); assert.equal(menu.isOpen, false);
});

test('a number remapped to movement remains available while the wheel is open', () => {
  const bindings = { ...lab.settings.controls };
  try {
    lab.settings.controls.forward = 'Digit1'; lab.player.input.setBindings(lab.settings.controls);
    enter(); menu.open(); key('Digit1', '&');
    assert.equal(lab.player.getMovementIntent().forward, 1);
    assert.equal(menu.isOpen, false); assert.equal(lab.activeEmote, null);
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

test('C no longer opens the menu and Tab suppresses browser focus navigation', () => {
  place(); key('KeyC', 'c'); assert.equal(menu.isOpen, false);
  const focus = document.activeElement;
  const event = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  assert.equal(menu.isOpen, true); assert.equal(event.defaultPrevented, true);
  assert.equal(document.activeElement, focus);
  key('KeyC', 'c'); assert.equal(menu.isOpen, true);
  key('Tab', 'Tab'); assert.equal(menu.isOpen, false);
});

test('Tab auto-repeat still suppresses browser navigation after the overlay has faded', () => {
  place(); key('Tab', 'Tab'); run(2.02);
  const event = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', repeat: true, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true); assert.equal(menu.isOpen, false);
});

test('logical AZERTY movement closes the overlay in the input event before a game frame', () => {
  place(); menu.open(); key('KeyW', 'z');
  assert.equal(menu.isOpen, false); assert.equal(lab.player.getMovementIntent().forward, 1);
});

test('the equivalent right Control crouch closes the overlay even with the Control modifier set', () => {
  place(); menu.open();
  const event = new KeyboardEvent('keydown', { code: 'ControlRight', key: 'Control', ctrlKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  assert.equal(menu.isOpen, false); assert.equal(event.defaultPrevented, false);
  assert.equal(lab.player.getMovementIntent().crouch, true);
});

for (const view of ['first-person', 'third-person']) test(`hip-hop follows the supplied root trajectory in ${view} while aim remains free`, () => {
  place(); lab.setViewMode(view); lab.player.controls.isLocked = true;
  const data = JSON.parse(readFileSync(new URL('../public/assets/emotes/hip-hop.json', import.meta.url)));
  const source = data.clip.tracks.find(track => track.name.endsWith('Hips.position'));
  const vertical = lab.animations.get('emote-hip-hop').clip.tracks.find(track => track.name.endsWith('Hips.position'));
  const scale = vertical.values[1] / source.values[1] * lab.character.scale.x;
  const start = lab.player.position.clone();
  assert.equal(lab.playEmote('emote-hip-hop'), true);
  const facing = lab.bodyYaw;
  moveMouse(180, 25); run(2.5);
  const raw = new THREE.LinearInterpolant(source.times, source.values, 3).evaluate(lab.emoteElapsed);
  const expected = new THREE.Vector3((raw[0] - source.values[0]) * scale, 0, (raw[2] - source.values[2]) * scale);
  const actual = lab.player.position.clone().sub(start); actual.y = 0;
  assert.ok(actual.length() > .12, `dance still planted: ${actual.toArray()}`);
  assert.ok(actual.distanceTo(expected) < .012, `root path ${actual.toArray()} vs source ${expected.toArray()}`);
  assert.equal(lab.bodyYaw, facing); assert.equal(lab.viewMode, view);
  assert.notEqual(lab.player.getContinuousAimYawRadians(), -Math.PI);
  assert.equal(lab.activeEmote, 'emote-hip-hop');
  if (view === 'first-person') {
    const physicalFoot = lab.leftFootBone.getWorldPosition(new THREE.Vector3());
    const visibleFoot = lab.firstPersonLeftFootBone.getWorldPosition(new THREE.Vector3());
    assert.ok(physicalFoot.distanceTo(visibleFoot) < .02, 'camera framing canceled the emote body movement');
  }
});

test('a looping dance crosses its loop boundary without teleporting or accumulating drift', () => {
  place(); lab.setViewMode('third-person'); assert.equal(lab.playEmote('emote-hip-hop'), true);
  const start = lab.player.position.clone(), previous = start.clone();
  let maxStep = 0, minX = start.x, maxX = start.x;
  const frames = Math.ceil(lab.animations.get('emote-hip-hop').clip.duration * 60);
  for (let i = 0; i < frames; i++) {
    stepLab(lab); maxStep = Math.max(maxStep, previous.distanceTo(lab.player.position));
    minX = Math.min(minX, lab.player.position.x); maxX = Math.max(maxX, lab.player.position.x); previous.copy(lab.player.position);
  }
  assert.ok(maxX - minX > .5, `dance excursion: ${maxX - minX}`); assert.ok(start.distanceTo(lab.player.position) < .03);
  for (let i = 0; i < 4; i++) { stepLab(lab); maxStep = Math.max(maxStep, previous.distanceTo(lab.player.position)); previous.copy(lab.player.position); }
  assert.ok(maxStep < .07, `loop jump: ${maxStep}`); assert.equal(lab.activeEmote, 'emote-hip-hop');
});

for (const view of ['first-person', 'third-person']) test(`Freeze finishes upright without returning backwards or holding its final pose in ${view}`, () => {
  place(); run(.4); lab.setViewMode(view); const restY = lab.hipsBone.position.y;
  assert.equal(lab.playEmote('emote-freeze'), true);
  const start = lab.player.position.clone(); run(5.57);
  const settled = lab.player.position.clone(); assert.ok(start.distanceTo(settled) > 1.5);
  let pelvis = lab.hipsBone.getWorldPosition(new THREE.Vector3()), maxStep = 0;
  for (let i = 0; i < 75; i++) {
    stepLab(lab); const next = lab.hipsBone.getWorldPosition(new THREE.Vector3());
    maxStep = Math.max(maxStep, next.distanceTo(pelvis)); pelvis = next;
    assert.ok(settled.distanceTo(lab.player.position) < .003, 'the recovery tail moved the player backwards');
  }
  assert.equal(lab.activeEmote, null); assert.ok(!lab.currentAnimation.startsWith('emote-'));
  assert.ok(Math.abs(lab.hipsBone.position.y - restY) < .02, 'the hips remained in a lowered dance pose');
  assert.ok(maxStep < .12, `the final pose snapped by ${maxStep} metres`);
  const from = lab.player.position.clone(); key(lab.settings.controls.forward, 'z'); run(.2);
  assert.ok(from.distanceTo(lab.player.position) > .1); release(lab.settings.controls.forward, 'z');
});

for (const view of ['first-person', 'third-person']) test(`RMB above the wheel immediately guards and its release passes through in ${view}`, () => {
  lab.setViewMode(view); lab.player.controls.isLocked = true; menu.open();
  const down = new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true });
  let passed = false; const observe = event => { if (event === down) passed = true; };
  window.addEventListener('mousedown', observe); lab.renderer.domElement.dispatchEvent(down); window.removeEventListener('mousedown', observe);
  assert.equal(menu.isOpen, false); assert.equal(passed, true);
  assert.equal(lab.combatPointerHeld, true); assert.equal(lab.combatLatchReason, 'manual');
  assert.notEqual(lab.combatPhase, 'none');
  lab.renderer.domElement.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
  assert.equal(lab.combatPointerHeld, false);
});

test('RMB with a normal cursor above a UI button guards instead of playing an emote', () => {
  lab.player.controls.isLocked = false; menu.open();
  menu.element.querySelector('[data-slot="1"]').dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
  assert.equal(menu.isOpen, false); assert.equal(lab.activeEmote, null);
  assert.equal(lab.combatPointerHeld, true); assert.notEqual(lab.combatPhase, 'none');
  window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })); assert.equal(lab.combatPointerHeld, false);
});

for (const native of [true, false]) test(`an outside left click closes the picker and immediately attacks from guard (${native ? 'game' : 'normal'} cursor)`, () => {
  lab.player.controls.isLocked = native;
  lab.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
  run(.3); menu.open();
  if (native) moveMouse(window.innerWidth, 0);
  const down = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
  lab.renderer.domElement.dispatchEvent(down);
  assert.equal(menu.isOpen, false); assert.equal(lab.combatLeftPointerHeld, true);
  assert.ok(lab.combatAttack, 'the first outside click did not reach the attack');
  lab.renderer.domElement.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
});

test('a pending UI left-button release never swallows the guard button release', () => {
  lab.player.controls.isLocked = true; menu.open();
  lab.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
  assert.equal(menu.isOpen, false); assert.equal(menu.swallowRelease, true);
  lab.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
  assert.equal(lab.combatPointerHeld, true);
  lab.renderer.domElement.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
  assert.equal(lab.combatPointerHeld, false); assert.equal(menu.swallowRelease, true);
  lab.renderer.domElement.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
});

test('an outside click without a down event closes the normal-cursor overlay', () => {
  lab.player.controls.isLocked = false; menu.open();
  lab.renderer.domElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(menu.isOpen, false);
});

test('sprint, interaction and the combat modifier close the picker without consuming the keyboard input', () => {
  for (const code of ['ShiftRight', lab.settings.controls.interact, 'KeyF']) {
    menu.open(); assert.equal(menu.isOpen, true);
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    let passed = false; const observe = other => { if (other === event) passed = true; };
    window.addEventListener('keydown', observe); window.dispatchEvent(event); window.removeEventListener('keydown', observe);
    assert.equal(menu.isOpen, false); assert.equal(passed, true); assert.equal(event.defaultPrevented, false);
    release(code);
  }
});

for (const view of ['first-person', 'third-person']) for (const id of ['emote-middle-finger', 'emote-follow-me', 'emote-wait']) test(`${id} works without another character, can be favorited and finishes without root drift in ${view}`, () => {
  lab.setViewMode(view);
  const start = lab.player.position.clone(); menu.favorites = ids.slice(0, 8); menu.favorites[0] = null;
  assert.equal(lab.getEmoteUnavailableReason(id), null); menu.open();
  menu.element.querySelector('[data-action="collection"]').click();
  const card = menu.element.querySelector(`[data-card="${id}"]`); assert.ok(card); assert.equal(card.querySelector('[data-emote]').disabled, false);
  card.querySelector('[data-favorite]').click(); assert.equal(menu.favorites[0], id);
  menu.element.querySelector('[data-action="wheel"]').click(); key('Digit1', '1');
  assert.equal(lab.activeEmote, id); run(.9); assert.equal(lab.activeEmote, id);
  if (view === 'first-person') {
    const physical = lab.rightHandBone.getWorldPosition(new THREE.Vector3());
    const visible = lab.firstPersonRightHandBone.getWorldPosition(new THREE.Vector3());
    assert.ok(physical.distanceTo(visible) < .04, 'first-person framing changed the gesture');
  }
  run(2); assert.equal(lab.activeEmote, null); assert.ok(!lab.currentAnimation.startsWith('emote-'));
  assert.ok(start.distanceTo(lab.player.position) < .003);
});

test('the middle-finger pose extends the middle finger while folding the other fingers', () => {
  assert.equal(lab.playEmote('emote-middle-finger'), true); run(.9);
  const find = suffix => lab.character.getObjectByName(`mixamorig${suffix}`) ?? (() => {
    let result; lab.character.traverse(object => { if (object.isBone && object.name.toLowerCase().endsWith(suffix.toLowerCase())) result = object; }); return result;
  })();
  const chord = name => {
    const points = [1, 2, 3].map(i => find(`RightHand${name}${i}`).getWorldPosition(new THREE.Vector3()));
    return points[0].distanceTo(points[2]) / (points[0].distanceTo(points[1]) + points[1].distanceTo(points[2]));
  };
  assert.ok(chord('Middle') > .95); assert.ok(chord('Index') < .85); assert.ok(chord('Ring') < .85); assert.ok(chord('Pinky') < .85);
});

test('a new free gesture can replace an existing favorite when all eight slots are occupied', () => {
  menu.favorites = ids.slice(0, 8); menu.open(); menu.element.querySelector('[data-action="collection"]').click();
  menu.element.querySelector('[data-favorite="emote-wait"]').click();
  assert.equal(menu.replacement, 'emote-wait'); assert.equal(lab.activeEmote, null);
  menu.element.querySelector('[data-replace="0"]').click();
  assert.equal(menu.favorites[0], 'emote-wait'); assert.equal(menu.replacement, null);
  assert.equal(JSON.parse(localStorage.getItem('backrooms.emote-favorites.v1'))[0], 'emote-wait');
  menu.element.querySelector('[data-action="wheel"]').click(); key('Digit1', '1');
  assert.equal(lab.activeEmote, 'emote-wait'); assert.equal(menu.isOpen, false);
});

test('raised fingertips gray the middle-finger gesture under a ceiling that still permits a lower open-palm gesture', () => {
  wall(-10.21, -11.83, .11, .13, 1.78, .035);
  assert.equal(lab.getEmoteUnavailableReason('emote-middle-finger'), 'Pas assez de place');
  assert.equal(lab.getEmoteUnavailableReason('emote-wait'), null);
  menu.open(); menu.element.querySelector('[data-action="collection"]').click();
  assert.equal(menu.element.querySelector('[data-emote="emote-middle-finger"]').disabled, true);
  assert.equal(menu.element.querySelector('[data-emote="emote-wait"]').disabled, false);
});

test('insufficient room grays the dance, blocks mouse and number selection, and leaves small gestures available', () => {
  place(); wall(-9.28, -12); menu.favorites = ids.slice(0, 8); menu.open();
  const dance = menu.element.querySelector('[data-emote="emote-hip-hop"]');
  assert.equal(dance.disabled, true); assert.equal(dance.getAttribute('aria-disabled'), 'true');
  assert.equal(dance.title, 'Pas assez de place');
  assert.equal(menu.element.querySelector('[data-emote="emote-clapping"]').disabled, false);
  dance.click(); key('Digit5', '5'); assert.equal(lab.activeEmote, null); assert.equal(menu.isOpen, true);
  assert.equal(lab.playEmote('emote-hip-hop'), false);
  menu.element.querySelector('[data-action="collection"]').click();
  assert.equal(menu.element.querySelector('[data-card="emote-hip-hop"]').classList.contains('is-unavailable'), true);
  assert.equal(menu.element.querySelectorAll('[data-emote-reason]').length,0);
  const blocked=menu.element.querySelector('[data-card="emote-hip-hop"] [data-emote]');
  blocked.dispatchEvent(new Event('pointerover',{bubbles:true}));
  assert.equal(menu.element.querySelector('[data-favorite-status]').textContent,'Pas assez de place');
  assert.equal(menu.element.querySelectorAll('[role="status"]').length,1);
  assert.equal(menu.element.querySelector('[data-favorite="emote-hip-hop"]').disabled, false);
  lab.physics.removeChunk('emote-test-obstacle'); menu.refreshAvailability(true);
  assert.equal(menu.element.querySelector('[data-emote="emote-hip-hop"]').disabled, false);
  menu.element.querySelector('[data-emote="emote-hip-hop"]').click(); assert.equal(lab.activeEmote, 'emote-hip-hop');
});

test('clearance follows facing and includes nearby actors, low ceilings and unsupported floor', () => {
  place(); wall(-9.2, -12);
  assert.equal(lab.getEmoteUnavailableReason('emote-hip-hop'), 'Pas assez de place');
  lab.bodyYaw = Math.PI / 2;
  assert.equal(lab.getEmoteUnavailableReason('emote-hip-hop'), null);
  lab.physics.removeChunk('emote-test-obstacle'); lab.bodyYaw = 0;
  lab.physics.setMeleeOpponentBlocker({ x: -9.1, y: .865, z: -12 }, true);
  lab.physics.stepDynamics(1 / 60);
  assert.equal(lab.getEmoteUnavailableReason('emote-hip-hop'), 'Pas assez de place');
  assert.equal(lab.getEmoteUnavailableReason('emote-clapping'), null);
  lab.syncNpcPlayerBlocker(true);
  wall(-10, -12, 2, 2, 1.6, .1);
  assert.equal(lab.getEmoteUnavailableReason('emote-clapping'), 'Pas assez de place');
  lab.physics.removeChunk('emote-test-obstacle'); place(-9, -9.35);
  assert.equal(lab.getEmoteUnavailableReason('emote-hip-hop'), 'Pas assez de place', 'pose over a pit was accepted');
});

test('a new obstruction stops an active dance and authored movement cannot tunnel through a wall', () => {
  place(); assert.equal(lab.playEmote('emote-hip-hop'), true); run(.6);
  wall(-9.28, -12); run(.25);
  assert.equal(lab.activeEmote, null);
  lab.physics.removeChunk('emote-test-obstacle'); place(); wall(-9, -12, .1, 2);
  lab.player.setAnimationRootStep({ x: 1.8, y: 0, z: 0 }); lab.player.fixedUpdate(1 / 60);
  assert.ok(lab.player.position.x < -9.42, `capsule crossed wall: ${lab.player.position.x}`);
  assert.equal(lab.player.isAnimationRootBlocked(), true);
  const stopped = lab.player.position.clone(); lab.player.fixedUpdate(1 / 60);
  assert.ok(stopped.distanceTo(lab.player.position) < .003, 'authored motion left residual velocity');
});
