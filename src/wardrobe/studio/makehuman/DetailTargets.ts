import type { WeightedTarget } from './types'

type Driver = { negative: string[]; positive: string[]; gain?: number }

// Each control maps directly to native HM08 target pairs. Paired left/right
// targets are driven together so the default editor stays symmetrical.
const DRIVERS: Record<string, Driver> = {
  shoulders: { negative: ['torso/measure-shoulder-dist-decr'], positive: ['torso/measure-shoulder-dist-incr'] },
  shoulderMuscle: {
    negative: ['arms/l-upperarm-shoulder-muscle-decr', 'arms/r-upperarm-shoulder-muscle-decr'],
    positive: ['arms/l-upperarm-shoulder-muscle-incr', 'arms/r-upperarm-shoulder-muscle-incr'],
  },
  chest: { negative: ['torso/torso-scale-depth-decr'], positive: ['torso/torso-scale-depth-incr'] },
  torsoWidth: { negative: ['torso/torso-scale-horiz-decr'], positive: ['torso/torso-scale-horiz-incr'] },
  torsoHeight: { negative: ['torso/torso-scale-vert-decr'], positive: ['torso/torso-scale-vert-incr'] },
  torsoVShape: { negative: ['torso/torso-vshape-decr'], positive: ['torso/torso-vshape-incr'] },
  pectoralMuscle: { negative: ['torso/torso-muscle-pectoral-decr'], positive: ['torso/torso-muscle-pectoral-incr'] },
  backMuscle: { negative: ['torso/torso-muscle-dorsi-decr'], positive: ['torso/torso-muscle-dorsi-incr'] },
  bustCirc: { negative: ['torso/measure-bust-circ-decr'], positive: ['torso/measure-bust-circ-incr'] },
  underBust: { negative: ['torso/measure-underbust-circ-decr'], positive: ['torso/measure-underbust-circ-incr'] },
  frontChest: { negative: ['torso/measure-frontchest-dist-decr'], positive: ['torso/measure-frontchest-dist-incr'] },
  stomachTone: { negative: ['stomach/stomach-tone-decr'], positive: ['stomach/stomach-tone-incr'] },
  bellyProjection: { negative: ['stomach/stomach-pregnant-decr'], positive: ['stomach/stomach-pregnant-incr'], gain: .65 },
  waist: { negative: ['torso/measure-waist-circ-decr'], positive: ['torso/measure-waist-circ-incr'] },
  waistHeight: { negative: ['hip/hip-waist-down'], positive: ['hip/hip-waist-up'] },
  hips: { negative: ['hip/hip-scale-horiz-decr'], positive: ['hip/hip-scale-horiz-incr'] },
  hipDepth: { negative: ['hip/hip-scale-depth-decr'], positive: ['hip/hip-scale-depth-incr'] },
  hipHeight: { negative: ['hip/hip-scale-vert-decr'], positive: ['hip/hip-scale-vert-incr'] },
  buttocks: { negative: ['buttocks/buttocks-volume-decr'], positive: ['buttocks/buttocks-volume-incr'] },
  pelvisTone: { negative: ['pelvis/pelvis-tone-decr'], positive: ['pelvis/pelvis-tone-incr'] },
  breastSeparation: { negative: ['breast/breast-dist-decr'], positive: ['breast/breast-dist-incr'] },
  breastProjection: { negative: ['breast/breast-point-decr'], positive: ['breast/breast-point-incr'] },
  breastHeight: { negative: ['breast/breast-trans-down'], positive: ['breast/breast-trans-up'] },
  breastVerticalShape: { negative: ['breast/breast-volume-vert-down'], positive: ['breast/breast-volume-vert-up'] },

  armLength: {
    negative: ['arms/measure-upperarm-length-decr', 'arms/measure-lowerarm-length-decr'],
    positive: ['arms/measure-upperarm-length-incr', 'arms/measure-lowerarm-length-incr'], gain: .7,
  },
  upperArmCirc: { negative: ['arms/measure-upperarm-circ-decr'], positive: ['arms/measure-upperarm-circ-incr'] },
  upperArmMuscle: {
    negative: ['arms/l-upperarm-muscle-decr', 'arms/r-upperarm-muscle-decr'],
    positive: ['arms/l-upperarm-muscle-incr', 'arms/r-upperarm-muscle-incr'],
  },
  forearmMuscle: {
    negative: ['arms/l-lowerarm-muscle-decr', 'arms/r-lowerarm-muscle-decr'],
    positive: ['arms/l-lowerarm-muscle-incr', 'arms/r-lowerarm-muscle-incr'],
  },
  armFullness: {
    negative: ['arms/l-upperarm-fat-decr', 'arms/r-upperarm-fat-decr', 'arms/l-lowerarm-fat-decr', 'arms/r-lowerarm-fat-decr'],
    positive: ['arms/l-upperarm-fat-incr', 'arms/r-upperarm-fat-incr', 'arms/l-lowerarm-fat-incr', 'arms/r-lowerarm-fat-incr'], gain: .6,
  },
  legLength: {
    negative: ['legs/upperlegs-height-decr', 'legs/lowerlegs-height-decr'],
    positive: ['legs/upperlegs-height-incr', 'legs/lowerlegs-height-incr'], gain: .7,
  },
  thighCirc: { negative: ['legs/measure-thigh-circ-decr'], positive: ['legs/measure-thigh-circ-incr'] },
  calfCirc: { negative: ['legs/measure-calf-circ-decr'], positive: ['legs/measure-calf-circ-incr'] },
  kneeCirc: { negative: ['legs/measure-knee-circ-decr'], positive: ['legs/measure-knee-circ-incr'] },
  thighMuscle: {
    negative: ['legs/l-upperleg-muscle-decr', 'legs/r-upperleg-muscle-decr'],
    positive: ['legs/l-upperleg-muscle-incr', 'legs/r-upperleg-muscle-incr'],
  },
  calfMuscle: {
    negative: ['legs/l-lowerleg-muscle-decr', 'legs/r-lowerleg-muscle-decr'],
    positive: ['legs/l-lowerleg-muscle-incr', 'legs/r-lowerleg-muscle-incr'],
  },
  legFullness: {
    negative: ['legs/l-upperleg-fat-decr', 'legs/r-upperleg-fat-decr', 'legs/l-lowerleg-fat-decr', 'legs/r-lowerleg-fat-decr'],
    positive: ['legs/l-upperleg-fat-incr', 'legs/r-upperleg-fat-incr', 'legs/l-lowerleg-fat-incr', 'legs/r-lowerleg-fat-incr'], gain: .6,
  },
  hands: { negative: ['hands/l-hand-scale-decr', 'hands/r-hand-scale-decr'], positive: ['hands/l-hand-scale-incr', 'hands/r-hand-scale-incr'] },
  fingerLength: { negative: ['hands/l-hand-fingers-length-decr', 'hands/r-hand-fingers-length-decr'], positive: ['hands/l-hand-fingers-length-incr', 'hands/r-hand-fingers-length-incr'] },
  fingerThickness: { negative: ['hands/l-hand-fingers-diameter-decr', 'hands/r-hand-fingers-diameter-decr'], positive: ['hands/l-hand-fingers-diameter-incr', 'hands/r-hand-fingers-diameter-incr'] },
  fingerSpread: { negative: ['hands/l-hand-fingers-distance-decr', 'hands/r-hand-fingers-distance-decr'], positive: ['hands/l-hand-fingers-distance-incr', 'hands/r-hand-fingers-distance-incr'] },
  wristCirc: { negative: ['hands/measure-wrist-circ-decr'], positive: ['hands/measure-wrist-circ-incr'] },
  feet: { negative: ['feet/l-foot-scale-decr', 'feet/r-foot-scale-decr'], positive: ['feet/l-foot-scale-incr', 'feet/r-foot-scale-incr'] },
  footWidth: { negative: ['feet/l-foot-scale-horiz-decr', 'feet/r-foot-scale-horiz-decr'], positive: ['feet/l-foot-scale-horiz-incr', 'feet/r-foot-scale-horiz-incr'] },
  footDepth: { negative: ['feet/l-foot-scale-depth-decr', 'feet/r-foot-scale-depth-decr'], positive: ['feet/l-foot-scale-depth-incr', 'feet/r-foot-scale-depth-incr'] },
  footHeight: { negative: ['feet/l-foot-scale-vert-decr', 'feet/r-foot-scale-vert-decr'], positive: ['feet/l-foot-scale-vert-incr', 'feet/r-foot-scale-vert-incr'] },
  ankleCirc: { negative: ['feet/measure-ankle-circ-decr'], positive: ['feet/measure-ankle-circ-incr'] },
  neckCirc: { negative: ['neck/measure-neck-circ-decr'], positive: ['neck/measure-neck-circ-incr'] },
  neckHeight: { negative: ['neck/measure-neck-height-decr'], positive: ['neck/measure-neck-height-incr'] },
  neckWidth: { negative: ['neck/neck-scale-horiz-decr'], positive: ['neck/neck-scale-horiz-incr'] },
  neckDepth: { negative: ['neck/neck-scale-depth-decr'], positive: ['neck/neck-scale-depth-incr'] },

  // Macro-like local fullness. Kept for compatibility with existing characters.
  bodyFat: {
    negative: ['arms/l-upperarm-fat-decr', 'arms/r-upperarm-fat-decr', 'legs/l-upperleg-fat-decr', 'legs/r-upperleg-fat-decr'],
    positive: ['arms/l-upperarm-fat-incr', 'arms/r-upperarm-fat-incr', 'legs/l-upperleg-fat-incr', 'legs/r-upperleg-fat-incr'], gain: .55,
  },

  // Head and face.
  faceShape: { negative: ['head/head-square'], positive: ['head/head-round'], gain: .85 },
  headWidth: { negative: ['head/head-scale-horiz-decr'], positive: ['head/head-scale-horiz-incr'] },
  headDepth: { negative: ['head/head-scale-depth-decr'], positive: ['head/head-scale-depth-incr'] },
  headHeight: { negative: ['head/head-scale-vert-decr'], positive: ['head/head-scale-vert-incr'] },
  headBackDepth: { negative: ['head/head-back-scale-depth-decr'], positive: ['head/head-back-scale-depth-incr'] },
  headFat: { negative: ['head/head-fat-decr'], positive: ['head/head-fat-incr'] },

  jaw: { negative: ['chin/chin-width-decr'], positive: ['chin/chin-width-incr'] },
  jawProjection: { negative: ['chin/chin-prognathism-decr'], positive: ['chin/chin-prognathism-incr'] },
  jawHeight: { negative: ['chin/chin-jaw-drop-decr'], positive: ['chin/chin-jaw-drop-incr'], gain: .55 },
  chin: { negative: ['chin/chin-prominent-decr'], positive: ['chin/chin-prominent-incr'] },
  chinHeight: { negative: ['chin/chin-height-decr'], positive: ['chin/chin-height-incr'] },
  chinCleft: { negative: ['chin/chin-cleft-decr'], positive: ['chin/chin-cleft-incr'] },
  chinBones: { negative: ['chin/chin-bones-decr'], positive: ['chin/chin-bones-incr'] },

  cheekbones: { negative: ['cheek/l-cheek-bones-decr', 'cheek/r-cheek-bones-decr'], positive: ['cheek/l-cheek-bones-incr', 'cheek/r-cheek-bones-incr'] },
  cheekVolume: { negative: ['cheek/l-cheek-volume-decr', 'cheek/r-cheek-volume-decr'], positive: ['cheek/l-cheek-volume-incr', 'cheek/r-cheek-volume-incr'] },
  cheekHeight: { negative: ['cheek/l-cheek-trans-down', 'cheek/r-cheek-trans-down'], positive: ['cheek/l-cheek-trans-up', 'cheek/r-cheek-trans-up'] },
  cheekInner: { negative: ['cheek/l-cheek-inner-decr', 'cheek/r-cheek-inner-decr'], positive: ['cheek/l-cheek-inner-incr', 'cheek/r-cheek-inner-incr'] },

  forehead: { negative: ['forehead/forehead-scale-vert-decr'], positive: ['forehead/forehead-scale-vert-incr'] },
  foreheadProjection: { negative: ['forehead/forehead-trans-backward'], positive: ['forehead/forehead-trans-forward'] },
  foreheadTemple: { negative: ['forehead/forehead-temple-decr'], positive: ['forehead/forehead-temple-incr'] },
  foreheadNubian: { negative: ['forehead/forehead-nubian-decr'], positive: ['forehead/forehead-nubian-incr'] },

  eyeSize: { negative: ['eyes/l-eye-scale-decr', 'eyes/r-eye-scale-decr'], positive: ['eyes/l-eye-scale-incr', 'eyes/r-eye-scale-incr'] },
  eyeHeight: { negative: ['eyes/l-eye-trans-down', 'eyes/r-eye-trans-down'], positive: ['eyes/l-eye-trans-up', 'eyes/r-eye-trans-up'] },
  eyeSpacing: { negative: ['eyes/l-eye-trans-in', 'eyes/r-eye-trans-in'], positive: ['eyes/l-eye-trans-out', 'eyes/r-eye-trans-out'] },
  eyeInnerHeight: { negative: ['eyes/l-eye-height1-decr', 'eyes/r-eye-height1-decr'], positive: ['eyes/l-eye-height1-incr', 'eyes/r-eye-height1-incr'] },
  eyeOuterHeight: { negative: ['eyes/l-eye-height3-decr', 'eyes/r-eye-height3-decr'], positive: ['eyes/l-eye-height3-incr', 'eyes/r-eye-height3-incr'] },
  eyeFold: { negative: ['eyes/l-eye-eyefold-concave', 'eyes/r-eye-eyefold-concave'], positive: ['eyes/l-eye-eyefold-convex', 'eyes/r-eye-eyefold-convex'] },
  epicanthus: { negative: ['eyes/l-eye-epicanthus-in', 'eyes/r-eye-epicanthus-in'], positive: ['eyes/l-eye-epicanthus-out', 'eyes/r-eye-epicanthus-out'] },
  eyeBags: { negative: ['eyes/l-eye-bag-decr', 'eyes/r-eye-bag-decr'], positive: ['eyes/l-eye-bag-incr', 'eyes/r-eye-bag-incr'] },
  eyeBagHeight: { negative: ['eyes/l-eye-bag-height-decr', 'eyes/r-eye-bag-height-decr'], positive: ['eyes/l-eye-bag-height-incr', 'eyes/r-eye-bag-height-incr'] },

  brows: { negative: ['eyebrows/eyebrows-trans-down'], positive: ['eyebrows/eyebrows-trans-up'] },
  browProjection: { negative: ['eyebrows/eyebrows-trans-backward'], positive: ['eyebrows/eyebrows-trans-forward'] },
  browAngle: { negative: ['eyebrows/eyebrows-angle-down'], positive: ['eyebrows/eyebrows-angle-up'] },

  noseSize: { negative: ['nose/nose-volume-decr'], positive: ['nose/nose-volume-incr'] },
  noseWidth: { negative: ['nose/nose-scale-horiz-decr'], positive: ['nose/nose-scale-horiz-incr'] },
  noseLength: { negative: ['nose/nose-scale-depth-decr'], positive: ['nose/nose-scale-depth-incr'] },
  noseHeight: { negative: ['nose/nose-scale-vert-decr'], positive: ['nose/nose-scale-vert-incr'] },
  noseTip: { negative: ['nose/nose-point-down'], positive: ['nose/nose-point-up'] },
  noseTipWidth: { negative: ['nose/nose-point-width-decr'], positive: ['nose/nose-point-width-incr'] },
  nostrilWidth: { negative: ['nose/nose-nostrils-width-decr'], positive: ['nose/nose-nostrils-width-incr'] },
  nostrilAngle: { negative: ['nose/nose-nostrils-angle-down'], positive: ['nose/nose-nostrils-angle-up'] },
  noseFlare: { negative: ['nose/nose-flaring-decr'], positive: ['nose/nose-flaring-incr'] },
  noseCurve: { negative: ['nose/nose-curve-concave'], positive: ['nose/nose-curve-convex'] },
  noseHump: { negative: ['nose/nose-hump-decr'], positive: ['nose/nose-hump-incr'] },
  noseCompression: { negative: ['nose/nose-compression-compress'], positive: ['nose/nose-compression-uncompress'] },

  // Legacy composite.
  mouth: {
    negative: ['mouth/mouth-scale-horiz-decr', 'mouth/mouth-upperlip-volume-decr', 'mouth/mouth-lowerlip-volume-decr'],
    positive: ['mouth/mouth-scale-horiz-incr', 'mouth/mouth-upperlip-volume-incr', 'mouth/mouth-lowerlip-volume-incr'], gain: .72,
  },
  mouthWidth: { negative: ['mouth/mouth-scale-horiz-decr'], positive: ['mouth/mouth-scale-horiz-incr'] },
  mouthHeight: { negative: ['mouth/mouth-scale-vert-decr'], positive: ['mouth/mouth-scale-vert-incr'] },
  mouthProjection: { negative: ['mouth/mouth-trans-backward'], positive: ['mouth/mouth-trans-forward'] },
  mouthPosition: { negative: ['mouth/mouth-trans-down'], positive: ['mouth/mouth-trans-up'] },
  upperLipVolume: { negative: ['mouth/mouth-upperlip-volume-decr'], positive: ['mouth/mouth-upperlip-volume-incr'] },
  lowerLipVolume: { negative: ['mouth/mouth-lowerlip-volume-decr'], positive: ['mouth/mouth-lowerlip-volume-incr'] },
  upperLipHeight: { negative: ['mouth/mouth-upperlip-height-decr'], positive: ['mouth/mouth-upperlip-height-incr'] },
  lowerLipHeight: { negative: ['mouth/mouth-lowerlip-height-decr'], positive: ['mouth/mouth-lowerlip-height-incr'] },
  cupidBow: { negative: ['mouth/mouth-cupidsbow-decr'], positive: ['mouth/mouth-cupidsbow-incr'] },
  cupidBowWidth: { negative: ['mouth/mouth-cupidsbow-width-decr'], positive: ['mouth/mouth-cupidsbow-width-incr'] },
  mouthCorners: { negative: ['mouth/mouth-angles-down'], positive: ['mouth/mouth-angles-up'] },
  philtrum: { negative: ['mouth/mouth-philtrum-volume-decr'], positive: ['mouth/mouth-philtrum-volume-incr'] },
  dimples: { negative: ['mouth/mouth-dimples-in'], positive: ['mouth/mouth-dimples-out'] },

  ears: { negative: ['ears/l-ear-scale-decr', 'ears/r-ear-scale-decr'], positive: ['ears/l-ear-scale-incr', 'ears/r-ear-scale-incr'] },
  earDepth: { negative: ['ears/l-ear-scale-depth-decr', 'ears/r-ear-scale-depth-decr'], positive: ['ears/l-ear-scale-depth-incr', 'ears/r-ear-scale-depth-incr'] },
  earHeight: { negative: ['ears/l-ear-scale-vert-decr', 'ears/r-ear-scale-vert-decr'], positive: ['ears/l-ear-scale-vert-incr', 'ears/r-ear-scale-vert-incr'] },
  earWing: { negative: ['ears/l-ear-wing-decr', 'ears/r-ear-wing-decr'], positive: ['ears/l-ear-wing-incr', 'ears/r-ear-wing-incr'] },
  earFlap: { negative: ['ears/l-ear-flap-decr', 'ears/r-ear-flap-decr'], positive: ['ears/l-ear-flap-incr', 'ears/r-ear-flap-incr'] },
  earLobe: { negative: ['ears/l-ear-lobe-decr', 'ears/r-ear-lobe-decr'], positive: ['ears/l-ear-lobe-incr', 'ears/r-ear-lobe-incr'] },
  earRotation: { negative: ['ears/l-ear-rot-backward', 'ears/r-ear-rot-backward'], positive: ['ears/l-ear-rot-forward', 'ears/r-ear-rot-forward'] },
}

export function calculateDetailTargets(body: Record<string, number>, face: Record<string, number>): WeightedTarget[] {
  const values = { ...body, ...face }
  const result: WeightedTarget[] = []
  for (const [key, driver] of Object.entries(DRIVERS)) {
    if (key.startsWith('breast') && (body.gender ?? 1) >= 0) continue
    const value = Math.max(-1, Math.min(1, values[key] ?? 0))
    if (Math.abs(value) < 0.0001) continue
    const paths = value < 0 ? driver.negative : driver.positive
    const weight = Math.abs(value) * (driver.gain ?? 1)
    for (const path of paths) result.push({ path, weight })
  }
  return result
}

export const DETAIL_TARGET_PATHS = Object.values(DRIVERS).flatMap((driver) => [...driver.negative, ...driver.positive])
