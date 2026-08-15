import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HallExitInteraction } from './HallExitInteraction';

const makeInteraction = () => {
  const door = new THREE.Group();
  door.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.7, 0.12)));
  door.position.set(0, 1.35, -4);
  door.updateMatrixWorld(true);
  const ui = { setInteraction: vi.fn() };
  const enter = vi.fn();
  return {
    interaction: new HallExitInteraction(door, ui, enter),
    ui,
    enter,
  };
};

describe('HallExitInteraction', () => {
  it('shows the portal prompt and enters once when E targets the hall door', () => {
    const { interaction, ui, enter } = makeInteraction();
    const player = new THREE.Vector3(0, 0.865, -1.4);
    const towardDoor = new THREE.Vector3(0, 0, -1);

    interaction.update(player, towardDoor, true);
    expect(ui.setInteraction).toHaveBeenLastCalledWith('Entrer dans les Backrooms');
    expect(interaction.interact(player, towardDoor, true)).toBe(true);
    expect(enter).toHaveBeenCalledOnce();
    expect(interaction.interact(player, towardDoor, true)).toBe(false);
    expect(enter).toHaveBeenCalledOnce();
  });

  it('does nothing while unlocked, too far away or looking elsewhere', () => {
    const { interaction, ui, enter } = makeInteraction();
    interaction.update(new THREE.Vector3(0, 0.865, -1.4), new THREE.Vector3(0, 0, -1), false);
    interaction.update(new THREE.Vector3(0, 0.865, 1), new THREE.Vector3(0, 0, -1), true);
    interaction.update(new THREE.Vector3(0, 0.865, -1.4), new THREE.Vector3(0, 0, 1), true);

    expect(enter).not.toHaveBeenCalled();
    expect(ui.setInteraction).not.toHaveBeenCalledWith('Entrer dans les Backrooms');
  });
});
