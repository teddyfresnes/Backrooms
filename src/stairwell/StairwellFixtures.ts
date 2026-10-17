import * as THREE from 'three';

export function roundedFixtureOutline(width: number, height: number, radius: number): THREE.Shape {
  const s = new THREE.Shape(), x = -width / 2, y = -height / 2, r = radius;
  s.moveTo(x + r, y); s.lineTo(x + width - r, y);
  s.quadraticCurveTo(x + width, y, x + width, y + r); s.lineTo(x + width, y + height - r);
  s.quadraticCurveTo(x + width, y + height, x + width - r, y + height); s.lineTo(x + r, y + height);
  s.quadraticCurveTo(x, y + height, x, y + height - r); s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** One hollow cast-iron section: curved shoulders, open core and connecting end caps. */
export function createCastIronSection(bevel = true): THREE.BufferGeometry {
  const shape = roundedFixtureOutline(.17, .46, .046);
  const hole = roundedFixtureOutline(.074, .30, .03);
  shape.holes.push(new THREE.Path(hole.getPoints(2).reverse()));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: .038, bevelEnabled: bevel, bevelSegments: 1, bevelThickness: .003, bevelSize: .003, curveSegments: 2, steps: 1,
  });
  geometry.rotateY(Math.PI / 2); geometry.translate(-.019, 0, 0);
  geometry.clearGroups();
  return geometry;
}
