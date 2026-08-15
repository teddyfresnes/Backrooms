import { describe, expect, it } from 'vitest';
import {
  defaultControlBindings,
  detectKeyboardPreset,
  formatKeyLabel,
  remapControlBinding,
  sanitizeControlBindings,
} from './ControlBindings';

describe('control bindings', () => {
  it('provides complete AZERTY and QWERTY presets', () => {
    const azerty = defaultControlBindings('azerty');
    const qwerty = defaultControlBindings('qwerty');

    expect(azerty).toMatchObject({ forward: 'KeyZ', left: 'KeyQ' });
    expect(qwerty).toMatchObject({ forward: 'KeyW', left: 'KeyA' });
    expect(detectKeyboardPreset(azerty)).toBe('azerty');
    expect(detectKeyboardPreset(qwerty)).toBe('qwerty');
  });

  it('keeps valid custom bindings and rejects incomplete or conflicting data', () => {
    const custom = { ...defaultControlBindings(), interact: 'KeyF' };

    expect(sanitizeControlBindings(custom)).toEqual(custom);
    expect(detectKeyboardPreset(custom)).toBeNull();
    expect(sanitizeControlBindings({ ...custom, jump: 'KeyF' })).toEqual(defaultControlBindings());
    expect(sanitizeControlBindings({ ...custom, crouch: 'ShiftRight' })).toEqual(defaultControlBindings());
    expect(sanitizeControlBindings({ interact: 'KeyF' })).toEqual(defaultControlBindings());
  });

  it('formats physical keyboard codes for the menu', () => {
    expect(formatKeyLabel('KeyZ')).toBe('Z');
    expect(formatKeyLabel('Space')).toBe('Espace');
    expect(formatKeyLabel('ControlRight')).toBe('Ctrl');
    expect(formatKeyLabel('ArrowUp')).toBe('↑');
  });

  it('swaps occupied keys instead of creating a conflict', () => {
    const original = defaultControlBindings();
    const result = remapControlBinding(original, 'jump', 'KeyE');

    expect(result.swappedAction).toBe('interact');
    expect(result.bindings.jump).toBe('KeyE');
    expect(result.bindings.interact).toBe('Space');
    expect(original.jump).toBe('Space');
  });
});
