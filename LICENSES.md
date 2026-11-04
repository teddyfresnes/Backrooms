# Licences et crédits

Ce document recense les ressources tierces utilisées par le projet, leurs auteurs et leurs licences.
Les chemins indiqués sont relatifs à `public/assets/`, sauf mention contraire.

Le détail des sources et des transformations appliquées (recompression, découpage, normalisation) est consigné dans :

- [`public/assets/licenses.json`](public/assets/licenses.json)
- [`public/assets/characters/MATERIALS_CREDITS.json`](public/assets/characters/MATERIALS_CREDITS.json)
- [`public/assets/characters/hair/HAIR_CREDITS.json`](public/assets/characters/hair/HAIR_CREDITS.json)
- [`public/assets/characters/clothes/makehuman/CLOTHING_CREDITS.json`](public/assets/characters/clothes/makehuman/CLOTHING_CREDITS.json)

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Textures et matériaux](#textures-et-matériaux)
3. [Audio](#audio)
4. [Modèles 3D](#modèles-3d)
5. [Personnages](#personnages)
6. [Code et polices](#code-et-polices)
7. [Attributions CC BY](#attributions-cc-by)
8. [Licences de référence](#licences-de-référence)

## Vue d'ensemble

| Provenance | Contenu | Licence |
|---|---|---|
| [ambientCG](https://ambientcg.com) | Textures PBR (moquette, plâtre, plafond) | CC0 1.0 |
| [Poly Haven](https://polyhaven.com) | Mobilier et accessoires 3D | CC0 1.0 |
| [Kenney](https://kenney.nl) | Furniture Kit, Retro Urban Kit, porte de bureau | CC0 1.0 |
| [Freesound](https://freesound.org) | Ambiances, pas, impacts, interactions, interface | CC0 1.0 et CC BY 4.0 |
| [Sketchfab](https://sketchfab.com) | Appartement, fenêtre, portes, boîte aux lettres, table | CC BY 4.0 |
| [MakeHuman / MPFB](https://static.makehumancommunity.org) | Corps de base, morphs, peaux, coiffures, vêtements, pilosité, ongles | CC0 1.0 et CC BY |
| [Mixamo](https://www.mixamo.com) | Mannequin et animations du personnage | Conditions d'utilisation Mixamo (Adobe) |
| [OpenGameArt](https://opengameart.org) | Decals de sang | CC0 1.0 |
| [raindrop-fx](https://github.com/SardineFish/raindrop-fx) | Sprite de goutte de pluie | MIT |
| Projet | Textures générées, visuels d'interface, aperçus | Ressources du projet |

## Textures et matériaux

| Ressource | Auteur | Licence | Source | Fichiers |
|---|---|---|---|---|
| Carpet 011 | ambientCG | CC0 1.0 | [source](https://ambientcg.com/view?id=Carpet011) | `textures/carpet/carpet-color.webp`, `textures/carpet/carpet-normal-gl.webp`, `textures/carpet/carpet-arm.webp` |
| Backrooms office carpet albedo | Projet (génération d’image OpenAI) | Ressource du projet | — | `textures/carpet/carpet-color-v2.webp` |
| Painted Plaster 017 | ambientCG | CC0 1.0 | [source](https://ambientcg.com/view?id=PaintedPlaster017) | `textures/plaster/plaster-color.webp`, `textures/plaster/plaster-normal-gl.webp`, `textures/plaster/plaster-arm.webp` |
| Office Ceiling 001 | ambientCG | CC0 1.0 | [source](https://ambientcg.com/view?id=OfficeCeiling001) | `textures/ceiling/ceiling-color.webp`, `textures/ceiling/ceiling-normal-gl.webp`, `textures/ceiling/ceiling-arm.webp` |
| Backrooms wallpaper pattern | Projet (génération d’image OpenAI) | Ressource du projet | — | `textures/wallpaper/backrooms-wallpaper-generated.webp` |
| Seamless aged Backrooms wallpaper variation | Projet (génération d’image OpenAI) | Ressource du projet | — | `textures/wallpaper/backrooms-wallpaper-seamless.webp` |
| Cage d’escalier — jeu de textures PBR procédurales | Générées pour le projet à partir de ressources fournies par son auteur | — | — | `stairwell/textures/**` |
| Raindrop FX normal sprite | SardineFish | MIT | [source](https://github.com/SardineFish/raindrop-fx/blob/master/assets/img/raindrop.png) | `stairwell-window/raindrop-fx.png`, `stairwell-window/raindrop-fx.LICENSE.txt` |
| Carpet 001 | ambientCG | CC0 1.0 | [source](https://ambientcg.com/view?id=Carpet001) | `textures/white-biome/floor/*` |
| Painted Plaster 017 | ambientCG | CC0 1.0 | [source](https://ambientcg.com/view?id=PaintedPlaster017) | `textures/white-biome/wall/*` |

## Audio

| Ressource | Auteur | Licence | Source | Fichiers |
|---|---|---|---|---|
| Fluorescent lightbulb hum buzz (Extended) | Developer_Jake | CC0 1.0 | [source](https://freesound.org/people/Developer_Jake/sounds/638895/) | `audio/fluorescent-hum-cc0.mp3` |
| Air conditioner / ventilation ambience | kentspublicdomain | CC0 1.0 | [source](https://freesound.org/people/kentspublicdomain/sounds/328175/) | `audio/ventilation-cc0.mp3` |
| Walking on carpet | mlsulli | CC0 1.0 | [source](https://freesound.org/people/mlsulli/sounds/234855/) | `audio/footsteps/backrooms-carpet-*.mp3` |
| Low shoes walking on parquet | Yuval | CC0 1.0 | [source](https://freesound.org/people/Yuval/sounds/209811/) | `audio/footsteps/apartment-wood-*.mp3` |
| Sneakers walking on stone | xkeril | CC0 1.0 | [source](https://freesound.org/people/xkeril/sounds/677069/) | `audio/footsteps/stairwell-concrete-*.mp3` |
| Running on carpet in sneakers | taure | CC0 1.0 | [source](https://freesound.org/people/taure/sounds/575318/) | `audio/footsteps/run-backrooms-carpet.mp3` |
| Running footsteps on wood | thomasanthony321 | CC0 1.0 | [source](https://freesound.org/people/thomasanthony321/sounds/682772/) | `audio/footsteps/run-apartment-wood.mp3` |
| Running on concrete | vmgraw | CC0 1.0 | [source](https://freesound.org/people/vmgraw/sounds/257700/) | `audio/footsteps/run-stairwell-concrete.mp3` |
| Body fall 1 | deleted_user_2104797 | CC0 1.0 | [source](https://freesound.org/people/deleted_user_2104797/sounds/325270/) | `audio/impacts/body-fall-normalized.mp3` |
| Bones Crack | Kane53126 | CC0 1.0 | [source](https://freesound.org/people/Kane53126/sounds/257926/) | `audio/impacts/bone-crack-normalized.mp3` |
| Cinematic Glitch Transition SFX | Wakerone | CC0 1.0 | [source](https://freesound.org/people/Wakerone/sounds/513131/) | `audio/ui/intro-glitch.mp3` |
| Typewriter's Key | PerMagnusLindborg | CC0 1.0 | [source](https://freesound.org/people/PerMagnusLindborg/sounds/335898/) | `audio/ui/intro-credit.mp3` |
| Soft Dramatic Impact | NeoSpica | CC0 1.0 | [source](https://freesound.org/people/NeoSpica/sounds/504614/) | `audio/ui/intro-title.mp3` |
| Musique du menu | Fournie par l’auteur du projet | — | — | `audio/music/menu.mp3` |
| Rain against a window | nicoproson | CC0 1.0 | [source](https://freesound.org/people/nicoproson/sounds/648529/) | `audio/apartment/rain-window.mp3` |
| Wooden door open and close | Breviceps | CC0 1.0 | [source](https://freesound.org/people/Breviceps/sounds/457042/) | `audio/interactions/door-open.mp3`, `audio/interactions/door-close.mp3` |
| Door lock mechanism | sgcardinal | CC0 1.0 | [source](https://freesound.org/people/sgcardinal/sounds/395753/) | `audio/interactions/lock.mp3`, `audio/interactions/unlock.mp3` |
| Roller blinds | Garuda1982 | CC BY 4.0 | [source](https://freesound.org/people/Garuda1982/sounds/553070/) | `audio/interactions/blinds-open.mp3`, `audio/interactions/blinds-close.mp3` |
| Light Switch (on / off) | Breviceps | CC0 1.0 | [source](https://freesound.org/people/Breviceps/sounds/457037/) | `audio/interactions/light-switch-on.mp3`, `audio/interactions/light-switch-off.mp3` |
| Soft UI hover | BaggoNotes | CC0 1.0 | [source](https://freesound.org/people/BaggoNotes/sounds/720217/) | `audio/ui/menu-hover.mp3` |
| Soft UI click | Breviceps | CC0 1.0 | [source](https://freesound.org/people/Breviceps/sounds/448081/) | `audio/ui/menu-click.mp3` |

## Modèles 3D

| Ressource | Auteur | Licence | Source | Fichiers |
|---|---|---|---|---|
| Modern door | Kenney | CC0 1.0 | [source](https://poly.pizza/m/919pouyoML) | `models/doors/kenney-modern-office-door/**` |
| Furniture Kit | Kenney | CC0 1.0 | [source](https://kenney.nl/assets/furniture-kit) | `textures/kenney/furniture-kit/**` |
| Retro Urban Kit | Kenney | CC0 1.0 | [source](https://kenney.nl/assets/retro-urban-kit) | `textures/kenney/retro-urban-kit/**` |
| Curated 1K Prop Collection | Various artists / Poly Haven | CC0 1.0 | [source](https://polyhaven.com/models) | `textures/polyhaven/**` |
| An Old Cheap Room in Chinatown | Qifan Zhang (@qifanzhang) | CC BY 4.0 | [source](https://sketchfab.com/3d-models/an-old-cheap-room-in-chinatown-9c2ec26be3cb4d9b91d51755e7210fdd) | `imported-apartment/apartment.json` |
| Window | adventurer | CC BY 4.0 | [source](https://sketchfab.com/3d-models/window-255af244922e4e89aad600e345230237) | `stairwell-window/window.glb` |
| Double Doors With Windows | PIPO | CC BY 4.0 | [source](https://sketchfab.com/3d-models/double-doors-with-windows-79ebb7d7e2ec415b9320f4680440ed0e) | `stairwell-hall-door/double_doors_with_windows.glb` |
| Old Soviet Mailbox | tinderboxh | CC BY 4.0 | [source](https://sketchfab.com/3d-models/old-soviet-mailbox-dcda475994614b429ea351e070eb58c5) | `stairwell-mailbox/old_soviet_mailbox.glb` |
| Soviet Old Table | Skilletik | CC BY 4.0 | [source](https://sketchfab.com/3d-models/soviet-old-table-9e1fc1a8f6f64995bcfab5e0ca17f6ea) | `stairwell-furniture/soviet_old_table.glb` |

Le dossier `polyhaven/` à la racine du dépôt contient les distributions d'origine des modèles Poly Haven (CC0 1.0).

## Personnages

### Corps de base

| Ressource | Auteur | Licence | Source | Fichiers |
|---|---|---|---|---|
| Maillage HM08, morph targets, poids et textures | MakeHuman / MPFB | CC0 1.0 | [licence](https://static.makehumancommunity.org/about/license.html) | `mpfb/**` |

### Animations

| Ressource | Auteur | Licence | Fichiers |
|---|---|---|---|
| Mannequin, locomotion, combat, sauts, accroupissements, récupérations | Mixamo (Adobe) | [Conditions d'utilisation Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | `assets/character/*.brpart` (dépaquetés dans `public/assets/character/`), `characters/animations/*.fbx` |
| Émotes (pistes et icônes) | Projet, à partir des animations ci-dessus | Conditions d'utilisation Mixamo | `assets/emotes/**` (racine du dépôt) |

### Effets

| Ressource | Auteur | Licence | Source | Fichiers |
|---|---|---|---|---|
| Blood Splatter | ExileGL | CC0 1.0 | [source](https://opengameart.org/content/blood-splatter) | `assets/blood/blood-decal-a.png` |
| Blood splat | TobiasM | CC0 1.0 | [source](https://opengameart.org/content/blood-splat) | `assets/blood/blood-decal-b.png` |
| Blood decal | OpenGameArt | CC0 1.0 | [OpenGameArt](https://opengameart.org) | `assets/blood/blood-decal-c.png` |

### Peaux

| Peau | Auteur | Licence | Dossier |
|---|---|---|---|
| Uniforme Texture | blindsaypatten | CC0 1.0 | `characters/skins/makehuman/blindsaypatten_uniform_skin_texture` |
| 03 Jeune Femme Naturelle | bobby | CC0 1.0 | `characters/skins/makehuman/bobby_03_young_female_hairless` |
| Médium Femme | callharvey3d | CC0 1.0 | `characters/skins/makehuman/callharvey3d_midtoned_female` |
| Indienne Femme Détaillée | cutoff3d | CC0 1.0 | `characters/skins/makehuman/cutoff3d_indian_female_enhanced` |
| Indienne Femme | cutoff3d | CC0 1.0 | `characters/skins/makehuman/cutoff3d_indian_female_skin` |
| Claire Femme | darthfurby | CC0 1.0 | `characters/skins/makehuman/darthfurby_caucasian_female` |
| Rouge Rousse | flower-angel | CC0 1.0 | `characters/skins/makehuman/flower-angel_red_head_skin` |
| Zoey | nyloseth | CC0 1.0 | `characters/skins/makehuman/nyloseth_zoeyskin` |
| Mature Eurasienne Femme | onlytheghosts | CC0 1.0 | `characters/skins/makehuman/onlytheghosts_middle_aged_eurasian_female` |
| Ancien Eurasienne Femme | onlytheghosts | CC0 1.0 | `characters/skins/makehuman/onlytheghosts_old_eurasian_female` |
| Jeune Eurasienne Femme | onlytheghosts | CC0 1.0 | `characters/skins/makehuman/onlytheghosts_young_eurasian_female` |
| Naturelle Claire Femme | saltycowdawg | CC0 1.0 | `characters/skins/makehuman/saltycowdawg_genuine_caucasian_female_with_genitals` |
| Crème Femme | skalldyrssuppe | CC0 1.0 | `characters/skins/makehuman/skalldyrssuppe_creamy_female` |
| Alana Claire Femme | spreadcore | CC0 1.0 | `characters/skins/makehuman/spreadcore_alana_caucasian_female_with_genitals_skin` |
| Clair Femme Bronzé | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_female_bronze` |
| Clair Femme Bronzé Maquillage | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_female_bronze_with_makeup` |
| Clair Femme Taches de rousseur | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_female_freckles` |
| Clair Femme Roux | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_female_ginger` |
| Clair Femme Roux 2 | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_female_ginger_2` |
| Clair Femme Roux Maquillage | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_female_ginger_with_makeup` |
| Clair Femme Violet Maquillage | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_female_with_violet_makeup` |
| Clair Maquillage | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_with_makeup` |
| Clair Naturel Maquillage | toigo | CC0 1.0 | `characters/skins/makehuman/toigo_light_skin_with_natural_makeup` |
| jartur69_middleage_slavic_male_with_genitals_and_beard | jartur69 | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/jartur69_middleage_slavic_male_with_genitals_and_beard` |
| jartur69_old_slavic_male_with_genitals_and_beard | jartur69 | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/jartur69_old_slavic_male_with_genitals_and_beard` |
| ken1138_caucasian_male_tattooed_skin | ken1138 | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/ken1138_caucasian_male_tattooed_skin` |
| mindfront_aksel_skin | Mindfront | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/mindfront_aksel_skin` |
| mindfront_skin_male_african_middleage | Mindfront | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/mindfront_skin_male_african_middleage` |
| onlytheghosts_old_eurasian_male | OnlyTheGhosts | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/onlytheghosts_old_eurasian_male` |
| rehmanpolanski_skin_viking_tattoos | RehmanPolanski | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/rehmanpolanski_skin_viking_tattoos` |
| toigo_light_skin_male_bronze | MargaretToigo | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/toigo_light_skin_male_bronze` |
| toigo_light_skin_male_freckles | MargaretToigo | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/toigo_light_skin_male_freckles` |
| toigo_light_skin_male_ginger | MargaretToigo | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/toigo_light_skin_male_ginger` |
| toigo_light_skin_male_with_emo_eyes | MargaretToigo | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/toigo_light_skin_male_with_emo_eyes` |
| toigo_light_skin_male_with_eyeliner | MargaretToigo | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/toigo_light_skin_male_with_eyeliner` |
| toigo_light_skin_male_with_goth_makeup | MargaretToigo | CC0 1.0 ([skins02](https://static.makehumancommunity.org/assets/assetpacks/skins02.html)) | `characters/skins/external/toigo_light_skin_male_with_goth_makeup` |

### Pilosité et ongles

| Ressource | Auteur | Licence | Source | Dossier |
|---|---|---|---|---|
| Faun beard | culturalibre | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2356) | `characters/bodyparts/makehuman/culturalibre_faun_beard` |
| Sigmund beard | grinsegold | CC0 1.0 | [source](http://www.makehumancommunity.org/node/877) | `characters/bodyparts/makehuman/grinsegold_beard_sigmund_wip` |
| Viking beard | RehmanPolanski | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2614) | `characters/bodyparts/makehuman/rehmanpolanski_beard_viking` |
| Viking moustache | RehmanPolanski | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2615) | `characters/bodyparts/makehuman/rehmanpolanski_moustache_viking` |
| Scruffy beard | WDG | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1769) | `characters/bodyparts/makehuman/wdg_scruffy_beard` |
| Long fingernails — blue butterfly | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/976) | `characters/bodyparts/makehuman/toigo_long_fingernails_blue_butterfly` |
| Female fingernails — natural | grinsegold | CC0 1.0 | [source](http://www.makehumancommunity.org/node/195) | `characters/bodyparts/makehuman/grinsegold_fingernails_female_natural` |
| Female fingernails | wolgade | CC0 1.0 | [source](http://www.makehumancommunity.org/node/70) | `characters/bodyparts/makehuman/wolgade_female_fingernails` |
| Nails and toenails 01 | Mindfront | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1371) | `characters/bodyparts/makehuman/mindfront_nails_toes_01` |
| Short nails 01 | Mindfront | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1368) | `characters/bodyparts/makehuman/mindfront_nails_01_short` |
| Medium nails 02 | Mindfront | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1369) | `characters/bodyparts/makehuman/mindfront_nails_02_medium` |
| Long nails 03 | Mindfront | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1370) | `characters/bodyparts/makehuman/mindfront_nails_03_long` |
| Long scruffy beard | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2611) | `characters/bodyparts/makehuman/elvs_scruffy_beard1` |
| Thin moustache | grinsegold | CC BY | [source](http://www.makehumancommunity.org/node/187) | `characters/bodyparts/makehuman/grinsegold_moustache` |
| Full beard | grinsegold | CC BY | [source](http://www.makehumancommunity.org/node/188) | `characters/bodyparts/makehuman/grinsegold_full_beard` |
| Dalí-style moustache | culturalibre | CC BY | [source](http://www.makehumancommunity.org/node/2872) | `characters/bodyparts/makehuman/culturalibre_dal_moustache` |
| mindfront_eyebrows_02 | Mindfront | CC0 1.0 | [eyebrows01](https://static.makehumancommunity.org/assets/assetpacks/eyebrows01.html) | `characters/bodyparts/external/eyebrows/mindfront_eyebrows_02` |
| mindfront_eyebrows_03 | Mindfront | CC0 1.0 | [eyebrows01](https://static.makehumancommunity.org/assets/assetpacks/eyebrows01.html) | `characters/bodyparts/external/eyebrows/mindfront_eyebrows_03` |
| mindfront_eyebrows_05 | Mindfront | CC0 1.0 | [eyebrows01](https://static.makehumancommunity.org/assets/assetpacks/eyebrows01.html) | `characters/bodyparts/external/eyebrows/mindfront_eyebrows_05` |
| mindfront_eyebrows_09 | Mindfront | CC0 1.0 | [eyebrows01](https://static.makehumancommunity.org/assets/assetpacks/eyebrows01.html) | `characters/bodyparts/external/eyebrows/mindfront_eyebrows_09` |
| mindfront_eyebrows_11 | Mindfront | CC0 1.0 | [eyebrows01](https://static.makehumancommunity.org/assets/assetpacks/eyebrows01.html) | `characters/bodyparts/external/eyebrows/mindfront_eyebrows_11` |
| mindfront_eyebrows_12 | Mindfront | CC0 1.0 | [eyebrows01](https://static.makehumancommunity.org/assets/assetpacks/eyebrows01.html) | `characters/bodyparts/external/eyebrows/mindfront_eyebrows_12` |
| mindfront_eyebrows_14 | Mindfront | CC0 1.0 | [eyebrows01](https://static.makehumancommunity.org/assets/assetpacks/eyebrows01.html) | `characters/bodyparts/external/eyebrows/mindfront_eyebrows_14` |
| mindfront_eyelashes_01 | Mindfront | CC0 1.0 | [eyelashes01](https://static.makehumancommunity.org/assets/assetpacks/eyelashes01.html) | `characters/bodyparts/external/eyelashes/mindfront_eyelashes_01` |
| mindfront_eyelashes_02 | Mindfront | CC0 1.0 | [eyelashes01](https://static.makehumancommunity.org/assets/assetpacks/eyelashes01.html) | `characters/bodyparts/external/eyelashes/mindfront_eyelashes_02` |
| mindfront_eyelashes_03 | Mindfront | CC0 1.0 | [eyelashes01](https://static.makehumancommunity.org/assets/assetpacks/eyelashes01.html) | `characters/bodyparts/external/eyelashes/mindfront_eyelashes_03` |
| mindfront_eyelashes_04 | Mindfront | CC0 1.0 | [eyelashes01](https://static.makehumancommunity.org/assets/assetpacks/eyelashes01.html) | `characters/bodyparts/external/eyelashes/mindfront_eyelashes_04` |
| mindfront_eyelashes_05 | Mindfront | CC0 1.0 | [eyelashes01](https://static.makehumancommunity.org/assets/assetpacks/eyelashes01.html) | `characters/bodyparts/external/eyelashes/mindfront_eyelashes_05` |

### Coiffures

| Nom | Auteur | Licence | Source | Dossier |
|---|---|---|---|---|
| Boucles cloud | Cortu | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2808) | `characters/hair/makehuman/cortu_strawberry_cloud_hair` |
| Court décoiffé | Cortu | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2809) | `characters/hair/makehuman/cortu_short_messy_hair` |
| Frange droite | Cortu | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2810) | `characters/hair/makehuman/cortu_straight_bangs` |
| Shaggy | Cortu | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2811) | `characters/hair/makehuman/cortu_shaggy_green_hair` |
| Cartoon | culturalibre (d'après RodAlln) | CC BY | [source](http://www.makehumancommunity.org/node/2043) | `characters/hair/makehuman/culturalibre_hair_12` |
| Iroh | culturalibre (d'après Kavzekenza) | CC BY | [source](http://www.makehumancommunity.org/node/2027) | `characters/hair/makehuman/culturalibre_hair_11` |
| Reeve | culturalibre (d'après madsoul666) | CC BY | [source](http://www.makehumancommunity.org/node/2428) | `characters/hair/makehuman/culturalibre_hair_14` |
| Rigide brun | culturalibre (d'après ucupumar) | CC BY | [source](http://www.makehumancommunity.org/node/2421) | `characters/hair/makehuman/culturalibre_hair_13` |
| Style 01 | culturalibre | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2893) | `characters/hair/makehuman/culturalibre_hair_01` |
| Style 02 | culturalibre | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2892) | `characters/hair/makehuman/culturalibre_hair_02` |
| Style 05 | culturalibre | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2445) | `characters/hair/makehuman/culturalibre_hair_05` |
| Style 06 | culturalibre | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2479) | `characters/hair/makehuman/culturalibre_hair_06` |
| Style 17 | culturalibre (d'après miccall) | CC BY | [source](http://www.makehumancommunity.org/node/2481) | `characters/hair/makehuman/culturalibre_hair_17` |
| Style 18 | culturalibre (d'après miccall) | CC BY | [source](http://www.makehumancommunity.org/node/2482) | `characters/hair/makehuman/culturalibre_hair_18` |
| Adrienne | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1862) | `characters/hair/makehuman/elvs_adrienne_hair` |
| Afro | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2817) | `characters/hair/makehuman/elvs_micky_afro` |
| Années 50 | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2001) | `characters/hair/makehuman/elvs_50s_updo` |
| Années 80 | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2174) | `characters/hair/makehuman/elvs_that_80s_babe_hair` |
| Ashley | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1861) | `characters/hair/makehuman/elvs_ashley_may_hair` |
| Carré bouclé | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2683) | `characters/hair/makehuman/elvs_inverted_curly_bob` |
| Carré ondulé | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1551) | `characters/hair/makehuman/elvs_wavy_bob` |
| Chignon tressé | Elvaerwyn | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1337) | `characters/hair/makehuman/elvs_reverse_french_braid_bun` |
| Chignon tressé 2 | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2177) | `characters/hair/makehuman/elvs_braid_bun` |
| Court côté | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1479) | `characters/hair/makehuman/elvs_short_side_do` |
| Daisy court | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1860) | `characters/hair/makehuman/elvs_short_daisy_hair` |
| Daisy long | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1859) | `characters/hair/makehuman/elvs_daisy_hair` |
| Double tresse | Elvaerwyn | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1336) | `characters/hair/makehuman/elvs_double_mh_braid` |
| Grump | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2796) | `characters/hair/makehuman/elvs_grump_hair` |
| Hazel | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2816) | `characters/hair/makehuman/elvs_hazel_hair` |
| Hippy | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1812) | `characters/hair/makehuman/elvs_lady_hippy_hair` |
| Island | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1811) | `characters/hair/makehuman/elvs_island_princess_hair` |
| Katherine | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1863) | `characters/hair/makehuman/elvs_katherine_hair` |
| Keylth | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2173) | `characters/hair/makehuman/elvs_keylth_hair` |
| Lara | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2634) | `characters/hair/makehuman/elvs_lara_hair` |
| Maxwell | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1639) | `characters/hair/makehuman/elvs_maxwell_hair` |
| Petit carré | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1710) | `characters/hair/makehuman/elvs_witchy_lil_bob` |
| Tresse décoiffée | Elvaerwyn | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1334) | `characters/hair/makehuman/elvs_unkempt_french_braid` |
| Tresse française | Elvaerwyn | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1335) | `characters/hair/makehuman/elvs_french_braid_variation` |
| Tresses rangées | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1659) | `characters/hair/makehuman/elvs_braided_rows` |
| Classique blond | Faydaen | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2667) | `characters/hair/makehuman/faydaen_hair_1` |
| Chignon blond | grinsegold | CC BY | [source](http://www.makehumancommunity.org/node/172) | `characters/hair/makehuman/grinsegold_wig_bun_blonde_braids` |
| Perruque nœud | grinsegold | CC BY | [source](http://www.makehumancommunity.org/node/173) | `characters/hair/makehuman/grinsegold_wig_bow_tie` |
| Carré court | littleright | CC0 1.0 | [source](http://www.makehumancommunity.org/node/936) | `characters/hair/makehuman/littleright_bobcut_hair` |
| Carré arrondi | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1677) | `characters/hair/makehuman/toigo_curled_under_bob` |
| Carré arrondi + frange | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1689) | `characters/hair/makehuman/toigo_curled_under_bob_with_bangs` |
| Carré droit | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1669) | `characters/hair/makehuman/toigo_blunt_bob` |
| Carré droit + frange | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1681) | `characters/hair/makehuman/toigo_blunt_bob_with_bangs` |
| Carré plongeant | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1673) | `characters/hair/makehuman/toigo_inverted_bob` |
| Carré plongeant + frange | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1685) | `characters/hair/makehuman/toigo_inverted_bob_with_bangs` |
| Bouclé 01 | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/1466) | `characters/hair/makehuman/o4saken_curly01` |
| Bouclé Alpha | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/480) | `characters/hair/makehuman/punkduck_alpha7_curly` |
| Bouclé Alpha 2 | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/477) | `characters/hair/makehuman/punkduck_alpha7_curly2` |
| Carré chinois | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/1474) | `characters/hair/makehuman/o4saken_chinesebob01` |
| Long 01 | punkduck | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1471) | `characters/hair/makehuman/o4saken_long01` |
| Long Alpha | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/482) | `characters/hair/makehuman/punkduck_alpha7_long` |
| Long Alpha 2 | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/492) | `characters/hair/makehuman/punkduck_alpha7_long2` |
| Chignon brun | RehmanPolanski | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2477) | `characters/hair/makehuman/rehmanpolanski_hair_bun_brown` |
| Blond + bandeau | sonntag78 | CC0 1.0 | [source](http://www.makehumancommunity.org/node/207) | `characters/hair/makehuman/sonntag78_blond_with_headband` |
| Jungle | sonntag78 | CC0 1.0 | [source](http://www.makehumancommunity.org/node/174) | `characters/hair/makehuman/sonntag78_junglebook_hair` |

### Vêtements

| Nom | Auteur | Licence | Source | Dossier |
|---|---|---|---|---|
| Bottes hautes souples | Cortu | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2803) | `characters/clothes/makehuman/shoes/cortu_floppy_overknee_shoes` |
| Pantalon cargo | Cortu | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2798) | `characters/clothes/makehuman/bottoms/cortu_cargo_pants` |
| Short jean | Cortu | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2800) | `characters/clothes/makehuman/bottoms/cortu_jeans_shorts` |
| T-bar | Cortu | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2801) | `characters/clothes/makehuman/shoes/cortu_t-bar` |
| Bottes homme | culturalibre | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2548) | `characters/clothes/makehuman/shoes/culturalibre_male_boots` |
| T-shirt camo | DredNicolson | CC BY | [source](http://www.makehumancommunity.org/node/433) | `characters/clothes/makehuman/tops/drednicolson_short-tail_camo_tee` |
| Tunique asymétrique | DredNicolson | CC BY | [source](http://www.makehumancommunity.org/node/409) | `characters/clothes/makehuman/tops/drednicolson_asymmetric_tunic_and_sash` |
| Blouse volantée | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1256) | `characters/clothes/makehuman/tops/elvs_ruffle_sleeve_peasant_blouse_1` |
| Chemise + cravate | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1799) | `characters/clothes/makehuman/tops/elvs_male_shirt_tie_tucked1` |
| Chemise sortie | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1800) | `characters/clothes/makehuman/tops/elvs_male_shirt_untucked_bd1` |
| Disco double volant | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2578) | `characters/clothes/makehuman/bottoms/elvs_disco_pants_double_ruffles` |
| Disco slim | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2583) | `characters/clothes/makehuman/bottoms/elvs_disco_pants_skinny` |
| Disco volant | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2579) | `characters/clothes/makehuman/bottoms/elvs_disco_pants_single_ruffles` |
| Débardeur Lara | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2635) | `characters/clothes/makehuman/tops/elvs_lara_tank1` |
| Débardeur femme | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1447) | `characters/clothes/makehuman/tops/elvs_ladies_tank1` |
| Débardeur homme | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1804) | `characters/clothes/makehuman/tops/elvs_male_tankshirt1` |
| Débardeur muscle | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1803) | `characters/clothes/makehuman/tops/elvs_male_muscle_shirt1` |
| Débardeur sport | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1431) | `characters/clothes/makehuman/tops/elvs_male_athletic_tank1` |
| Jean bootcut | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1798) | `characters/clothes/makehuman/bottoms/elvs_jeans_bootcut` |
| Jean droit | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1802) | `characters/clothes/makehuman/bottoms/elvs_jeans_straight_leg` |
| Pantalon chaîne | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1805) | `characters/clothes/makehuman/bottoms/elvs_male_trouser_with_chain` |
| Pantalon homme | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1796) | `characters/clothes/makehuman/bottoms/elvs_male_trouser` |
| Pantalon évasé | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2577) | `characters/clothes/makehuman/bottoms/elvs_gored_elephant_pants` |
| Sweat zippé | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1450) | `characters/clothes/makehuman/tops/elvs_hooded_sweat_jacket1` |
| T-shirt homme | Elvaerwyn | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1416) | `characters/clothes/makehuman/tops/elvs_crude_t-shirt_male` |
| T-shirt logo | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1661) | `characters/clothes/makehuman/tops/elvs_male_logo_tshirt1` |
| Top bohème | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/1808) | `characters/clothes/makehuman/tops/elvs_male_boho_top1` |
| Top disco | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2580) | `characters/clothes/makehuman/tops/elvs_disco_top2` |
| Top disco papillon | Elvaerwyn | CC BY | [source](http://www.makehumancommunity.org/node/2584) | `characters/clothes/makehuman/tops/elvs_disco_top_1_butterfly` |
| Chemise rayée | EWS | CC BY | [source](http://www.makehumancommunity.org/node/1229) | `characters/clothes/makehuman/tops/ews_striped_shirt` |
| Bottes pirate | grinsegold | CC0 1.0 | [source](http://www.makehumancommunity.org/node/211) | `characters/clothes/makehuman/shoes/grinsegold_female_pirate_boots` |
| Pull usé | janexx | CC BY | [source](http://www.makehumancommunity.org/node/2767) | `characters/clothes/makehuman/tops/janexx_old_female_sweater` |
| T-shirt femme | Joel Palmius | CC0 1.0 | [source](http://www.makehumancommunity.org/node/894) | `characters/clothes/makehuman/tops/joepal_crude_t-shirt_female` |
| Ballerines | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1734) | `characters/clothes/makehuman/shoes/toigo_ballet_flats` |
| Ballerines fleurs | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1736) | `characters/clothes/makehuman/shoes/toigo_ballet_flats_with_flowers` |
| Ballerines nœud | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1735) | `characters/clothes/makehuman/shoes/toigo_ballet_flats_with_bows` |
| Bottines | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1738) | `characters/clothes/makehuman/shoes/toigo_ankle_boots_female` |
| Bottines homme | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1743) | `characters/clothes/makehuman/shoes/toigo_ankle_boots_male` |
| Bottines talon | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1694) | `characters/clothes/makehuman/shoes/toigo_stiletto_booties` |
| Caraco | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1726) | `characters/clothes/makehuman/tops/toigo_camisole_top` |
| Chaussures plates | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1117) | `characters/clothes/makehuman/shoes/toigo_flats` |
| Chaussures toile | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1700) | `characters/clothes/makehuman/shoes/toigo_mj_cloth_shoes` |
| Corsage | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1667) | `characters/clothes/makehuman/tops/toigo_bodice-style_top` |
| Pantalon harem | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1728) | `characters/clothes/makehuman/bottoms/toigo_harem_pants` |
| Pantalon laine | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1194) | `characters/clothes/makehuman/bottoms/toigo_wool_pants` |
| Pull marin | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1187) | `characters/clothes/makehuman/tops/toigo_fisherman_sweater` |
| T-shirt rentré | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1203) | `characters/clothes/makehuman/tops/toigo_basic_tucked_t-shirt` |
| Top col roulé | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1642) | `characters/clothes/makehuman/tops/toigo_turtleneck_halter_top` |
| Top goutte | MargaretToigo | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1606) | `characters/clothes/makehuman/tops/toigo_keyhole_tank_top` |
| Cardigan long | Mindfront | CC BY | [source](http://www.makehumancommunity.org/node/1528) | `characters/clothes/makehuman/tops/mindfront_cardigan_long_open_front` |
| Débardeur | Mindfront | CC BY | [source](http://www.makehumancommunity.org/node/341) | `characters/clothes/makehuman/tops/mindfront_tank_top_01` |
| Pantalon femme | Mindfront | CC BY | [source](http://www.makehumancommunity.org/node/790) | `characters/clothes/makehuman/bottoms/mindfront_female_trousers_1` |
| Pantalon homme 1 | Mindfront | CC BY | [source](http://www.makehumancommunity.org/node/746) | `characters/clothes/makehuman/bottoms/mindfront_male_trousers_1` |
| Pantalon homme 2 | Mindfront | CC BY | [source](http://www.makehumancommunity.org/node/1497) | `characters/clothes/makehuman/bottoms/mindfront_male_trousers_2` |
| Pull nordique | Mindfront | CC BY | [source](http://www.makehumancommunity.org/node/1527) | `characters/clothes/makehuman/tops/mindfront_lusekofta` |
| Pull tricot 1 | Mindfront | CC BY | [source](http://www.makehumancommunity.org/node/660) | `characters/clothes/makehuman/tops/mindfront_knitted_sweater_01` |
| Pull tricot 2 | Mindfront | CC BY | [source](http://www.makehumancommunity.org/node/661) | `characters/clothes/makehuman/tops/mindfront_knitted_sweater_02` |
| Polo | namuhekam | CC0 1.0 | [source](http://www.makehumancommunity.org/node/2909) | `characters/clothes/makehuman/tops/namuhekam_male_polo_shirt` |
| Blouse lacée | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/1775) | `characters/clothes/makehuman/tops/punkduck_lace_up_blouse` |
| Chemise sans manches | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/440) | `characters/clothes/makehuman/tops/punkduck_sleeveless_shirt` |
| Crop top col haut | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/1088) | `characters/clothes/makehuman/tops/punkduck_high_neck_crop_top` |
| Crop top sans manches | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/925) | `characters/clothes/makehuman/tops/punkduck_sleeveless_crop_top` |
| Jean classique | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/1655) | `characters/clothes/makehuman/bottoms/punkduck_male_classic_jeans` |
| Jean slim | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/391) | `characters/clothes/makehuman/bottoms/punkduck_female_tight_jeans` |
| T-shirt graphique | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/810) | `characters/clothes/makehuman/tops/punkduck_deathnote_t-shirt` |
| Top bandeau | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/420) | `characters/clothes/makehuman/tops/punkduck_tube_top` |
| Top col V | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/419) | `characters/clothes/makehuman/tops/punkduck_v_neck_top` |
| Top fines bretelles | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/459) | `characters/clothes/makehuman/tops/punkduck_spaghetti_strap_tank_top` |
| Top rétro | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/781) | `characters/clothes/makehuman/tops/punkduck_retro_top` |
| Top épaules nues | punkduck | CC BY | [source](http://www.makehumancommunity.org/node/791) | `characters/clothes/makehuman/tops/punkduck_off-shoulder_long-sleeve_top` |
| Bottes de pluie | scailman | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1778) | `characters/clothes/makehuman/shoes/scailman_semitransparent_water_boots` |
| Bottes plateforme | scailman | CC0 1.0 | [source](http://www.makehumancommunity.org/node/1467) | `characters/clothes/makehuman/shoes/scailman_gogo_platform_boots` |
| Top bandeau | skalldyrssuppe | CC0 1.0 | [source](http://www.makehumancommunity.org/node/975) | `characters/clothes/makehuman/tops/skalldyrssuppe_tube_top_funky_colors` |

### Variantes de couleur de cheveux

| Famille | Variantes | Licence | Source |
|---|---|---|---|
| braid01 | `toigo_braid01_ash`, `toigo_braid01_black`, `toigo_braid01_fuchsia`, `toigo_braid01_ginger`, `toigo_braid01_golden`, `toigo_braid01_gray`, `toigo_braid01_red`, `toigo_braid01_strawberry`, `toigo_braid01_teal`, `toigo_braid01_violet` | CC0 1.0 | [system_hair_materials01](https://static.makehumancommunity.org/assets/assetpacks/system_hair_materials01.html), [02](https://static.makehumancommunity.org/assets/assetpacks/system_hair_materials02.html) |
| long01 | `joepal_long_01_blond`, `punkduck_blond_for_long01`, `toigo_long_01_ash`, `toigo_long_01_black`, `toigo_long_01_fuchsia`, `toigo_long_01_ginger`, `toigo_long_01_gray`, `toigo_long_01_red`, `toigo_long_01_teal`, `toigo_long_01_violet` | CC0 1.0 | [system_hair_materials01](https://static.makehumancommunity.org/assets/assetpacks/system_hair_materials01.html), [02](https://static.makehumancommunity.org/assets/assetpacks/system_hair_materials02.html) |
| short02 | `bogdan666_short_02_brown`, `bogdan666_short_02_gray`, `bogdan666_short_02_red`, `culturalibre_short_02_green`, `jartur69_short02_blond`, `jartur69_short02_blond_for_female` | CC0 1.0 | [system_hair_materials01](https://static.makehumancommunity.org/assets/assetpacks/system_hair_materials01.html), [02](https://static.makehumancommunity.org/assets/assetpacks/system_hair_materials02.html) |

Les aperçus des personnages prédéfinis (`characters/presets/*.webp`), les vignettes (`characters/thumbnails/*.svg`) et les fonds d'interface (`ui/*.webp`) sont des ressources du projet.

## Code et polices

Dépendances incluses dans le build, y compris transitives :

| Licence | Paquets |
|---|---|
| MIT | `@babel/runtime`, `@monogrid/gainmap-js`, `@react-three/drei`, `@react-three/fiber`, `@tweenjs/tween.js`, `@types/draco3d`, `@types/offscreencanvas`, `@types/react`, `@types/react-reconciler`, `@types/stats.js`, `@types/three`, `@types/webxr`, `@use-gesture/core`, `@use-gesture/react`, `base64-js`, `bidi-js`, `buffer`, `camera-controls`, `cross-env`, `cross-spawn`, `csstype`, `detect-gpu`, `fflate`, `glsl-noise`, `immediate`, `is-promise`, `its-fine`, `lie`, `maath`, `meshline`, `meshoptimizer`, `path-key`, `react`, `react-dom`, `react-reconciler`, `react-use-measure`, `require-from-string`, `scheduler`, `shebang-command`, `shebang-regex`, `stats-gl`, `stats.js`, `suspend-react`, `three`, `three-mesh-bvh`, `three-stdlib`, `troika-three-text`, `troika-three-utils`, `troika-worker-utils`, `tunnel-rat`, `use-sync-external-store`, `utility-types`, `webgl-constants`, `webgl-sdf-generator`, `zustand` |
| Apache-2.0 | `@dimforge/rapier3d`, `@dimforge/rapier3d-compat`, `@mediapipe/tasks-vision`, `draco3d`, `hls.js`, `promise-worker-transferable` |
| ISC | `isexe`, `potpack`, `which` |
| OFL-1.1 | `@fontsource-variable/jetbrains-mono`, `@fontsource-variable/space-grotesk` |
| BSD-3-Clause | `ieee754` |
| Zlib | `postprocessing` |

Polices : [JetBrains Mono](https://www.jetbrains.com/lp/mono/) et [Space Grotesk](https://github.com/floriankarsten/space-grotesk), distribuées via Fontsource sous licence SIL Open Font License 1.1.

Les outils de développement (Vite, Vitest, TypeScript, esbuild, happy-dom) ne sont pas inclus dans le build et sont distribués sous licences open source (MIT, Apache-2.0, ISC, BSD, MPL-2.0).

## Attributions CC BY

Les ressources suivantes sont utilisées sous licence Creative Commons Attribution.

### Modèles 3D et audio

- **Long scruffy beard** par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2611
- **Thin moustache** par grinsegold — CC BY — http://www.makehumancommunity.org/node/187
- **Full beard** par grinsegold — CC BY — http://www.makehumancommunity.org/node/188
- **Dalí-style moustache** par culturalibre — CC BY — http://www.makehumancommunity.org/node/2872
- **An Old Cheap Room in Chinatown** par Qifan Zhang (@qifanzhang) — CC BY 4.0 — https://sketchfab.com/3d-models/an-old-cheap-room-in-chinatown-9c2ec26be3cb4d9b91d51755e7210fdd
- **Window** par adventurer — CC BY 4.0 — https://sketchfab.com/3d-models/window-255af244922e4e89aad600e345230237
- **Double Doors With Windows** par PIPO — CC BY 4.0 — https://sketchfab.com/3d-models/double-doors-with-windows-79ebb7d7e2ec415b9320f4680440ed0e
- **Old Soviet Mailbox** par tinderboxh — CC BY 4.0 — https://sketchfab.com/3d-models/old-soviet-mailbox-dcda475994614b429ea351e070eb58c5
- **Soviet Old Table** par Skilletik — CC BY 4.0 — https://sketchfab.com/3d-models/soviet-old-table-9e1fc1a8f6f64995bcfab5e0ca17f6ea
- **Roller blinds** par Garuda1982 — CC BY 4.0 — https://freesound.org/people/Garuda1982/sounds/553070/

### Coiffures

- **Cartoon** (`culturalibre_hair_12`) par culturalibre — CC BY — http://www.makehumancommunity.org/node/2043
- **Iroh** (`culturalibre_hair_11`) par culturalibre — CC BY — http://www.makehumancommunity.org/node/2027
- **Reeve** (`culturalibre_hair_14`) par culturalibre — CC BY — http://www.makehumancommunity.org/node/2428
- **Rigide brun** (`culturalibre_hair_13`) par culturalibre — CC BY — http://www.makehumancommunity.org/node/2421
- **Style 17** (`culturalibre_hair_17`) par culturalibre — CC BY — http://www.makehumancommunity.org/node/2481
- **Style 18** (`culturalibre_hair_18`) par culturalibre — CC BY — http://www.makehumancommunity.org/node/2482
- **Adrienne** (`elvs_adrienne_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1862
- **Afro** (`elvs_micky_afro`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2817
- **Années 50** (`elvs_50s_updo`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2001
- **Années 80** (`elvs_that_80s_babe_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2174
- **Ashley** (`elvs_ashley_may_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1861
- **Carré bouclé** (`elvs_inverted_curly_bob`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2683
- **Carré ondulé** (`elvs_wavy_bob`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1551
- **Chignon tressé 2** (`elvs_braid_bun`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2177
- **Court côté** (`elvs_short_side_do`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1479
- **Daisy court** (`elvs_short_daisy_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1860
- **Daisy long** (`elvs_daisy_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1859
- **Grump** (`elvs_grump_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2796
- **Hazel** (`elvs_hazel_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2816
- **Hippy** (`elvs_lady_hippy_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1812
- **Island** (`elvs_island_princess_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1811
- **Katherine** (`elvs_katherine_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1863
- **Keylth** (`elvs_keylth_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2173
- **Lara** (`elvs_lara_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2634
- **Maxwell** (`elvs_maxwell_hair`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1639
- **Petit carré** (`elvs_witchy_lil_bob`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1710
- **Tresses rangées** (`elvs_braided_rows`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1659
- **Chignon blond** (`grinsegold_wig_bun_blonde_braids`) par grinsegold — CC BY — http://www.makehumancommunity.org/node/172
- **Perruque nœud** (`grinsegold_wig_bow_tie`) par grinsegold — CC BY — http://www.makehumancommunity.org/node/173
- **Bouclé 01** (`o4saken_curly01`) par punkduck — CC BY — http://www.makehumancommunity.org/node/1466
- **Bouclé Alpha** (`punkduck_alpha7_curly`) par punkduck — CC BY — http://www.makehumancommunity.org/node/480
- **Bouclé Alpha 2** (`punkduck_alpha7_curly2`) par punkduck — CC BY — http://www.makehumancommunity.org/node/477
- **Carré chinois** (`o4saken_chinesebob01`) par punkduck — CC BY — http://www.makehumancommunity.org/node/1474
- **Long Alpha** (`punkduck_alpha7_long`) par punkduck — CC BY — http://www.makehumancommunity.org/node/482
- **Long Alpha 2** (`punkduck_alpha7_long2`) par punkduck — CC BY — http://www.makehumancommunity.org/node/492

### Vêtements

- **T-shirt camo** (`drednicolson_short-tail_camo_tee`) par DredNicolson — CC BY — http://www.makehumancommunity.org/node/433
- **Tunique asymétrique** (`drednicolson_asymmetric_tunic_and_sash`) par DredNicolson — CC BY — http://www.makehumancommunity.org/node/409
- **Blouse volantée** (`elvs_ruffle_sleeve_peasant_blouse_1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1256
- **Chemise + cravate** (`elvs_male_shirt_tie_tucked1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1799
- **Chemise sortie** (`elvs_male_shirt_untucked_bd1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1800
- **Disco double volant** (`elvs_disco_pants_double_ruffles`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2578
- **Disco slim** (`elvs_disco_pants_skinny`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2583
- **Disco volant** (`elvs_disco_pants_single_ruffles`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2579
- **Débardeur Lara** (`elvs_lara_tank1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2635
- **Débardeur femme** (`elvs_ladies_tank1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1447
- **Débardeur homme** (`elvs_male_tankshirt1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1804
- **Débardeur muscle** (`elvs_male_muscle_shirt1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1803
- **Débardeur sport** (`elvs_male_athletic_tank1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1431
- **Jean bootcut** (`elvs_jeans_bootcut`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1798
- **Jean droit** (`elvs_jeans_straight_leg`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1802
- **Pantalon chaîne** (`elvs_male_trouser_with_chain`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1805
- **Pantalon homme** (`elvs_male_trouser`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1796
- **Pantalon évasé** (`elvs_gored_elephant_pants`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2577
- **Sweat zippé** (`elvs_hooded_sweat_jacket1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1450
- **T-shirt logo** (`elvs_male_logo_tshirt1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1661
- **Top bohème** (`elvs_male_boho_top1`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/1808
- **Top disco** (`elvs_disco_top2`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2580
- **Top disco papillon** (`elvs_disco_top_1_butterfly`) par Elvaerwyn — CC BY — http://www.makehumancommunity.org/node/2584
- **Chemise rayée** (`ews_striped_shirt`) par EWS — CC BY — http://www.makehumancommunity.org/node/1229
- **Pull usé** (`janexx_old_female_sweater`) par janexx — CC BY — http://www.makehumancommunity.org/node/2767
- **Cardigan long** (`mindfront_cardigan_long_open_front`) par Mindfront — CC BY — http://www.makehumancommunity.org/node/1528
- **Débardeur** (`mindfront_tank_top_01`) par Mindfront — CC BY — http://www.makehumancommunity.org/node/341
- **Pantalon femme** (`mindfront_female_trousers_1`) par Mindfront — CC BY — http://www.makehumancommunity.org/node/790
- **Pantalon homme 1** (`mindfront_male_trousers_1`) par Mindfront — CC BY — http://www.makehumancommunity.org/node/746
- **Pantalon homme 2** (`mindfront_male_trousers_2`) par Mindfront — CC BY — http://www.makehumancommunity.org/node/1497
- **Pull nordique** (`mindfront_lusekofta`) par Mindfront — CC BY — http://www.makehumancommunity.org/node/1527
- **Pull tricot 1** (`mindfront_knitted_sweater_01`) par Mindfront — CC BY — http://www.makehumancommunity.org/node/660
- **Pull tricot 2** (`mindfront_knitted_sweater_02`) par Mindfront — CC BY — http://www.makehumancommunity.org/node/661
- **Blouse lacée** (`punkduck_lace_up_blouse`) par punkduck — CC BY — http://www.makehumancommunity.org/node/1775
- **Chemise sans manches** (`punkduck_sleeveless_shirt`) par punkduck — CC BY — http://www.makehumancommunity.org/node/440
- **Crop top col haut** (`punkduck_high_neck_crop_top`) par punkduck — CC BY — http://www.makehumancommunity.org/node/1088
- **Crop top sans manches** (`punkduck_sleeveless_crop_top`) par punkduck — CC BY — http://www.makehumancommunity.org/node/925
- **Jean classique** (`punkduck_male_classic_jeans`) par punkduck — CC BY — http://www.makehumancommunity.org/node/1655
- **Jean slim** (`punkduck_female_tight_jeans`) par punkduck — CC BY — http://www.makehumancommunity.org/node/391
- **T-shirt graphique** (`punkduck_deathnote_t-shirt`) par punkduck — CC BY — http://www.makehumancommunity.org/node/810
- **Top bandeau** (`punkduck_tube_top`) par punkduck — CC BY — http://www.makehumancommunity.org/node/420
- **Top col V** (`punkduck_v_neck_top`) par punkduck — CC BY — http://www.makehumancommunity.org/node/419
- **Top fines bretelles** (`punkduck_spaghetti_strap_tank_top`) par punkduck — CC BY — http://www.makehumancommunity.org/node/459
- **Top rétro** (`punkduck_retro_top`) par punkduck — CC BY — http://www.makehumancommunity.org/node/781
- **Top épaules nues** (`punkduck_off-shoulder_long-sleeve_top`) par punkduck — CC BY — http://www.makehumancommunity.org/node/791

## Licences de référence

- [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- [Licence MakeHuman / MPFB](https://static.makehumancommunity.org/about/license.html)
- [FAQ et conditions Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
- [Licence Poly Haven](https://polyhaven.com/license)
- [Licence ambientCG](https://docs.ambientcg.com/license/)
- [SIL Open Font License 1.1](https://openfontlicense.org)
