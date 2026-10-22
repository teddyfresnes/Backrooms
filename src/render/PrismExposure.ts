import type { SpatialPrism } from '../world/SpatialTypes';
import { createFaceExposure, type FaceExposure } from './FaceExposure';

export type PrismExposure = FaceExposure;
export const prismExposure = (prisms: readonly SpatialPrism[]): PrismExposure =>
  createFaceExposure(prisms.map(source => ({ source, vertices: source.vertices })));
