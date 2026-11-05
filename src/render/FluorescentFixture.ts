import * as THREE from 'three';

/** Linear HDR radiance, separate from the yellow wallpaper/fluorescent tint.
 * AGX still processes the final scene; bloom is an optional halo, not the
 * mechanism that makes the panel read as a white emitter. */
export const FLUORESCENT_PANEL_RADIANCE = 2;
export const createFluorescentDiffuser = (name = 'fluorescent-diffuser', tint = 0xffffff): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ name, color: new THREE.Color(tint).multiplyScalar(FLUORESCENT_PANEL_RADIANCE),
    toneMapped: true, fog: true, depthTest: true, depthWrite: true, side: THREE.DoubleSide });

/** Preserve the established blackout rig; lift only normally lit scenes. */
export const MODERN_BACKROOMS_RIG = {
  hemisphere: { lit: .32, dark: .07 }, ambient: { lit: .10, dark: .018 }, key: { lit: .34, dark: .08 },
} as const;
