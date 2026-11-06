/** Kept separate from Three.js so background preparation cannot load the renderer. */
import { apartmentRuntimeSha256 } from 'virtual:public-manifests';
export const APARTMENT_MODEL_URL = `/assets/imported-apartment/apartment.runtime.parts.json?v=${apartmentRuntimeSha256}`;
