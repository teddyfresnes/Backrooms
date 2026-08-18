import type { WeightedTarget } from './types'

type Component = [name: string, weight: number]

interface MacroInfo {
  gender: number
  age: number
  muscle: number
  weight: number
  proportions: number
  height: number
  breastSize: number
  breastFirmness: number
  race: { asian: number; caucasian: number; african: number }
}

const defs: Record<string, Array<{ lowest: number; highest: number; low: string; high: string }>> = {
  gender: [{ lowest: -0.01, highest: 1.01, low: 'female', high: 'male' }],
  age: [
    { lowest: -0.01, highest: 0.1874998, low: 'baby', high: 'child' },
    { lowest: 0.1874999, highest: 0.49998, low: 'child', high: 'young' },
    { lowest: 0.49999, highest: 1.01, low: 'young', high: 'old' },
  ],
  muscle: [
    { lowest: -0.01, highest: 0.49998, low: 'minmuscle', high: 'averagemuscle' },
    { lowest: 0.49999, highest: 1.01, low: 'averagemuscle', high: 'maxmuscle' },
  ],
  weight: [
    { lowest: -0.01, highest: 0.49998, low: 'minweight', high: 'averageweight' },
    { lowest: 0.49999, highest: 1.01, low: 'averageweight', high: 'maxweight' },
  ],
  proportions: [
    { lowest: -0.01, highest: 0.4999, low: 'uncommonproportions', high: '' },
    { lowest: 0.50, highest: 1.01, low: '', high: 'idealproportions' },
  ],
  height: [
    { lowest: -0.01, highest: 0.49, low: 'minheight', high: '' },
    { lowest: 0.51, highest: 1.01, low: '', high: 'maxheight' },
  ],
}

function interp(name: keyof typeof defs, value: number): Component[] {
  const result: Component[] = []
  for (const part of defs[name]) {
    if (value > part.lowest && value < part.highest) {
      const pct = (value - part.lowest) / (part.highest - part.lowest)
      if (part.low) result.push([part.low, Math.round((1 - pct) * 10000) / 10000])
      if (part.high) result.push([part.high, Math.round(pct * 10000) / 10000])
    }
  }
  return result
}

function signedExtreme(value: number, low: string, high: string): Component[] {
  const clamped = Math.max(-1, Math.min(1, value))
  if (Math.abs(clamped) < 0.0001) return []
  return [[clamped < 0 ? low : high, Math.abs(clamped)]]
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const fromSigned = (value = 0) => clamp01((value + 1) / 2)

export function macroInfoFromBody(body: Record<string, number>): MacroInfo {
  return {
    gender: fromSigned(body.gender),
    age: clamp01(body.age ?? 0.5),
    muscle: fromSigned(body.muscle),
    weight: fromSigned(body.weight),
    proportions: fromSigned(body.proportions),
    height: fromSigned(body.height),
    breastSize: Math.max(-1, Math.min(1, body.breastSize ?? 0)),
    breastFirmness: Math.max(-1, Math.min(1, body.breastFirmness ?? 0)),
    // MPFB ships three phenotype corner targets. Presets can blend these using
    // hidden body values while skin tone remains an independent appearance value.
    // Keeping the blend here (instead of stereotyping face sliders) gives Asian
    // presets an actual MakeHuman macro shape and keeps Hispanic presets neutral.
    race: (() => {
      let asian = clamp01(body.raceAsian ?? 0)
      let african = clamp01(body.raceAfrican ?? 0)
      const nonCaucasian = asian + african
      if (nonCaucasian > 1) { asian /= nonCaucasian; african /= nonCaucasian }
      return { asian, caucasian: Math.max(0, 1 - asian - african), african }
    })(),
  }
}

export function calculateMacroTargets(info: MacroInfo, cutoff = 0.01): WeightedTarget[] {
  const c = {
    gender: interp('gender', info.gender), age: interp('age', info.age),
    muscle: interp('muscle', info.muscle), weight: interp('weight', info.weight),
    proportions: interp('proportions', info.proportions), height: interp('height', info.height),
  }
  const out: WeightedTarget[] = []
  const add = (path: string, weight: number) => { if (weight > cutoff) out.push({ path, weight }) }

  for (const [race, raceWeight] of Object.entries(info.race)) if (raceWeight > 0.0001) {
    for (const [age, aw] of c.age) for (const [gender, gw] of c.gender) {
      add(`macrodetails/${race}-${gender}-${age}`, raceWeight * aw * gw)
    }
  }
  for (const [gender, gw] of c.gender) for (const [age, aw] of c.age) for (const [muscle, mw] of c.muscle) for (const [weight, ww] of c.weight) {
    add(`macrodetails/universal-${gender}-${age}-${muscle}-${weight}`, gw * aw * mw * ww)
    for (const [height, hw] of c.height) add(`macrodetails/height/${gender}-${age}-${muscle}-${weight}-${height}`, gw * aw * mw * ww * hw)
    for (const [proportions, pw] of c.proportions) {
      if (age !== 'baby') add(`macrodetails/proportions/${gender}-${age}-${muscle}-${weight}-${proportions}`, gw * aw * mw * ww * pw)
    }
  }
  // MakeHuman's breast modifiers are macro-dependent. Neutral size and
  // firmness require no extra target; moving either axis blends the native
  // min/max cup or firmness target for the current adult/muscle/weight macro.
  const femaleWeight = c.gender.find(([name]) => name === 'female')?.[1] ?? 0
  if (femaleWeight > cutoff) {
    const cup = signedExtreme(info.breastSize, 'mincup', 'maxcup')
    const firmness = signedExtreme(info.breastFirmness, 'minfirmness', 'maxfirmness')
    for (const [age, aw] of c.age) for (const [muscle, mw] of c.muscle) for (const [weight, ww] of c.weight) {
      const context = femaleWeight * aw * mw * ww
      for (const [cupName, cupWeight] of cup) {
        add(`breast/female-${age}-${muscle}-${weight}-${cupName}-averagefirmness`, context * cupWeight)
      }
      for (const [firmnessName, firmnessWeight] of firmness) {
        add(`breast/female-${age}-${muscle}-${weight}-averagecup-${firmnessName}`, context * firmnessWeight)
      }
    }
  }

  return out
}
