export interface TextureOrigin { x: number; y: number; z: number }
export const LOCAL_TEXTURE_ORIGIN: TextureOrigin = { x: 0, y: 0, z: 0 };

/** Project a whole quad in one dominant plane. Per-triangle axis decisions
 * collapse the UV area of sloping caps and split a continuous wallpaper face. */
export const faceProjection = (v: readonly number[], corners: readonly number[]): 'x' | 'y' | 'z' => {
  const [a, b, c] = corners;
  const ux = v[b! * 3]! - v[a! * 3]!, uy = v[b! * 3 + 1]! - v[a! * 3 + 1]!, uz = v[b! * 3 + 2]! - v[a! * 3 + 2]!;
  const vx = v[c! * 3]! - v[a! * 3]!, vy = v[c! * 3 + 1]! - v[a! * 3 + 1]!, vz = v[c! * 3 + 2]! - v[a! * 3 + 2]!;
  const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
  return ny >= nx && ny >= nz ? 'y' : nx >= nz ? 'x' : 'z';
};

export const horizontalUv = (x: number, z: number, scale: number, ceiling: boolean, quarterTurn = false): [number, number] => {
  const tile = ceiling ? 2.4 : 2.15;
  return quarterTurn ? [z / tile * scale, -x / tile * scale] : [x / tile * scale, z / tile * scale];
};
