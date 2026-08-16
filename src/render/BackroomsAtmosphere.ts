import type { VisualBiome } from '../world/types';

export interface BackroomsAtmospherePalette {
  readonly background: number;
  readonly fog: number;
  readonly hemisphereSky: number;
  readonly hemisphereGround: number;
  readonly ambient: number;
  readonly key: number;
}

export const BACKROOMS_ATMOSPHERE: Record<VisualBiome, BackroomsAtmospherePalette> = {
  yellow: {
    background: 0x282820,
    fog: 0x555548,
    hemisphereSky: 0xfffbef,
    hemisphereGround: 0x53534c,
    ambient: 0xfff9ec,
    key: 0xfff2d2,
  },
  red: {
    background: 0x170706,
    fog: 0x431512,
    hemisphereSky: 0xffe9e2,
    hemisphereGround: 0x6f5f5c,
    ambient: 0xffeee9,
    key: 0xffc8bc,
  },
  white: {
    background: 0x62696a,
    fog: 0xaeb6b6,
    hemisphereSky: 0xf7fbff,
    hemisphereGround: 0x6d7678,
    ambient: 0xf0f6fb,
    key: 0xe9f5ff,
  },
};

export const BACKROOMS_LEGACY_ATMOSPHERE: typeof BACKROOMS_ATMOSPHERE = {
  yellow: {
    background: 0x45452d,
    fog: 0x77754b,
    hemisphereSky: 0xfff7d8,
    hemisphereGround: 0x282619,
    ambient: 0xfff0c4,
    key: 0xfff5d8,
  },
  red: {
    background: 0x270503,
    fog: 0x5c0906,
    hemisphereSky: 0xff2114,
    hemisphereGround: 0x190201,
    ambient: 0xff160d,
    key: 0xff301d,
  },
  white: {
    background: 0x62696a,
    fog: 0xaeb6b6,
    hemisphereSky: 0xf7fbff,
    hemisphereGround: 0x303738,
    ambient: 0xeaf3ff,
    key: 0xf5fbff,
  },
};
