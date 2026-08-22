import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { ApartmentWindowBlindRuntime } from './ImportedApartmentEnvironment';
import { ApartmentWindowBlindsInteraction } from './ApartmentWindowBlindsInteraction';

const makeBlind = (id: string, x: number): ApartmentWindowBlindRuntime => {
  const pivot = new THREE.Group();
  const blind = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.12));
  blind.position.set(x, -0.08, -1);
  pivot.position.y = 0.08;
  pivot.add(blind);
  return { id, blind, pivot, closedScaleY: id === 'first' ? 8 : 6 };
};

const makeInteraction = () => {
  const blinds = [makeBlind('first', 0), makeBlind('second', 2)] as const;
  const ui = { setInteraction: vi.fn() };
  const interaction = new ApartmentWindowBlindsInteraction(blinds, ui);
  return { blinds, ui, interaction };
};

describe('apartment window blinds interaction', () => {
  it('opens and closes only the blind being viewed', () => {
    const { blinds, ui, interaction } = makeInteraction();
    const player = new THREE.Vector3(0, -0.73, 0);
    const towardFirst = new THREE.Vector3(0, 0, -1);

    interaction.update(0, player, towardFirst, true);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Fermer les stores');
    expect(interaction.interact(player, towardFirst, true)).toBe(true);
    expect(interaction.getState()).toEqual([false, true]);
    expect(interaction.getClosureProgress()).toEqual([0, 0]);

    for (let frame = 0; frame < 90; frame += 1) {
      interaction.update(1 / 60, player, towardFirst, true);
    }
    expect(blinds[0].pivot.scale.y).toBeCloseTo(8, 5);
    expect(blinds[1].pivot.scale.y).toBeCloseTo(1, 5);
    expect(interaction.getClosureProgress()).toEqual([1, 0]);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Ouvrir les stores');
  });

  it('restores both states and ignores invalid or distant interactions', () => {
    const { blinds, interaction } = makeInteraction();

    expect(interaction.restoreState([false, true])).toBe(true);
    expect(blinds[0].pivot.scale.y).toBe(8);
    expect(blinds[1].pivot.scale.y).toBe(1);
    expect(interaction.restoreState([true] as never)).toBe(false);
    expect(interaction.interact(
      new THREE.Vector3(0, -0.73, 5),
      new THREE.Vector3(0, 0, -1),
      true,
    )).toBe(false);
    expect(interaction.interact(
      new THREE.Vector3(0, -0.73, 0),
      new THREE.Vector3(0, 0, -1),
      false,
    )).toBe(false);
  });
});
