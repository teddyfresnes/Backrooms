import { SeededRandom } from '../world/SeededRandom';

export const characterRandom = (label: string): (() => number) => {
  const sequence = new SeededRandom('character-presentation').fork(label);
  return () => sequence.float();
};
