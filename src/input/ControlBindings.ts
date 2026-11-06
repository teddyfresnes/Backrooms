export const controlActions = [
  'forward',
  'backward',
  'left',
  'right',
  'sprint',
  'jump',
  'crouch',
  'interact',
] as const;

export type ControlAction = typeof controlActions[number];
export type ControlBindings = Record<ControlAction, string>;
export type KeyboardPreset = 'azerty' | 'qwerty';

const azertyBindings: ControlBindings = {
  forward: 'KeyZ',
  backward: 'KeyS',
  left: 'KeyQ',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  crouch: 'Digit0',
  interact: 'KeyE',
};

const qwertyBindings: ControlBindings = {
  ...azertyBindings,
  forward: 'KeyW',
  left: 'KeyA',
};

const forbiddenCodes = new Set([
  'Escape',
  'Tab',
  'Enter',
  'NumpadEnter',
  'MetaLeft',
  'MetaRight',
  'ContextMenu',
  'PrintScreen',
  'Pause',
  'KeyP',
]);

const namedLabels: Readonly<Record<string, string>> = {
  Space: 'Espace',
  ShiftLeft: 'Maj',
  ShiftRight: 'Maj',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: 'Retour',
  Delete: 'Suppr',
  Insert: 'Inser',
  Home: 'Début',
  End: 'Fin',
  PageUp: 'Page ↑',
  PageDown: 'Page ↓',
  CapsLock: 'Verr. Maj',
  Backquote: '²',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export const defaultControlBindings = (preset: KeyboardPreset = 'azerty'): ControlBindings => ({
  ...(preset === 'qwerty' ? qwertyBindings : azertyBindings),
});

/** Letter bindings follow the active layout; non-letter keys keep their physical code. */
export const controlCodeFromKeyboardEvent = (
  event: Pick<KeyboardEvent, 'code' | 'key'>,
): string => (/^(?:Numpad|Arrow)/.test(event.code) ? event.code : /^[a-z]$/i.test(event.key) ? `Key${event.key.toUpperCase()}` : event.code);

export const isBindableCode = (code: string): boolean => {
  if (!code || forbiddenCodes.has(code)) return false;
  return /^(?:Key[A-Z]|Digit[0-9]|Numpad\w+|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[0-2])|[A-Z][A-Za-z0-9]+)$/.test(code);
};

export const formatKeyLabel = (code: string): string => {
  if (namedLabels[code]) return namedLabels[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Pavé ${code.slice(6)}`;
  return code;
};

export const equivalentKeyCodes = (code: string): readonly string[] => {
  if (code === 'ShiftLeft' || code === 'ShiftRight') return ['ShiftLeft', 'ShiftRight'];
  if (code === 'ControlLeft' || code === 'ControlRight') return ['ControlLeft', 'ControlRight'];
  if (code === 'AltLeft' || code === 'AltRight') return ['AltLeft', 'AltRight'];
  return [code];
};

/** Fixed physical alternatives coexist with the configurable main bindings. */
export const secondaryControlCodes: Readonly<Record<ControlAction, readonly string[]>> = {
  forward: ['ArrowUp'], backward: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  sprint: ['ShiftRight'], jump: ['ControlLeft', 'ControlRight'],
  crouch: ['Digit0', 'Numpad0'], interact: ['Numpad1'],
};
export const actionKeyCodes = (bindings: ControlBindings, action: ControlAction): readonly string[] => {
  const primary = equivalentKeyCodes(bindings[action]).filter(code =>
    !controlActions.some(other => other !== action && secondaryControlCodes[other].includes(code)));
  return [...new Set([...primary, ...secondaryControlCodes[action]])];
};
export const matchesControlAction = (event: Pick<KeyboardEvent, 'code' | 'key'>, bindings: ControlBindings, action: ControlAction): boolean =>
  actionKeyCodes(bindings, action).includes(controlCodeFromKeyboardEvent(event));
export const canBindControlAction = (action:ControlAction,code:string):boolean => isBindableCode(code)
  && !controlActions.some(other=>other!==action&&equivalentKeyCodes(code).some(key=>secondaryControlCodes[other].includes(key)));
export const isEditableKeyTarget = (event: KeyboardEvent): boolean =>
  event.composedPath().some(target => typeof HTMLElement!=='undefined' && target instanceof HTMLElement &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable));

export const bindingConflictKey = (code: string): string => {
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Control';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  return code;
};

export const sanitizeControlBindings = (
  value: unknown,
  fallback = defaultControlBindings(),
): ControlBindings => {
  const candidate = typeof value === 'object' && value !== null
    ? { ...value as Partial<Record<ControlAction, unknown>> }
    : {};
  // v46 and earlier used Ctrl for crouch. The newly requested Ctrl jump owns
  // that physical key; migrate only this conflict, keeping other saved keys.
  if (candidate.crouch === 'ControlLeft' || candidate.crouch === 'ControlRight') candidate.crouch = 'Digit0';
  const requested = controlActions.map((action) => candidate[action]);
  const valid = requested.every((code): code is string => (
    typeof code === 'string' && isBindableCode(code)
  ));
  if (!valid) return { ...fallback };
  const unique = new Set(requested.map((code) => bindingConflictKey(code)));
  if (unique.size !== controlActions.length) return { ...fallback };
  return Object.fromEntries(
    controlActions.map((action, index) => [action, requested[index]]),
  ) as ControlBindings;
};

export const remapControlBinding = (
  bindings: ControlBindings,
  action: ControlAction,
  code: string,
): { bindings: ControlBindings; swappedAction?: ControlAction } => {
  if (!canBindControlAction(action,code)) return { bindings: { ...bindings } };
  const previousCode = bindings[action];
  const swappedAction = controlActions.find((candidate) => (
    candidate !== action && bindingConflictKey(bindings[candidate]) === bindingConflictKey(code)
  ));
  const next = { ...bindings, [action]: code };
  if (swappedAction) next[swappedAction] = previousCode;
  return { bindings: next, swappedAction };
};

export const detectKeyboardPreset = (bindings: ControlBindings): KeyboardPreset | null => {
  if (controlActions.every((action) => bindings[action] === azertyBindings[action])) return 'azerty';
  if (controlActions.every((action) => bindings[action] === qwertyBindings[action])) return 'qwerty';
  return null;
};
