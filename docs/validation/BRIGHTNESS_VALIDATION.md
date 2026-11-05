# Luminosité du décor et éclairage stable de l'immeuble

Base : `687c5ebeef77f938e123f84b773eec5189c52353` (version hébergée 17).
La génération, WorldPlan 16, les colliders et les champs worker sont inchangés.

## Résultat et calibration

Le curseur « Luminosité », de 0 à 100 par pas de 1, démarre à 50. Il utilise
les paramètres persistants existants, conserve zéro et complète les anciennes
préférences sans réinitialiser les autres champs. Il reste indépendant du choix
Moderne/Classique. Les deux expériences, l'accueil et la pause partagent le même
contrôle. L'interrupteur de l'appartement reste prioritaire.

| Backrooms modernes allumées | 0 | 50 | 100 |
|---|---:|---:|---:|
| Hémisphère | 0,14 | 0,23 | 0,32 |
| Ambiante | 0,055 | 0,0775 | 0,10 |
| Clé directionnelle | 0,22 | 0,28 | 0,34 |
| Nappe minimum | 0,50 | 0,61 | 0,72 |
| Nappe maximum | 1,42 | 1,635 | 1,85 |

Les bornes sont celles de 7317222 et 687c5eb, avec les diffuseurs blancs HDR
conservés. Le milieu est une interpolation des paramètres, pas une mesure de
luminosité perceptive. Les cibles de blackout, les contacts et les pools `dim`
restent inchangés. Les palettes et le bloom sont conservés.

Le Stairwell n'avait pas reçu la hausse v17 : ses sources et son rig nocturne
ont leurs propres intensités. Il utilise, comme le mode Classique, une
atténuation relative commune : E(b)/E(100), où E est la somme du rig moderne
multipliée par la moyenne de ses deux bornes de nappe. Ainsi 100 conserve leurs
intensités de référence ; 50 vaut environ 0,6753 et 0 environ 0,4079. Cette
adaptation ne prétend pas reproduire un ancien Stairwell pixel pour pixel.
Lune et réverbère restent inchangés. Le bake classique garde ses données et sa
palette ; ses intensités de lightmap/émission et son rig sont ajustés depuis
leurs références, sans accumulation.

## Causes et corrections

- L'ancien pool déplaçait quatre sources entre sept luminaires selon la hauteur
  du joueur. Une source retirée faisait réellement perdre son éclairage à un
  palier visible. Les sept luminaires ont maintenant leur source fixe sans
  ombres locales. Aucun tri ou repositionnement par frame, et aucune variation
  du nombre de lumières du shader pendant la marche.
- La rugosité effective du terrazzo était réduite par sa texture : médiane
  0,6475 malgré le paramètre matériau à 0,86. `MatteSurface` remappe le résultat
  après échantillonnage vers [0,82 ; 0,98], soit une médiane d'environ 0,9236.
  Papier, enduit, moquette, dalles et surfaces sèches de la cage optent pour ce
  traitement. Les variations de texture restent présentes ; les pixels,
  couleurs et normales ne sont pas modifiés. Verre, métaux et diffuseurs sont
  exclus. La composition des hooks est réappliquée aux clones finaux.
- Les diffuseurs HDR restent indépendants du curseur. Il ne s'agit pas d'une
  correction de gamma/exposition appliquée à toute l'image.
- Les uniforms de nappe sont partagés entre shaders existants et décors
  chargés ultérieurement. Les montages, promotions d'aperçu et changements de
  mode reçoivent la valeur actuelle. Un remplacement de vue qui attend ses
  assets relit la dernière valeur avant de devenir visible.
- Le curseur ne reconstruit ni monde, collider, géométrie, texture de champ,
  bake ou composer. Les matériaux classiques sont réétalonnés depuis leurs
  références. Le gain de l'appartement respecte son état allumé/éteint.

## Mesures et tests

Les données sont dans `brightness-controls.json` et `brightness-matte.json`.
La sonde CPU de contribution locale mesure sept positions de palier et neuf
hauteurs d'observateur : dérive maximale avant 100 % (certaines contributions
disparaissent), après 0 %. Elle utilise une atténuation ponctuelle Lambert
sans occlusion ; elle ne mesure pas la luminance finale affichée.

Sur 10 000 changements d'une vraie vue d'architecture, le proxy CPU mesure une
médiane de 0,00013 ms et un P95 de 0,000641 ms par appel. Les objets, versions de
matériaux, données de champ, empreinte SHA256 du plan et couleurs HDR restent
identiques. Ces temps excluent les uploads d'uniforms et le rendu GPU.

Les tests couvrent le vrai contrôle DOM dans les deux expériences, la migration,
le stockage bloqué, les valeurs invalides, les bornes, la composition de shaders,
les ressources conservées, les prochains chunks, la promotion d'aperçu et une
bascule de mode asynchrone pendant une modification du curseur. Les sept paliers
sont sondés dans les deux modes et à 0/50/100. L'interrupteur de l'appartement
est testé avec une vraie source Three et un matériau lumineux.

- Suite générale : **614/615**, dont toutes les nouvelles régressions de luminosité.
- Unique échec préexistant : nom racine de l'asset d'appartement, attendu
  `ImportedApartmentScene_v1.19.2`, reçu `russian_cigarette_pack(1).glb`.
  Le test ciblé sur la base donne également 14/15. L'asset récupéré a le même
  SHA256 que le pointeur LFS ; ni cet asset ni le test ne sont modifiés.
- Personnage : **639/639**, suite complète avec les véritables rigs.
- TypeScript, build principal et build hébergé : réussis.
- Sortie hébergée : 148 OBJ, 148 vêtements lossless et assets de manifeste vérifiés.

Commandes : `npm test -- --maxWorkers=2`, `npm run test:character`,
`npm run build` ; les fichiers ciblés sont ceux cités dans le guide de vérification.

## Limites

Le superviseur d'aperçu est indisponible : mailbox `sites-previewd` absente.
Aucune capture après correction, validation WebGL, mesure GPU ou FPS n'est
revendiquée. Les tests ne remplacent pas une comparaison perceptive à 0/50/100
dans les deux expériences. Le passage de quatre à sept sources ajoute trois
lumières locales sans ombres : le budget reste fixe mais son coût GPU n'est pas
mesuré ici. Le bloom inchangé et l'aspect final des reflets restent à inspecter
en jeu.
