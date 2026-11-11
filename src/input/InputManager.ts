export interface MoveAxes {
  forward: number;
  right: number;
  vertical: number;
  sprint: boolean;
  crouch: boolean;
}

export class InputManager {
  private readonly inputDocument=typeof document==='undefined'?undefined:document;
  private readonly pressed = new Set<string>();
  private readonly justPressed = new Set<string>();
  private readonly justReleased = new Set<string>();
  private readonly physical = new Map<string, string>();
  private enabled = true;
  private preserveMovement = false;
  private bindings = defaultControlBindings();
  private actionCodes=Object.fromEntries(controlActions.map(action=>[action,actionKeyCodes(this.bindings,action)])) as Record<ControlAction,readonly string[]>;
  private gameCodes=new Set(Object.values(this.actionCodes).flat());

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    this.inputDocument?.addEventListener('visibilitychange', this.onVisibility);
  }

  get axes(): MoveAxes {
    if (!this.enabled) return { forward: 0, right: 0, vertical: 0, sprint: false, crouch: false };
    const forward = Number(this.isActionPressed('forward')) - Number(this.isActionPressed('backward'));
    const right = Number(this.isActionPressed('right')) - Number(this.isActionPressed('left'));
    const crouch = this.isActionPressed('crouch');
    const vertical = Number(this.isActionPressed('jump')) - Number(crouch);
    return { forward, right, vertical, sprint: this.isActionPressed('sprint'), crouch };
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
  isPressed(code: string): boolean { return this.enabled && this.pressed.has(code); }
  setBindings(bindings: ControlBindings): void {
    this.bindings = { ...bindings };
    this.actionCodes=Object.fromEntries(controlActions.map(action=>[action,actionKeyCodes(this.bindings,action)])) as Record<ControlAction,readonly string[]>;
    this.gameCodes=new Set(Object.values(this.actionCodes).flat());this.clear();
  }
  consumeActionPress(action: ControlAction): boolean {
    if (!this.enabled) return false;
    let available = false;
    for (const code of this.actionCodes[action]) {
      if (!this.justPressed.has(code)) continue;
      this.justPressed.delete(code);
      available = true;
    }
    return available;
  }
  consumeActionRelease(action: ControlAction): boolean {
    if (!this.enabled) return false;
    if(this.isActionPressed(action)){
      for(const code of this.actionCodes[action])this.justReleased.delete(code);
      return false;
    }
    for (const code of this.actionCodes[action]) {
      if (!this.justReleased.has(code)) continue;
      this.justReleased.delete(code);
      return true;
    }
    return false;
  }
  isActionPressed(action: ControlAction): boolean {
    return this.enabled && this.has(...this.actionCodes[action]);
  }
  /** Scripted shots may retain held movement, without buffering one-shot actions. */
  setEnabled(enabled: boolean, preserveMovement = false): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.preserveMovement = !enabled && preserveMovement;
    if (!enabled) {
      if (!preserveMovement) this.clear();
      else {
        this.justPressed.clear(); this.justReleased.clear();
        for (const [physical, code] of this.physical) if (!this.isMovementCode(code)) this.physical.delete(physical);
        for (const code of this.pressed) if (!this.isMovementCode(code)) this.pressed.delete(code);
      }
    }
  }
  private isMovementCode(code: string): boolean {
    return (['forward', 'backward', 'left', 'right', 'sprint'] as const).some(action => this.actionCodes[action].includes(code));
  }
  private has(...codes: string[]): boolean { return codes.some((code) => this.pressed.has(code)); }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled && !this.preserveMovement) return;
    if (isEditableKeyTarget(event) || event.isComposing || event.metaKey || event.altKey) { this.clear(); return; }
    const code = controlCodeFromKeyboardEvent(event);
    if (!this.enabled && !this.isMovementCode(code)) return;
    const mapped = this.gameCodes.has(code);
    if (event.ctrlKey && !mapped) { this.clear(); return; }
    if (mapped) event.preventDefault();
    this.physical.set(event.code, code);
    if (this.enabled && !this.pressed.has(code)) this.justPressed.add(code);
    this.pressed.add(code);
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const code = this.physical.get(event.code) ?? controlCodeFromKeyboardEvent(event);
    this.physical.delete(event.code);
    if (this.enabled && !isEditableKeyTarget(event) && this.pressed.has(code)) this.justReleased.add(code);
    if (![...this.physical.values()].includes(code)) this.pressed.delete(code);
  };
  private readonly clear = (): void => {
    this.pressed.clear(); this.justPressed.clear(); this.justReleased.clear(); this.physical.clear();
  };
  private readonly onVisibility = (): void => { if (this.inputDocument?.hidden) this.clear(); };
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    this.inputDocument?.removeEventListener('visibilitychange', this.onVisibility);
  }
}

import {
  controlCodeFromKeyboardEvent,
  defaultControlBindings,
  actionKeyCodes,
  controlActions,
  isEditableKeyTarget,
  type ControlAction,
  type ControlBindings,
} from './ControlBindings';
