import type { AssetDefinition, MaterialVariantDefinition } from '../core/types'

const pretty = (value: string) => value
  .replace(/^mindfront_|^toigo_|^onlytheghosts_|^ken1138_|^jartur69_|^rehmanpolanski_/i, '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase())

const skin = (id: string, folder: string, _diffuse?: string): MaterialVariantDefinition => ({
  id: `mh-skin-${id}`,
  label: pretty(id),
  materialUrl: `/assets/characters/skins/external/${folder}/${id}.mhmat`,
  thumbnail: `/assets/characters/skins/external/${folder}/thumbnail.webp`,
  tags: ['MakeHuman', 'skin', 'CC0', 'external'],
})

const mhclo = (slot: 'eyebrows' | 'eyelashes', id: string, label: string): AssetDefinition => ({
  id: `mh-${slot}-${id}`,
  label,
  slot,
  sourceType: 'mhclo',
  url: '',
  mhcloUrl: `/assets/characters/bodyparts/external/${slot}/${id}/${id}.mhclo.gz`,
  objUrl: `/assets/characters/bodyparts/external/${slot}/${id}/${id.replace('mindfront_', 'mind_')}.obj.gz`,
  thumbnail: `/assets/characters/bodyparts/external/${slot}/${id}/thumbnail.webp`,
  tags: ['MakeHuman', slot, 'CC0', 'external', 'alpha-cards'],
})

export const EXTRA_SKINS: MaterialVariantDefinition[] = [
  skin('mindfront_aksel_skin', 'mindfront_aksel_skin', 'Aksel_Skin_diffuse.png'),
  skin('mindfront_skin_male_african_middleage', 'mindfront_skin_male_african_middleage', 'skin_male_african_middleage.png'),
  skin('onlytheghosts_old_eurasian_male', 'onlytheghosts_old_eurasian_male', 'old_eurasian_male_diffuse.png'),
  skin('toigo_light_skin_male_bronze', 'toigo_light_skin_male_bronze', 'young_lightskinned_male_diffuse_Bronze.png'),
  skin('toigo_light_skin_male_freckles', 'toigo_light_skin_male_freckles', 'young_lightskinned_male_diffuse_Freckles.png'),
  skin('toigo_light_skin_male_ginger', 'toigo_light_skin_male_ginger', 'young_lightskinned_male_diffuse_Ginger.png'),
  skin('toigo_light_skin_male_with_emo_eyes', 'toigo_light_skin_male_with_emo_eyes', 'young_lightskinned_male_diffuse_Emo.png'),
  skin('toigo_light_skin_male_with_eyeliner', 'toigo_light_skin_male_with_eyeliner', 'young_lightskinned_male_diffuse_Eyeliner.png'),
  skin('toigo_light_skin_male_with_goth_makeup', 'toigo_light_skin_male_with_goth_makeup', 'young_lightskinned_male_diffuse_GothMakeup.png'),
  skin('ken1138_caucasian_male_tattooed_skin', 'ken1138_caucasian_male_tattooed_skin', 'Caucasion_TatooedMale_Skin_Difuse.png'),
  skin('rehmanpolanski_skin_viking_tattoos', 'rehmanpolanski_skin_viking_tattoos', 'viking_male_diffuse.png'),
  skin('jartur69_middleage_slavic_male_with_genitals_and_beard', 'jartur69_middleage_slavic_male_with_genitals_and_beard', 'Jartur_mid_old_Slavic_Male_with_Genitals_and_Beard_lsdif_lighter.png'),
  skin('jartur69_old_slavic_male_with_genitals_and_beard', 'jartur69_old_slavic_male_with_genitals_and_beard', 'Jartur_old_Slavic_Male_with_Genitals_and_beard_lsdif.png'),
]

export const EXTRA_EYEBROWS: AssetDefinition[] = [
  mhclo('eyebrows', 'mindfront_eyebrows_02', 'Sourcils 02'),
  mhclo('eyebrows', 'mindfront_eyebrows_03', 'Sourcils 03'),
  mhclo('eyebrows', 'mindfront_eyebrows_05', 'Sourcils 05'),
  mhclo('eyebrows', 'mindfront_eyebrows_09', 'Sourcils 09'),
  mhclo('eyebrows', 'mindfront_eyebrows_11', 'Sourcils 11'),
  mhclo('eyebrows', 'mindfront_eyebrows_12', 'Sourcils 12'),
  mhclo('eyebrows', 'mindfront_eyebrows_14', 'Sourcils 14'),
]

export const EXTRA_EYELASHES: AssetDefinition[] = [
  mhclo('eyelashes', 'mindfront_eyelashes_01', 'Cils 01'),
  mhclo('eyelashes', 'mindfront_eyelashes_02', 'Cils 02'),
  mhclo('eyelashes', 'mindfront_eyelashes_03', 'Cils 03'),
  mhclo('eyelashes', 'mindfront_eyelashes_04', 'Cils 04'),
  mhclo('eyelashes', 'mindfront_eyelashes_05', 'Cils 05'),
]
