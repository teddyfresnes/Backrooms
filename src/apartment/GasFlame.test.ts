import * as THREE from 'three';
import { expect, it } from 'vitest';
import { burnerTop, GasFlame, panBase } from './GasFlame';

function pan(): THREE.Group {
  // A 20 cm pan whose long handle widens its bounds on +X.
  const group = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .06, 24));
  body.position.set(0, 1.03, 0);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(.2, .02, .03)); handle.position.set(.2, 1.05, 0);
  group.add(body, handle); return group;
}

it('centres the burner on the pan bottom, not on its handle-widened bounds', () => {
  const base = panBase(pan())!;
  expect(base.center.x).toBeCloseTo(0, 2); expect(base.bottomY).toBeCloseTo(1, 3);
  expect(base.radius).toBeGreaterThan(.08);
});

it('keeps every flame tongue under the pan bottom and inside the ring', () => {
  const stove = new THREE.Mesh(new THREE.BoxGeometry(.5, .04, .5)); stove.position.y = .955;
  const base = panBase(pan())!, top = burnerTop(stove, base)!;
  expect(top).toBeCloseTo(.975, 3);
  const gap = base.bottomY - top, flame = new GasFlame(.05, gap);
  flame.group.position.set(base.center.x, top, base.center.z); flame.group.updateMatrixWorld(true);
  const position = flame.geometry.getAttribute('position'), v = new THREE.Vector3();
  let highest = -Infinity, widest = 0;
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(flame.group.matrixWorld);
    highest = Math.max(highest, v.y); widest = Math.max(widest, Math.hypot(v.x, v.z));
  }
  expect(highest).toBeLessThan(base.bottomY - .002);
  expect(widest).toBeLessThan(base.radius);
  flame.update(true, 0, .5); expect(flame.intensity).toBeGreaterThan(.8);
  flame.update(false, 1, 1); expect(flame.intensity).toBe(0); expect(flame.group.visible).toBe(false);
  flame.dispose();
});
