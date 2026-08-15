export interface MoveAxes {
  forward: number;
  right: number;
  vertical: number;
  sprint: boolean;
  crouch: boolean;
}

export class InputManager {
  private readonly pressed = new Set<string>();
  private readonly justPressed = new Set<string>();
  private readonly justReleased = new Set<string>();
  private enabled = true;
  private bindings = defaultControlBindings();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
  }

  get axes(): MoveAxes {
    if (!this.enabled) {
      return { forward: 0, right: 0, vertical: 0, sprint: false, crouch: false };
    }
    const forward = Number(this.isActionPressed('forward')) - Number(this.isActionPressed('backward'));
    const right = Number(this.isActionPressed('right')) - Number(this.isActionPressed('left'));
    const crouch = this.isActionPressed('crouch');
    const vertical = Number(this.isActionPressed('jump')) - Number(crouch);
    return {
      forward,
      right,
      vertical,
      sprint: this.isActionPressed('sprint'),
      crouch,
    };
  }

  consumePress(code: string): boolean {
    if (!this.enabled) return false;
    const available = this.justPressed.has(code);
    this.justPressed.delete(code);
    return available;
  }

  consumeRelease(code: string): boolean {
    if (!this.enabled) return false;
    const available = this.justReleased.has(code);
    this.justReleased.delete(code);
    return available;
  }

  isPressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  setBindings(bindings: ControlBindings): void {
    this.bindings = { ...bindings };
    this.clear();
  }

  consumeActionPress(action: ControlAction): boolean {
    if (!this.enabled) return false;
    for (const code of equivalentKeyCodes(this.bindings[action])) {
      if (!this.justPressed.has(code)) continue;
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  consumeActionRelease(action: ControlAction): boolean {
    if (!this.enabled) return false;
    for (const code of equivalentKeyCodes(this.bindings[action])) {
      if (!this.justReleased.has(code)) continue;
      this.justReleased.delete(code);
      return true;
    }
    return false;
  }

  isActionPressed(action: ControlAction): boolean {
    return this.enabled && this.has(...equivalentKeyCodes(this.bindings[action]));
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  private has(...codes: string[]): boolean {
    return codes.some((code) => this.pressed.has(code));
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || InputManager.isEditableTarget(event.target)) return;
    if (!this.pressed.has(event.code)) this.justPressed.add(event.code);
    this.pressed.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (InputManager.isEditableTarget(event.target)) return;
    if (this.enabled && this.pressed.has(event.code)) this.justReleased.add(event.code);
    this.pressed.delete(event.code);
  };

  private readonly clear = (): void => {
    this.pressed.clear();
    this.justPressed.clear();
    this.justReleased.clear();
  };

  private static isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || target.isContentEditable;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
  }
}
import {
  defaultControlBindings,
  equivalentKeyCodes,
  type ControlAction,
  type ControlBindings,
} from './ControlBindings';
