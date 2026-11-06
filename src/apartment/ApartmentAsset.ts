/** Kept separate from Three.js so background preparation cannot load the renderer. */
import { runtimeSha256 } from '../../public/assets/imported-apartment/apartment.runtime.parts.json';
export const APARTMENT_MODEL_URL = `/assets/imported-apartment/apartment.runtime.parts.json?v=${runtimeSha256}`;
