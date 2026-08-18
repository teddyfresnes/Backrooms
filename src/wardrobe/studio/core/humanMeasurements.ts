import type { MorphDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export type BiologicalSex = 'female' | 'male'

export const SAFE_SKIN_TONES = [
  '#e5b99f', '#d5a083', '#c58a69', '#aa7053',
  '#8b563f', '#6d4130', '#513024', '#38221b',
]

export function sexFromGenderMorph(gender = -1): BiologicalSex {
  return gender >= 0 ? 'male' : 'female'
}

export function genderMorphForSex(sex: BiologicalSex) {
  return sex === 'male' ? 1 : -1
}

export function sexLabel(gender = -1) {
  return sexFromGenderMorph(gender) === 'male' ? 'Homme' : 'Femme'
}

/**
 * MPFB/MakeHuman age macro: 0.5 is the young-adult corner and 1.0 the old corner.
 * The editor deliberately exposes only an adult range to avoid child/baby morphs.
 */
export function ageYearsFromMorph(value = 0.56) {
  return Math.round(18 + ((clamp(value, 0.5, 0.84) - 0.5) / 0.34) * 57)
}

export function ageMorphFromYears(years: number) {
  return 0.5 + ((clamp(years, 18, 75) - 18) / 57) * 0.34
}

interface HeightCalibration {
  minExtreme: number
  neutral: number
  maxExtreme: number
  safeMin: number
  safeMax: number
}

// Measured directly on the bundled HM08 mesh after applying MPFB young-adult,
// average-muscle/average-weight macro targets. Values are centimeters.
const FEMALE_HEIGHT: HeightCalibration = { minExtreme: 125.0, neutral: 160.6, maxExtreme: 230.7, safeMin: 150, safeMax: 190 }
const MALE_HEIGHT: HeightCalibration = { minExtreme: 139.2, neutral: 174.7, maxExtreme: 244.9, safeMin: 160, safeMax: 205 }

function genderBlend(gender = -1) {
  return clamp((gender + 1) / 2, 0, 1)
}

function heightCalibration(gender = -1): HeightCalibration {
  const t = genderBlend(gender)
  return {
    minExtreme: lerp(FEMALE_HEIGHT.minExtreme, MALE_HEIGHT.minExtreme, t),
    neutral: lerp(FEMALE_HEIGHT.neutral, MALE_HEIGHT.neutral, t),
    maxExtreme: lerp(FEMALE_HEIGHT.maxExtreme, MALE_HEIGHT.maxExtreme, t),
    safeMin: Math.round(lerp(FEMALE_HEIGHT.safeMin, MALE_HEIGHT.safeMin, t)),
    safeMax: Math.round(lerp(FEMALE_HEIGHT.safeMax, MALE_HEIGHT.safeMax, t)),
  }
}

export function heightBoundsCm(gender = -1) {
  const c = heightCalibration(gender)
  return { min: c.safeMin, max: c.safeMax }
}

export function heightCmFromMorph(value = 0, gender = -1) {
  const c = heightCalibration(gender)
  const v = clamp(value, -1, 1)
  if (v < 0) return c.neutral + v * (c.neutral - c.minExtreme)
  return c.neutral + v * (c.maxExtreme - c.neutral)
}

export function heightMorphFromCm(cm: number, gender = -1) {
  const c = heightCalibration(gender)
  const safe = clamp(cm, c.safeMin, c.safeMax)
  if (safe < c.neutral) return (safe - c.neutral) / (c.neutral - c.minExtreme)
  return (safe - c.neutral) / (c.maxExtreme - c.neutral)
}

interface ShoeCalibration { min: number; neutral: number; max: number }
const FEMALE_SHOE: ShoeCalibration = { min: 35, neutral: 39, max: 43 }
const MALE_SHOE: ShoeCalibration = { min: 39, neutral: 43, max: 48 }
const FOOT_MORPH_LIMIT = 0.22

function shoeCalibration(gender = -1): ShoeCalibration {
  const t = genderBlend(gender)
  return {
    min: Math.round(lerp(FEMALE_SHOE.min, MALE_SHOE.min, t)),
    neutral: lerp(FEMALE_SHOE.neutral, MALE_SHOE.neutral, t),
    max: Math.round(lerp(FEMALE_SHOE.max, MALE_SHOE.max, t)),
  }
}

export function shoeSizeBoundsEu(gender = -1) {
  const c = shoeCalibration(gender)
  return { min: c.min, max: c.max }
}

export function shoeSizeEuFromMorph(value = 0, gender = -1) {
  const c = shoeCalibration(gender)
  const v = clamp(value, -FOOT_MORPH_LIMIT, FOOT_MORPH_LIMIT) / FOOT_MORPH_LIMIT
  const size = v < 0 ? c.neutral + v * (c.neutral - c.min) : c.neutral + v * (c.max - c.neutral)
  return Math.round(size)
}

export function footMorphFromShoeSizeEu(size: number, gender = -1) {
  const c = shoeCalibration(gender)
  const safe = clamp(size, c.min, c.max)
  if (safe < c.neutral) return ((safe - c.neutral) / (c.neutral - c.min)) * FOOT_MORPH_LIMIT
  return ((safe - c.neutral) / (c.max - c.neutral)) * FOOT_MORPH_LIMIT
}

interface HandCalibration { min: number; neutral: number; max: number }
const FEMALE_HAND: HandCalibration = { min: 13.5, neutral: 17.5, max: 22.0 }
const MALE_HAND: HandCalibration = { min: 14.5, neutral: 19.0, max: 25.0 }
const HAND_MORPH_LIMIT = 0.42

function handCalibration(gender = -1): HandCalibration {
  const t = genderBlend(gender)
  return {
    min: lerp(FEMALE_HAND.min, MALE_HAND.min, t),
    neutral: lerp(FEMALE_HAND.neutral, MALE_HAND.neutral, t),
    max: lerp(FEMALE_HAND.max, MALE_HAND.max, t),
  }
}

export function handLengthBoundsCm(gender = -1) {
  const c = handCalibration(gender)
  return { min: c.min, max: c.max }
}

export function handLengthCmFromMorph(value = 0, gender = -1) {
  const c = handCalibration(gender)
  const v = clamp(value, -HAND_MORPH_LIMIT, HAND_MORPH_LIMIT) / HAND_MORPH_LIMIT
  return v < 0 ? c.neutral + v * (c.neutral - c.min) : c.neutral + v * (c.max - c.neutral)
}

export function handMorphFromLengthCm(cm: number, gender = -1) {
  const c = handCalibration(gender)
  const safe = clamp(cm, c.min, c.max)
  if (safe < c.neutral) return ((safe - c.neutral) / (c.neutral - c.min)) * HAND_MORPH_LIMIT
  return ((safe - c.neutral) / (c.max - c.neutral)) * HAND_MORPH_LIMIT
}

// Weight is a body-shape macro, not a physics simulation. We expose it as an
// approximate mass by mapping the safe morph interval to a plausible adult BMI.
const WEIGHT_MORPH_MIN = -0.65
const WEIGHT_MORPH_MAX = 0.75
const BMI_MIN = 18.0
const BMI_NEUTRAL = 23.5
const BMI_MAX = 35.0

export function bmiFromWeightMorph(value = 0) {
  const v = clamp(value, WEIGHT_MORPH_MIN, WEIGHT_MORPH_MAX)
  if (v < 0) return BMI_NEUTRAL + (v / Math.abs(WEIGHT_MORPH_MIN)) * (BMI_NEUTRAL - BMI_MIN)
  return BMI_NEUTRAL + (v / WEIGHT_MORPH_MAX) * (BMI_MAX - BMI_NEUTRAL)
}

export function weightMorphFromBmi(bmi: number) {
  const b = clamp(bmi, BMI_MIN, BMI_MAX)
  if (b < BMI_NEUTRAL) return ((b - BMI_NEUTRAL) / (BMI_NEUTRAL - BMI_MIN)) * Math.abs(WEIGHT_MORPH_MIN)
  return ((b - BMI_NEUTRAL) / (BMI_MAX - BMI_NEUTRAL)) * WEIGHT_MORPH_MAX
}

export function estimatedWeightKg(weightMorph: number, heightCm: number) {
  const metres = heightCm / 100
  return Math.round(bmiFromWeightMorph(weightMorph) * metres * metres)
}

export function weightMorphFromKg(kg: number, heightCm: number) {
  const metres = Math.max(1.4, heightCm / 100)
  return weightMorphFromBmi(kg / (metres * metres))
}

export function sanitizeSkinTone(color: string | undefined) {
  const normalized = (color ?? '').toLowerCase()
  // Migration from the first prototype's over-bright light swatch.
  if (normalized === '#f2d2bd' || normalized === '#ffffff' || normalized === '#fff') return SAFE_SKIN_TONES[0]
  return /^#[0-9a-f]{6}$/i.test(color ?? '') ? color! : '#c58a69'
}

export function realisticDefaultMorphValue(def: MorphDefinition, body: Record<string, number>) {
  if (def.key === 'height') {
    const gender = body.gender ?? -1
    return heightMorphFromCm(sexFromGenderMorph(gender) === 'male' ? 178 : 168, gender)
  }
  return def.default
}

export interface MorphUiModel {
  min: number
  max: number
  step: number
  value: number
  defaultValue: number
  valueLabel: string
  toMorph: (uiValue: number) => number
}

export function morphUiModel(def: MorphDefinition, internalValue: number, body: Record<string, number>): MorphUiModel {
  const gender = body.gender ?? -1
  const resetInternal = realisticDefaultMorphValue(def, body)
  if (def.key === 'age') {
    const value = ageYearsFromMorph(internalValue)
    return { min: 18, max: 75, step: 1, value, defaultValue: ageYearsFromMorph(resetInternal), valueLabel: `${value} ans`, toMorph: ageMorphFromYears }
  }
  if (def.key === 'height') {
    const bounds = heightBoundsCm(gender)
    const value = Math.round(heightCmFromMorph(internalValue, gender))
    return {
      ...bounds, step: 1, value,
      defaultValue: Math.round(heightCmFromMorph(resetInternal, gender)),
      valueLabel: `${value} cm`,
      toMorph: (cm) => heightMorphFromCm(cm, gender),
    }
  }
  if (def.key === 'feet') {
    const bounds = shoeSizeBoundsEu(gender)
    const value = shoeSizeEuFromMorph(internalValue, gender)
    return {
      ...bounds, step: 1, value,
      defaultValue: shoeSizeEuFromMorph(resetInternal, gender),
      valueLabel: `EU ${value}`,
      toMorph: (size) => footMorphFromShoeSizeEu(size, gender),
    }
  }
  if (def.key === 'hands') {
    const bounds = handLengthBoundsCm(gender)
    const value = Math.round(handLengthCmFromMorph(internalValue, gender) * 2) / 2
    return {
      min: bounds.min, max: bounds.max, step: 0.5, value,
      defaultValue: handLengthCmFromMorph(resetInternal, gender),
      valueLabel: `${value.toFixed(1)} cm`,
      toMorph: (cm) => handMorphFromLengthCm(cm, gender),
    }
  }
  if (def.key === 'weight') {
    const heightCm = heightCmFromMorph(body.height ?? 0, gender)
    const value = estimatedWeightKg(internalValue, heightCm)
    const min = estimatedWeightKg(def.min, heightCm)
    const max = estimatedWeightKg(def.max, heightCm)
    return {
      min, max, step: 1, value,
      defaultValue: estimatedWeightKg(resetInternal, heightCm),
      valueLabel: `≈ ${value} kg`,
      toMorph: (kg) => clamp(weightMorphFromKg(kg, heightCm), def.min, def.max),
    }
  }

  const value = Math.round(internalValue * 100)
  return {
    min: Math.round(def.min * 100), max: Math.round(def.max * 100), step: Math.max(1, Math.round(def.step * 100)), value,
    defaultValue: Math.round(resetInternal * 100),
    valueLabel: value === 0 ? 'Neutre' : `${value > 0 ? '+' : ''}${value}%`,
    toMorph: (uiValue) => uiValue / 100,
  }
}

export function clampMorphValue(def: MorphDefinition, value: number) {
  if (!Number.isFinite(value)) return def.default
  return clamp(value, def.min, def.max)
}
