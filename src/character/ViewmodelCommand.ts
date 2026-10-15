import type { ConsoleSubmitResult } from '../ui/ExperienceUI';

export const VIEWMODEL_COMPLETION = {
  value: '/viewmodel', label: '/viewmodel', detail: 'BASCULE PREMIÈRE / TROISIÈME PERSONNE',
};
export function viewmodelCommand(
  character: { toggleView(): 'first-person' | 'third-person' } | undefined,
  args: readonly string[],
): ConsoleSubmitResult {
  if (args.length || !character) {
    const feedback = args.length ? 'SYNTAXE: /viewmodel' : 'JOUEUR NON PRÊT';
    return { close: false, feedback, messages: [{ kind: 'error', text: feedback }] };
  }
  const feedback = character.toggleView() === 'third-person' ? 'VUE À LA TROISIÈME PERSONNE' : 'VUE À LA PREMIÈRE PERSONNE';
  return { close: true, feedback, messages: [{ kind: 'system', text: feedback }] };
}
