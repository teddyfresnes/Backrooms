import { describe, expect, it } from 'vitest'
import { EXPRESSION_PULSE_INTERVAL_MS, expressionMouthOpening, expressionPulseMs, FACIAL_EXPRESSIONS, expressionTargets } from './expressions'

describe('wardrobe facial expressions', () => {
  it('offers the requested expressions plus a broad preview selection', () => {
    const ids = new Set(FACIAL_EXPRESSIONS.map((expression) => expression.id))
    expect([...ids]).toEqual(expect.arrayContaining([
      'neutral', 'happy', 'sad', 'damage', 'injured', 'dead', 'angry',
      'surprised', 'smirk', 'burp', 'cough', 'laugh', 'fear', 'disgusted',
      'wink', 'tired', 'sleepy', 'confused', 'suspicious', 'kiss', 'cry',
      'scream', 'determined', 'embarrassed',
    ]))
    expect(FACIAL_EXPRESSIONS).toHaveLength(24)
    expect(FACIAL_EXPRESSIONS.every((expression) => expression.icon && expression.label)).toBe(true)
  })

  it('keeps neutral free of targets and blends expression units by phenotype', () => {
    expect(expressionTargets('neutral', {})).toEqual([])

    const targets = expressionTargets('surprised', { raceAsian: .25, raceAfrican: .15 })
    expect(targets.some((target) => target.path.includes('/caucasian/'))).toBe(true)
    expect(targets.some((target) => target.path.includes('/asian/'))).toBe(true)
    expect(targets.some((target) => target.path.includes('/african/'))).toBe(true)

    const eyebrowWeights = targets
      .filter((target) => target.path.endsWith('/eyebrows-left-up'))
      .reduce((sum, target) => sum + target.weight, 0)
    expect(eyebrowWeights).toBeCloseTo(.78)
  })

  it('times one-shot gestures and keeps the smirk mouth closed', () => {
    expect(EXPRESSION_PULSE_INTERVAL_MS).toBe(2000)
    for (const id of ['damage', 'burp', 'cough', 'laugh', 'wink', 'kiss', 'scream'] as const) {
      expect(expressionPulseMs(id)).toBeGreaterThan(0)
      expect(expressionPulseMs(id)).toBeLessThan(EXPRESSION_PULSE_INTERVAL_MS)
    }
    expect(expressionPulseMs('happy')).toBeNull()
    const smirk = FACIAL_EXPRESSIONS.find((expression) => expression.id === 'smirk')!
    expect(smirk.units.map(([unit]) => unit)).not.toContain('mouth-open')
    expect(smirk.units.map(([unit]) => unit)).not.toContain('mouth-part-later')
    expect(expressionMouthOpening('smirk')).toBe(0)
    expect(expressionMouthOpening('angry')).toBe(0)
    expect(expressionMouthOpening('surprised')).toBeCloseTo(.65)
    expect(expressionMouthOpening('scream')).toBe(1)
  })

})
