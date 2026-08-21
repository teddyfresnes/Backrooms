import type { WeightedTarget } from '../makehuman/types'

export type FacialExpressionId =
  | 'neutral' | 'happy' | 'sad' | 'damage' | 'injured' | 'dead'
  | 'angry' | 'surprised' | 'smirk' | 'burp' | 'cough' | 'laugh'
  | 'fear' | 'disgusted' | 'wink' | 'tired' | 'sleepy' | 'confused'
  | 'suspicious' | 'kiss' | 'cry' | 'scream' | 'determined' | 'embarrassed'

export const EXPRESSION_PULSE_INTERVAL_MS = 2000

type ExpressionUnit = readonly [unit: string, weight: number]

export interface FacialExpressionDefinition {
  id: FacialExpressionId
  label: string
  icon: string
  units: readonly ExpressionUnit[]
  pulseMs?: number
}

export const FACIAL_EXPRESSIONS: readonly FacialExpressionDefinition[] = [
  { id: 'neutral', label: 'Neutre', icon: '😐', units: [] },
  { id: 'happy', label: 'Heureux', icon: '😄', units: [['mouth-corner-puller', .82], ['mouth-elevation', .32], ['eye-left-slit', .18], ['eye-right-slit', .18]] },
  { id: 'sad', label: 'Triste', icon: '😢', units: [['mouth-depression', .62], ['eyebrows-left-inner-up', .55], ['eyebrows-right-inner-up', .55], ['eye-left-slit', .16], ['eye-right-slit', .16]] },
  { id: 'damage', label: 'Dégâts', icon: '💥', pulseMs: 620, units: [['eye-left-closure', .72], ['eye-right-slit', .38], ['mouth-depression-retraction', .62], ['eyebrows-left-down', .65], ['eyebrows-right-inner-up', .24]] },
  { id: 'injured', label: 'Blessé', icon: '🤕', units: [['eye-left-slit', .64], ['eye-right-slit', .48], ['mouth-depression-retraction', .75], ['neck-platysma', .28], ['eyebrows-left-inner-up', .42], ['eyebrows-right-inner-up', .42]] },
  { id: 'dead', label: 'Mort', icon: '💀', units: [['eye-left-closure', 1], ['eye-right-closure', 1], ['mouth-open', .3], ['mouth-depression', .28]] },
  { id: 'angry', label: 'En colère', icon: '😠', units: [['eyebrows-left-down', .85], ['eyebrows-right-down', .85], ['mouth-compression', .62], ['nose-left-elevation', .38], ['nose-right-elevation', .38], ['eye-left-slit', .22], ['eye-right-slit', .22]] },
  { id: 'surprised', label: 'Surpris', icon: '😲', units: [['eye-left-opened-up', .82], ['eye-right-opened-up', .82], ['eyebrows-left-up', .78], ['eyebrows-right-up', .78], ['mouth-open', .65]] },
  { id: 'smirk', label: 'Sourire en coin', icon: '😏', units: [['mouth-corner-puller', .38], ['mouth-compression', .2], ['eyebrows-left-extern-up', .42], ['eye-left-slit', .32]] },
  { id: 'burp', label: 'Roter', icon: '🤭', pulseMs: 620, units: [['mouth-pursing', .48], ['mouth-open', .34], ['mouth-protusion', .45], ['eye-left-slit', .26], ['eye-right-slit', .26]] },
  { id: 'cough', label: 'Tousser', icon: '🤧', pulseMs: 520, units: [['mouth-open', .54], ['mouth-depression-retraction', .36], ['eye-left-closure', .52], ['eye-right-closure', .52], ['eyebrows-left-inner-up', .32], ['eyebrows-right-inner-up', .32]] },
  { id: 'laugh', label: 'Rire', icon: '😂', pulseMs: 900, units: [['mouth-corner-puller', 1], ['mouth-open', .62], ['mouth-elevation', .42], ['eye-left-closure', .54], ['eye-right-closure', .54]] },
  { id: 'fear', label: 'Effrayé', icon: '😨', units: [['eye-left-opened-up', .74], ['eye-right-opened-up', .74], ['eyebrows-left-inner-up', .9], ['eyebrows-right-inner-up', .9], ['mouth-open', .38], ['mouth-retraction', .42]] },
  { id: 'disgusted', label: 'Dégoûté', icon: '🤢', units: [['nose-left-elevation', .8], ['nose-right-elevation', .8], ['nose-compression', .58], ['mouth-upward-retraction', .52], ['mouth-depression', .28], ['eye-left-slit', .32], ['eye-right-slit', .32]] },
  { id: 'wink', label: 'Clin d’œil', icon: '😉', pulseMs: 380, units: [['eye-left-closure', 1], ['mouth-corner-puller', .48], ['eyebrows-left-extern-up', .22]] },
  { id: 'tired', label: 'Fatigué', icon: '🥱', units: [['eye-left-slit', .7], ['eye-right-slit', .7], ['eyebrows-left-inner-up', .2], ['eyebrows-right-inner-up', .2], ['mouth-open', .18], ['mouth-depression', .22]] },
  { id: 'sleepy', label: 'Endormi', icon: '😴', units: [['eye-left-closure', .92], ['eye-right-closure', .92], ['mouth-pursing', .16], ['mouth-open', .12]] },
  { id: 'confused', label: 'Perplexe', icon: '😕', units: [['eyebrows-left-up', .55], ['eyebrows-right-down', .48], ['eye-right-slit', .22], ['mouth-part-later', .34], ['mouth-depression', .25]] },
  { id: 'suspicious', label: 'Méfiant', icon: '🧐', units: [['eye-left-slit', .58], ['eye-right-slit', .58], ['eyebrows-left-down', .48], ['eyebrows-right-down', .48], ['mouth-compression', .44]] },
  { id: 'kiss', label: 'Bisou', icon: '😘', pulseMs: 700, units: [['mouth-pursing', .92], ['mouth-protusion', .72], ['eye-left-closure', .42], ['eye-right-slit', .2]] },
  { id: 'cry', label: 'Pleurer', icon: '😭', units: [['mouth-depression-retraction', .92], ['mouth-open', .42], ['eyebrows-left-inner-up', .92], ['eyebrows-right-inner-up', .92], ['eye-left-slit', .44], ['eye-right-slit', .44]] },
  { id: 'scream', label: 'Crier', icon: '😱', pulseMs: 820, units: [['mouth-open', 1], ['mouth-retraction', .58], ['eye-left-opened-up', .9], ['eye-right-opened-up', .9], ['eyebrows-left-up', .85], ['eyebrows-right-up', .85], ['neck-platysma', .34]] },
  { id: 'determined', label: 'Déterminé', icon: '😤', units: [['eyebrows-left-down', .52], ['eyebrows-right-down', .52], ['eye-left-slit', .3], ['eye-right-slit', .3], ['mouth-compression', .6], ['nose-left-dilatation', .24], ['nose-right-dilatation', .24]] },
  { id: 'embarrassed', label: 'Gêné', icon: '😳', units: [['eye-left-opened-up', .34], ['eye-right-opened-up', .34], ['eyebrows-left-inner-up', .38], ['eyebrows-right-inner-up', .38], ['mouth-compression', .26], ['mouth-part-later', .22]] },
] as const

const EXPRESSIONS_BY_ID = new Map(FACIAL_EXPRESSIONS.map((expression) => [expression.id, expression]))

export function expressionPulseMs(expressionId: FacialExpressionId): number | null {
  return EXPRESSIONS_BY_ID.get(expressionId)?.pulseMs ?? null
}

export function expressionMouthOpening(expressionId: FacialExpressionId): number {
  const expression = EXPRESSIONS_BY_ID.get(expressionId)
  return expression?.units.find(([unit]) => unit === 'mouth-open')?.[1] ?? 0
}

export function expressionTargets(expressionId: FacialExpressionId, body: Record<string, number>): WeightedTarget[] {
  const expression = EXPRESSIONS_BY_ID.get(expressionId)
  if (!expression?.units.length) return []

  const asian = Math.max(0, Math.min(1, Number(body.raceAsian ?? 0)))
  const african = Math.max(0, Math.min(1, Number(body.raceAfrican ?? 0)))
  const caucasian = Math.max(0, 1 - asian - african)
  const phenotypes = [
    ['caucasian', caucasian],
    ['asian', asian],
    ['african', african],
  ] as const

  return phenotypes.flatMap(([phenotype, phenotypeWeight]) => phenotypeWeight > .0001
    ? expression.units.map(([unit, weight]) => ({
      path: `expression/units/${phenotype}/${unit}`,
      weight: weight * phenotypeWeight,
    }))
    : [])
}
