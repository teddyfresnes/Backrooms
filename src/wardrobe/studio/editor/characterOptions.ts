import {
  ageMorphFromYears,
  footMorphFromShoeSizeEu,
  genderMorphForSex,
  handMorphFromLengthCm,
  heightMorphFromCm,
  weightMorphFromBmi,
  type BiologicalSex,
} from '../core/humanMeasurements'
import type { CharacterConfig } from '../core/types'
import { makeDefaultCharacter } from '../state/defaults'

export interface CharacterOption {
  id: string
  label: string
  previewImage: string
  config: CharacterConfig
}

type Phenotype = 'caucasian' | 'asian' | 'african' | 'hispanic' | 'arab'

interface Variant {
  sex: BiologicalSex
  phenotype: Phenotype
  age: number
  height: number
  bmi: number
  skin: string
  skinMaterial?: string | null
  eyes: string
  hair: string | null
  hairColor: string
  hairMaterial?: string | null
  eyebrows?: string | null
  eyelashes?: string | null
  top: string
  bottom: string
  shoes: string
  topColor?: string
  bottomColor?: string
  shoeColor?: string
  body?: Record<string, number>
  face?: Record<string, number>
}

function variant(label: string, values: Variant): CharacterOption {
  const config = makeDefaultCharacter()
  const gender = genderMorphForSex(values.sex)
  const id = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
  config.name = label
  config.id = `preset-${id}`

  // The runtime ships Asian and African macro corners. Arab and Hispanic
  // presets keep the neutral base geometry and rely on warmer skin plus
  // individual facial/body variation instead of caricatured shortcuts.
  const asianWeight = values.phenotype === 'asian' ? 0.82 : 0
  const africanWeight = values.phenotype === 'african' ? 0.88 : 0
  config.body = {
    ...config.body,
    gender,
    age: ageMorphFromYears(values.age),
    height: heightMorphFromCm(values.height, gender),
    weight: weightMorphFromBmi(values.bmi),
    feet: footMorphFromShoeSizeEu(values.sex === 'male' ? 43 : 39, gender),
    hands: handMorphFromLengthCm(values.sex === 'male' ? 19 : 17.5, gender),
    raceAsian: asianWeight,
    raceAfrican: africanWeight,
    ...(values.body ?? {}),
  }
  config.face = { ...config.face, ...(values.face ?? {}) }
  config.appearance = {
    ...config.appearance,
    skinColor: values.skin,
    skinMaterialId: values.skinMaterial ?? null,
    eyeColor: values.eyes,
    hairId: values.hair,
    hairMaterialId: values.hairMaterial ?? null,
    hairColor: values.hairColor,
    eyebrowsId: values.eyebrows ?? (values.sex === 'female' ? 'mh-eyebrows-mindfront_eyebrows_09' : 'mh-eyebrows-mindfront_eyebrows_03'),
    eyelashesId: values.eyelashes ?? (values.sex === 'female' ? 'mh-eyelashes-mindfront_eyelashes_03' : 'mh-eyelashes-mindfront_eyelashes_01'),
    beardId: null,
    moustacheId: null,
  }
  config.wardrobe = {
    top: values.top,
    bottom: values.bottom,
    shoes: values.shoes,
    colors: {
      top: values.topColor ?? '#ece8df',
      bottom: values.bottomColor ?? '#344256',
      shoes: values.shoeColor ?? '#3a3935',
    },
  }
  config.accessories = []
  return {
    id,
    label,
    previewImage: `/assets/characters/presets/${id}.webp`,
    config,
  }
}

// Everyday, visually coherent presets with broader diversity and stronger body
// variation: slim, athletic, broad, curvy, older, younger, etc.
export const CHARACTER_OPTIONS: CharacterOption[] = [
  variant('Thomas', {
    sex: 'male', phenotype: 'caucasian', age: 32, height: 180, bmi: 23.8,
    skin: '#c99475', skinMaterial: 'mh-skin-mindfront_aksel_skin', eyes: '#59483b', hair: 'mh-hair-culturalibre_hair_14', hairColor: '#2b2521',
    top: 'mh-top-toigo_fisherman_sweater', bottom: 'mh-bottom-mindfront_male_trousers_1', shoes: 'mh-shoes-toigo_ankle_boots_male',
    topColor: '#88847b', bottomColor: '#3a4046', shoeColor: '#42342c',
    body: { muscle: 0.10, shoulders: 0.08, waist: -0.02 },
    face: { jaw: 0.04, chin: 0.02, noseWidth: 0.01, faceShape: 0.01 },
  }),
  variant('Emma', {
    sex: 'female', phenotype: 'caucasian', age: 28, height: 166, bmi: 21.7,
    skin: '#dfb49d', skinMaterial: 'mh-skin-darthfurby_caucasian_female', eyes: '#6a5846', hair: 'mh-hair-elvs_wavy_bob', hairColor: '#49362d',
    top: 'mh-top-mindfront_knitted_sweater_01', bottom: 'mh-bottom-punkduck_female_tight_jeans', shoes: 'mh-shoes-toigo_flats',
    topColor: '#b6aaa0', bottomColor: '#35445a', shoeColor: '#403b37',
    body: { hips: 0.07, waist: -0.05, shoulders: -0.03 },
    face: { faceShape: 0.04, cheekbones: 0.04, jaw: -0.04 },
  }),
  variant('Lucas', {
    sex: 'male', phenotype: 'caucasian', age: 25, height: 177, bmi: 22.7,
    skin: '#d0a080', skinMaterial: 'mh-skin-toigo_light_skin_male_freckles', eyes: '#4c5c62', hair: 'mh-hair-cortu_short_messy_hair', hairColor: '#2f2926',
    top: 'mh-top-elvs_crude_t-shirt_male', bottom: 'mh-bottom-mindfront_male_trousers_2', shoes: 'mh-shoes-toigo_mj_cloth_shoes',
    topColor: '#d5d2ca', bottomColor: '#2d3e55', shoeColor: '#55504a',
    body: { muscle: 0.06, shoulders: 0.04, legLength: 0.02 },
    face: { jaw: 0.02, noseLength: 0.02, forehead: 0.01 },
  }),
  variant('Claire', {
    sex: 'female', phenotype: 'caucasian', age: 36, height: 170, bmi: 22.5,
    skin: '#e1b69e', skinMaterial: 'mh-skin-toigo_light_skin_female_freckles', eyes: '#66745e', hair: 'mh-hair-o4saken_long01', hairColor: '#6a5940', hairMaterial: 'mh-hairmat-toigo_long_01_ash',
    top: 'mh-top-joepal_crude_t-shirt_female', bottom: 'mh-bottom-mindfront_female_trousers_1', shoes: 'mh-shoes-toigo_flats',
    topColor: '#8c9a93', bottomColor: '#3d4148', shoeColor: '#403a35',
    body: { hips: 0.05, waist: -0.03 },
    face: { cheekbones: 0.06, faceShape: 0.05, noseLength: -0.02 },
  }),
  variant('Kenji', {
    sex: 'male', phenotype: 'asian', age: 29, height: 174, bmi: 22.9,
    skin: '#c79a78', skinMaterial: 'mh-skin-onlytheghosts_old_eurasian_male', eyes: '#302a26', hair: 'mh-hair-culturalibre_hair_02', hairColor: '#171615',
    top: 'mh-top-namuhekam_male_polo_shirt', bottom: 'mh-bottom-mindfront_male_trousers_1', shoes: 'mh-shoes-toigo_mj_cloth_shoes',
    topColor: '#68737b', bottomColor: '#343a40', shoeColor: '#33312e',
    body: { muscle: 0.04, shoulders: 0.02, waist: -0.02 },
    face: { faceShape: 0.02, jaw: 0.01, cheekbones: 0.04, eyeSpacing: 0.01 },
  }),
  variant('Mei', {
    sex: 'female', phenotype: 'asian', age: 27, height: 162, bmi: 20.9,
    skin: '#d5aa8d', skinMaterial: 'mh-skin-onlytheghosts_young_eurasian_female', eyes: '#302a25', hair: 'mh-hair-o4saken_chinesebob01', hairColor: '#171615',
    top: 'mh-top-toigo_basic_tucked_t-shirt', bottom: 'mh-bottom-mindfront_female_trousers_1', shoes: 'mh-shoes-toigo_flats',
    topColor: '#d8d2c7', bottomColor: '#414b52', shoeColor: '#3b3936',
    body: { hips: 0.03, waist: -0.05, shoulders: -0.03 },
    face: { faceShape: 0.03, cheekbones: 0.05, jaw: -0.04, eyeSpacing: 0.01 },
  }),
  variant('Diego', {
    sex: 'male', phenotype: 'hispanic', age: 34, height: 178, bmi: 24.6,
    skin: '#b98261', skinMaterial: 'mh-skin-toigo_light_skin_male_bronze', eyes: '#3d3029', hair: 'mh-hair-elvs_grump_hair', hairColor: '#261d19',
    top: 'mh-top-elvs_male_shirt_untucked_bd1', bottom: 'mh-bottom-punkduck_male_classic_jeans', shoes: 'mh-shoes-toigo_ankle_boots_male',
    topColor: '#c7c2b7', bottomColor: '#34455a', shoeColor: '#4a3b31',
    body: { muscle: 0.14, shoulders: 0.08, chest: 0.05 },
    face: { jaw: 0.05, cheekbones: 0.03, noseWidth: 0.04, chin: 0.01 },
  }),
  variant('Sofia', {
    sex: 'female', phenotype: 'hispanic', age: 30, height: 165, bmi: 22.2,
    skin: '#c58e70', skinMaterial: 'mh-skin-toigo_light_skin_female_bronze', eyes: '#44332a', hair: 'mh-hair-o4saken_curly01', hairColor: '#211b18',
    top: 'mh-top-elvs_ruffle_sleeve_peasant_blouse_1', bottom: 'mh-bottom-punkduck_female_tight_jeans', shoes: 'mh-shoes-toigo_flats',
    topColor: '#c9b9aa', bottomColor: '#33445d', shoeColor: '#3c3732',
    body: { hips: 0.08, waist: -0.05, shoulders: -0.02 },
    face: { faceShape: 0.04, cheekbones: 0.06, noseWidth: 0.03, jaw: -0.03 },
  }),
  variant('Julien', {
    sex: 'male', phenotype: 'caucasian', age: 45, height: 182, bmi: 25.3,
    skin: '#c59778', skinMaterial: 'mh-skin-jartur69_middleage_slavic_male_with_genitals_and_beard', eyes: '#584a3f', hair: 'mh-hair-culturalibre_hair_05', hairColor: '#40372f',
    top: 'mh-top-toigo_fisherman_sweater', bottom: 'mh-bottom-toigo_wool_pants', shoes: 'mh-shoes-culturalibre_male_boots',
    topColor: '#9b9a90', bottomColor: '#44423d', shoeColor: '#40362d',
    body: { weight: 0.10, bodyFat: 0.07, shoulders: 0.05, waist: 0.05 },
    face: { jaw: 0.05, faceShape: 0.03, forehead: 0.02 },
  }),
  variant('Léa', {
    sex: 'female', phenotype: 'caucasian', age: 23, height: 164, bmi: 21.0,
    skin: '#e0b49d', skinMaterial: 'mh-skin-darthfurby_caucasian_female', eyes: '#55656b', hair: 'mh-hair-toigo_blunt_bob_with_bangs', hairColor: '#6b4b36',
    top: 'mh-top-joepal_crude_t-shirt_female', bottom: 'mh-bottom-punkduck_female_tight_jeans', shoes: 'mh-shoes-toigo_mj_cloth_shoes',
    topColor: '#d3c7ba', bottomColor: '#31445e', shoeColor: '#59534c',
    body: { weight: -0.05, waist: -0.06, hips: 0.04 },
    face: { jaw: -0.05, chin: -0.02, faceShape: 0.02 },
  }),
  variant('Minho', {
    sex: 'male', phenotype: 'asian', age: 38, height: 176, bmi: 23.5,
    skin: '#bf906e', skinMaterial: 'mh-skin-onlytheghosts_old_eurasian_male', eyes: '#2d2824', hair: 'mh-hair-elvs_short_side_do', hairColor: '#171615',
    top: 'mh-top-elvs_male_shirt_untucked_bd1', bottom: 'mh-bottom-mindfront_male_trousers_2', shoes: 'mh-shoes-toigo_ankle_boots_male',
    topColor: '#879098', bottomColor: '#353a3d', shoeColor: '#40362f',
    body: { muscle: 0.08, shoulders: 0.04, waist: 0.01 },
    face: { faceShape: 0.03, cheekbones: 0.04, jaw: 0.03, noseLength: -0.01 },
  }),
  variant('Valentina', {
    sex: 'female', phenotype: 'hispanic', age: 40, height: 168, bmi: 23.1,
    skin: '#bb8063', skinMaterial: 'mh-skin-toigo_light_skin_female_bronze', eyes: '#49352c', hair: 'mh-hair-o4saken_long01', hairColor: '#30221c',
    top: 'mh-top-mindfront_knitted_sweater_02', bottom: 'mh-bottom-punkduck_female_tight_jeans', shoes: 'mh-shoes-toigo_ankle_boots_female',
    topColor: '#967f73', bottomColor: '#37465b', shoeColor: '#463a32',
    body: { hips: 0.06, waist: -0.02, bodyFat: 0.03 },
    face: { cheekbones: 0.05, jaw: -0.01, noseWidth: 0.03, faceShape: 0.04 },
  }),
  variant('Malik', {
    sex: 'male', phenotype: 'african', age: 31, height: 188, bmi: 28.2,
    skin: '#5f3d2d', skinMaterial: 'mh-skin-mindfront_skin_male_african_middleage', eyes: '#241a16', hair: 'mh-hair-elvs_short_side_do', hairColor: '#120f0f',
    top: 'mh-top-elvs_male_shirt_untucked_bd1', bottom: 'mh-bottom-mindfront_male_trousers_2', shoes: 'mh-shoes-culturalibre_male_boots',
    topColor: '#7f8a8c', bottomColor: '#31363d', shoeColor: '#362d28',
    body: { muscle: 0.26, shoulders: 0.16, chest: 0.10, waist: 0.03 },
    face: { jaw: 0.07, cheekbones: 0.05, noseWidth: 0.06, chin: 0.03 },
  }),
  variant('Nia', {
    sex: 'female', phenotype: 'african', age: 26, height: 176, bmi: 20.3,
    skin: '#6b4533', skinMaterial: 'mh-skin-callharvey3d_midtoned_female', eyes: '#2b201b', hair: 'mh-hair-elvs_braided_rows', hairColor: '#171311',
    top: 'mh-top-toigo_basic_tucked_t-shirt', bottom: 'mh-bottom-mindfront_female_trousers_1', shoes: 'mh-shoes-toigo_flats',
    topColor: '#d7d2c8', bottomColor: '#3b454d', shoeColor: '#38332f',
    body: { weight: -0.10, waist: -0.06, hips: 0.03, shoulders: 0.01, legLength: 0.04 },
    face: { cheekbones: 0.07, jaw: -0.01, noseWidth: 0.05, faceShape: 0.03 },
  }),
  variant('Amara', {
    sex: 'female', phenotype: 'african', age: 35, height: 169, bmi: 29.4,
    skin: '#6d4736', skinMaterial: 'mh-skin-callharvey3d_midtoned_female', eyes: '#261d18', hair: 'mh-hair-elvs_micky_afro', hairColor: '#151210',
    top: 'mh-top-mindfront_knitted_sweater_02', bottom: 'mh-bottom-elvs_jeans_bootcut', shoes: 'mh-shoes-toigo_ankle_boots_female',
    topColor: '#8f867f', bottomColor: '#33435b', shoeColor: '#403630',
    body: { bodyFat: 0.12, weight: 0.12, hips: 0.09, waist: -0.01, shoulders: -0.01 },
    face: { cheekbones: 0.06, jaw: -0.02, noseWidth: 0.05, chin: -0.01 },
  }),
  variant('Vincent', {
    sex: 'male', phenotype: 'arab', age: 37, height: 181, bmi: 27.0,
    skin: '#a97858', skinMaterial: 'mh-skin-toigo_light_skin_male_bronze', eyes: '#3a2a20', hair: 'mh-hair-culturalibre_hair_05', hairColor: '#181514',
    top: 'mh-top-namuhekam_male_polo_shirt', bottom: 'mh-bottom-punkduck_male_classic_jeans', shoes: 'mh-shoes-toigo_mj_cloth_shoes',
    topColor: '#3b4855', bottomColor: '#26384d', shoeColor: '#3d3b35',
    body: { muscle: 0.14, shoulders: 0.09, chest: 0.06, bodyFat: 0.02 },
    face: { jaw: 0.06, noseWidth: 0.03, noseLength: 0.03, cheekbones: 0.03 },
  }),
  variant('Aïcha', {
    sex: 'female', phenotype: 'arab', age: 29, height: 167, bmi: 24.0,
    skin: '#b38668', skinMaterial: 'mh-skin-cutoff3d_indian_female_enhanced', eyes: '#3a2b23', hair: 'mh-hair-rehmanpolanski_hair_bun_brown', hairColor: '#1b1614',
    top: 'mh-top-elvs_ruffle_sleeve_peasant_blouse_1', bottom: 'mh-bottom-mindfront_female_trousers_1', shoes: 'mh-shoes-toigo_flats',
    topColor: '#c3b4a7', bottomColor: '#404850', shoeColor: '#39332f',
    body: { hips: 0.06, waist: -0.04, shoulders: -0.01, bodyFat: 0.02 },
    face: { cheekbones: 0.05, jaw: -0.01, noseWidth: 0.02, faceShape: 0.03 },
  }),
  variant('Hana', {
    sex: 'female', phenotype: 'asian', age: 21, height: 158, bmi: 19.1,
    skin: '#d2a587', skinMaterial: 'mh-skin-onlytheghosts_young_eurasian_female', eyes: '#2a2521', hair: 'mh-hair-o4saken_long01', hairColor: '#191716', hairMaterial: 'mh-hairmat-toigo_long_01_black',
    top: 'mh-top-joepal_crude_t-shirt_female', bottom: 'mh-bottom-punkduck_female_tight_jeans', shoes: 'mh-shoes-toigo_mj_cloth_shoes',
    topColor: '#ece8df', bottomColor: '#30415b', shoeColor: '#55504a',
    body: { weight: -0.12, waist: -0.06, hips: 0.02, shoulders: -0.04, raceAsian: 0.96 },
    face: { faceShape: 0.04, cheekbones: 0.05, jaw: -0.07, eyeSpacing: 0.01, eyeFold: 0.03, epicanthus: -0.05, eyeSize: -0.01, noseWidth: -0.03, noseLength: -0.02, chin: -0.02 },
  }),
]
