export interface MoveAxes {
  forward: number;
  right: number;
  sprint: boolean;
  crouch: boolean;
}

export class InputManager {
  private readonly pressed = new Set<string>();
  private readonly justPressed = new Set<string>();
  private enabled = true;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
  }

  get axes(): MoveAxes {
    if (!this.enabled) {
      return { forward: 0, right: 0, sprint: false, crouch: false };
    }
    const forward = Number(this.has('KeyW', 'KeyZ', 'ArrowUp')) - Number(this.has('KeyS', 'ArrowDown'));
    const right = Number(this.has('KeyD', 'ArrowRight')) - Number(this.has('KeyA', 'KeyQ', 'ArrowLeft'));
    return {
      forward,
      right,
      sprint: this.has('ShiftLeft', 'ShiftRight'),
      crouch: this.has('ControlLeft', 'ControlRight'),
    };
  }

  consumePress(code: string): boolean {
    if (!this.enabled) return false;
    const available = this.justPressed.has(code);
    this.justPressed.delete(code);
    return available;
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
    this.pressed.delete(event.code);
  };

  private readonly clear = (): void => {
    this.pressed.clear();
    this.justPressed.clear();
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
