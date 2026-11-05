import { morphDefaults } from '../core/morphs'
import {
  ageMorphFromYears,
  footMorphFromShoeSizeEu,
  genderMorphForSex,
  handMorphFromLengthCm,
  heightMorphFromCm,
  weightMorphFromBmi,
} from '../core/humanMeasurements'
import type { CharacterConfig } from '../core/types'

export function makeDefaultCharacter(): CharacterConfig {
  const gender = genderMorphForSex('male')
  return {
    id: 'preset-thomas',
    name: 'Thomas',
    baseAssetId: 'makehuman-hm08',
    body: {
      ...morphDefaults('body'),
      gender,
      age: ageMorphFromYears(32),
      height: heightMorphFromCm(180, gender),
      weight: weightMorphFromBmi(23.8),
      muscle: 0.10,
      shoulders: 0.08,
      waist: -0.02,
      feet: footMorphFromShoeSizeEu(43, gender),
      hands: handMorphFromLengthCm(19, gender),
      raceAsian: 0,
      raceAfrican: 0,
    },
    face: {
      ...morphDefaults('face'),
      jaw: 0.04,
      chin: 0.02,
      noseWidth: 0.01,
      faceShape: 0.01,
    },
    appearance: {
      skinColor: '#c99475',
      skinMaterialId: 'mh-skin-mindfront_aksel_skin',
      eyeColor: '#59483b',
      hairId: 'mh-hair-culturalibre_hair_14',
      hairMaterialId: null,
      hairColor: '#2b2521',
      eyebrowsId: 'mh-eyebrows-mindfront_eyebrows_03',
      eyelashesId: 'mh-eyelashes-mindfront_eyelashes_01',
      beardId: null,
      moustacheId: null,
      nailsId: null,
      beardColor: '#2b2521',
    },
    wardrobe: {
      top: 'mh-top-toigo_fisherman_sweater',
      bottom: 'mh-bottom-mindfront_male_trousers_1',
      shoes: 'mh-shoes-toigo_ankle_boots_male',
      colors: { top: '#88847b', bottom: '#3a4046', shoes: '#42342c' },
    },
    accessories: [],
    updatedAt: Date.now(),
  }
}
