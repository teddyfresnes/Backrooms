import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () =>
  import('../../node_modules/@dimforge/rapier3d/rapier.js'),
);

import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createStairwellPlan } from './createStairwellPlan';
import { MAIL_STAIR_GATE, MAIL_SECOND_FLIGHT_GATE } from './HallArrivalStory';
import * as THREE from 'three';
import { StairwellDetails } from './StairwellDetails';
import type { StairwellMaterialSet } from './StairwellMaterials';
import { disposeObject3D } from './geometry';
import {
  midLandingY,
  STAIRWELL_LEFT_FLIGHT,
  STAIRWELL_STEPS_PER_FLIGHT,
  floorY,
  STAIRWELL_FLIGHT_COUNT,
  STAIRWELL_SPAWN,
} from './layout';

const activeWorlds: PhysicsWorld[] = [];

afterEach(() => {
  for (const physics of activeWorlds.splice(0)) physics.dispose();
});

describe('Russian stairwell physics', () => {
  it.each([2.8, 5.8, 7.5])('climbs and descends the real narrow treads at %s m/s without getting stuck', async speed => {
    const physics = await PhysicsWorld.create(createStairwellPlan()); activeWorlds.push(physics); physics.teleport({ x: -1.05, y: .865, z: -2.1 });
    for (let tick = 0; tick < 300 && physics.getPosition().z < 2.1; tick++) physics.move({ x: 0, y: -.015, z: speed / 60 });
    expect(physics.getPosition().z).toBeGreaterThan(2.05); expect(physics.getPosition().y).toBeCloseTo(midLandingY(0) + .865, 2);
    for (let tick = 0; tick < 300 && physics.getPosition().z > -2.1; tick++) physics.move({ x: 0, y: -.015, z: -speed / 60 });
    expect(physics.getPosition().z).toBeLessThan(-2.05); expect(physics.getPosition().y).toBeCloseTo(.865, 2);
  });
  it('physically blocks the first ascent until the mail gate is removed, then restores the real stairs', async () => {
    const physics = await PhysicsWorld.create(createStairwellPlan()); activeWorlds.push(physics);
    physics.addChunk('mail-story-gate', [MAIL_STAIR_GATE, MAIL_SECOND_FLIGHT_GATE], { x: 0, y: 0, z: 0 });
    for (let tick = 0; tick < 500; tick++) physics.move({ x: 0, y: -.015, z: .045 });
    expect(physics.getPosition().z).toBeGreaterThan(1.45); expect(physics.getPosition().z).toBeLessThan(1.75);
    expect(physics.getPosition().y).toBeCloseTo(midLandingY(0) + .865, 2);
    physics.removeChunk('mail-story-gate');
    for (let tick = 0; tick < 100 && physics.getPosition().z < 1.5; tick++) physics.move({ x: 0, y: -.015, z: .045 });
    expect(physics.getPosition().z).toBeGreaterThan(1.4); expect(physics.getPosition().y).toBeCloseTo(midLandingY(0) + .865, 2);
  });
  it('starts just inside the entrance and walks freely toward the first flight', async () => {
    const physics = await PhysicsWorld.create(createStairwellPlan()); activeWorlds.push(physics);
    expect(physics.getPosition().z).toBeCloseTo(STAIRWELL_SPAWN.z, 4);
    expect(physics.getPosition().z).toBeLessThan(-4.8);
    for (let tick = 0; tick < 40; tick++) physics.move({ x: 0, y: -.015, z: .04 });
    expect(physics.getPosition().z).toBeGreaterThan(-3.7);
    expect(physics.getPosition().y).toBeCloseTo(.865, 2);
  });

  it('walks the Rapier player up the first real stair flight to its mid landing', async () => {
    const plan = createStairwellPlan();
    const firstFlight = plan.colliders.filter((collider) =>
      collider.id.startsWith('left-flight-0-step-'),
    );
    expect(firstFlight).toHaveLength(STAIRWELL_STEPS_PER_FLIGHT);

    const physics = await PhysicsWorld.create(plan);
    activeWorlds.push(physics);

    for (
      let tick = 0;
      tick < 180 && physics.getPosition().z < STAIRWELL_LEFT_FLIGHT.maxZ + 0.4;
      tick += 1
    ) {
      physics.move({ x: 0, y: -0.015, z: 0.045 });
    }

    expect(physics.getPosition().z).toBeGreaterThan(STAIRWELL_LEFT_FLIGHT.maxZ + 0.2);
    expect(physics.getPosition().y).toBeCloseTo(midLandingY(0) + 0.865, 2);
  });

  it('climbs all furnished landings and returns to the entrance without getting caught on detail', async () => {
    const material = new THREE.MeshStandardMaterial();
    const details = new StairwellDetails(new Proxy({} as StairwellMaterialSet, { get: () => material }), new THREE.Texture());
    try {
      const physics = await PhysicsWorld.create(createStairwellPlan()); activeWorlds.push(physics);
      physics.addChunk('residential-details', details.colliders, { x: 0, y: 0, z: 0 });
      const walk = (x: number, z: number) => {
        for (let tick = 0; tick < 240; tick++) {
          const p = physics.getPosition(), dx = x - p.x, dz = z - p.z, distance = Math.hypot(dx, dz);
          if (distance < .07) break;
          physics.move({ x: dx / distance * .04, y: -.015, z: dz / distance * .04 });
        }
        const p = physics.getPosition(); expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(.12);
      };
      walk(-1.05, -2);
      for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level++) {
        walk(-1.05, 2.25); expect(physics.getPosition().y).toBeCloseTo(midLandingY(level) + .865, 2);
        walk(1.05, 2.25); walk(1.05, -2);
        expect(physics.getPosition().y).toBeCloseTo(floorY(level + 1) + .865, 2);
        walk(-1.05, -2);
      }
      for (let level = STAIRWELL_FLIGHT_COUNT - 1; level >= 0; level--) {
        walk(1.05, -2); walk(1.05, 2.25); walk(-1.05, 2.25); walk(-1.05, -2);
      }
      walk(0, -5.3); expect(physics.getPosition().y).toBeCloseTo(.865, 2);
    } finally { disposeObject3D(details.group); details.dispose(); material.dispose(); }
  });
});

it.each([30,60,120].flatMap(fps=>[2.8,5.8,7.5].map(speed=>({fps,speed}))))('keeps a grounded recoil at the top of the first flight at $fps Hz / $speed m/s',async({fps,speed})=>{
 const physics=await PhysicsWorld.create(createStairwellPlan());activeWorlds.push(physics);
 physics.addChunk('mail-gates',[MAIL_STAIR_GATE,MAIL_SECOND_FLIGHT_GATE],{x:0,y:0,z:0});
 for(let tick=0;tick<fps*8;tick++)physics.move({x:0,y:-.9/fps,z:speed/fps});
 const top=physics.getPosition();expect(top.z).toBeGreaterThan(1.43);expect(top.z).toBeLessThan(1.8);expect(top.y).toBeCloseTo(midLandingY(0)+.865,2);
 for(let tick=0;tick<Math.ceil(.18*fps);tick++)physics.move({x:0,y:-.9/fps,z:-Math.min(1.1/fps,Math.max(0,physics.getPosition().z-1.38))});
 expect(physics.getPosition().z).toBeGreaterThan(1.3);expect(physics.getPosition().y).toBeCloseTo(midLandingY(0)+.865,2);
 for(let tick=0;tick<fps*5&&physics.getPosition().z>-2;tick++)physics.move({x:0,y:-.9/fps,z:-2.8/fps});
 expect(physics.getPosition().z).toBeLessThan(-1.9);expect(physics.getPosition().y).toBeCloseTo(.865,2);
});
