import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ApartmentLightSwitchInteraction } from './ApartmentLightSwitchInteraction';

const makeInteraction = () => {
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1));
  target.position.set(0, 1.5, -1);
  const ui = { setInteraction: vi.fn() };
  let enabled = false;
  const onToggle = vi.fn();
  const interaction = new ApartmentLightSwitchInteraction(
    target,
    ui,
    () => enabled,
    (value) => { enabled = value; },
    2.2,
    onToggle,
  );
  return { interaction, ui, getEnabled: () => enabled, onToggle };
};

describe('apartment light switch interaction', () => {
  it('shows the current action and toggles the apartment lights', () => {
    const { interaction, ui, getEnabled, onToggle } = makeInteraction();
    const player = new THREE.Vector3(-0.5, 0.77, 0);
    const towardSwitch = new THREE.Vector3(0.5, 0, -1).normalize();

    interaction.update(player, towardSwitch, true);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Allumer la lumière');
    expect(interaction.interact(player, towardSwitch, true)).toBe(true);
    expect(getEnabled()).toBe(true);
    expect(onToggle).toHaveBeenLastCalledWith(true);
    interaction.update(player, towardSwitch, true);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Éteindre la lumière');
  });

  it('ignores distant, reversed and unlocked interaction attempts', () => {
    const { interaction, getEnabled } = makeInteraction();
    expect(interaction.interact(
      new THREE.Vector3(0, 0.77, -4),
      new THREE.Vector3(0, 0, 1),
      true,
    )).toBe(false);
    expect(interaction.interact(
      new THREE.Vector3(0, 0.77, 0),
      new THREE.Vector3(0, 0, 1),
      true,
    )).toBe(false);
    expect(interaction.interact(
      new THREE.Vector3(0, 0.77, 0),
      new THREE.Vector3(0, 0, -1),
      false,
    )).toBe(false);
    expect(getEnabled()).toBe(false);
  });
});
