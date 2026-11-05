# Éclairage, plafonds et intégration des transitions

Base : `73172222bc012924b0a3d96d53936febb7246ef5` (WorldPlan 15).
Le nouveau contrat est WorldPlan 16 ; les versions de topologie et de géométrie
spatiale restent à 2. Les anciens rapports sont conservés.

## Causes et corrections

- Les diffuseurs étaient beiges et peu lisibles. Le matériau blanc émet une
  radiance linéaire de 2, soumise au tone mapping, sans dépendre du bloom.
  Les variantes rouges gardent leur couleur. Le rig moderne et les pools
  allumés sont plus clairs ; rig sombre, blackouts, profils dim, matériaux
  jaunes, fog et PostFX gardent leurs règles existantes.
- Les transitions imposaient un plafond à 3,8 ou 4,05 m et des joues, jambages
  et linteaux à chaque approche. Elles interrogent maintenant le vrai BSP aux
  deux extrémités. Le toit raccorde ces hauteurs à un milieu partagé. La
  couverture structurelle canonique décide entre volée ouverte, adossée à un
  mur ou encloisonnée. Les approches n'ajoutent plus de portique autonome.
- Le plafond bas de la niche était une dalle de 3 cm dont le chant restait
  exposé sous le volume voisin. `CeilingEnvelope` ferme les décrochements
  entre plafonds réellement adjacents d'un même datum, avec un solide et un
  collider identiques, sans remonter arbitrairement les plafonds bas. Les
  ouvertures entre datums et les volumes hérités ne sont pas remplis.
- Les reliefs pouvaient modifier les plafonds de pièces simplement recoupées
  par leur cellule. Seule la pièce hôte est modifiée désormais. Toit,
  métadonnées et luminaires suivent la même hauteur. Les panneaux inclinés
  utilisent la vraie sous-face et la normale de la dalle.
- L'exposition de faces élimine aussi les triangles de surface nulle, notamment
  aux extrémités de prismes effilés. Les audits contrôlent les triangles
  Float32 réellement montés, sans supposer six sommets par face découpée.

## Reproduction de la capture

Seed `LATE-OFFICE-1950`, propriétaire `0:0:0`, joueur approximatif
`(-36.57, -3.98, 20.14)`. Le point `(-36.83, -2.11, 23.75)` appartient au toit
`chunk-0:0:0/cell/0/2/0/floor-0/bsp-8/ceiling`, pièce
`chunk-0:0:0/cell/0/2/0/bsp/room-WTBLBRBTL`.

Sa sous-face reste à -2,11 m. Le retour en plâtre raccorde son dessus à
-2,08 m au toit voisin à -0,50 m. Un rayon horizontal à y=-1,30 rencontre
maintenant le retour à z=23,50 ; un contact Rapier sur cette face le confirme.
La niche ne fait qu'environ 41 cm derrière le mur : le test n'invente pas une
position debout à l'intérieur. Aucun traitement spécifique à ce seed.

## Conservation et audits

- Comparaison avant/après sur 24 seeds : 24/24 signatures identiques pour les
  features, cellules, pièces BSP (identités, formes, types et sols) et tracés
  des volées (dimensions, dénivelés, profils, composition). Les plans complets
  changent volontairement avec leurs plafonds et leurs enveloppes.
- Audit de transitions : 96 seeds, dont 32 holdout ; 1 481 liens externes,
  91 trous source, 84 reliefs et 724 460 triangles UV ; aucune erreur.
  Les 204 demi-volées échantillonnées comptent 176 ouvertes, 28 adossées et
  aucune chambre à deux côtés. Cette dernière reste couverte par test dédié.
  Dégagement réel sur marches : minimum 2,565 m, médiane 2,740 m.
  Les quatre coins des panneaux sont contrôlés sur 32 seeds à plus de 2,50 m.
- Audit de diversité : 456 plans ordinaires, aucun monument compté comme plan
  ordinaire ; aucune erreur de couture, dégagement, connectivité ou objectif.
  Part de l'emprise BSP ordinaire : 79,24 % dans le corpus de transitions.
  Pitfalls, trous, brèches, passages accroupis, portes, monticules, terrasses et
  galeries restent présents ; les tests hérités et epic1–5 sont conservés.

Les résultats détaillés sont dans `ceiling-integration.json`,
`ceiling-diversity.json` et `ceiling-preservation.json`.

## Validation exécutée

- Suite générale : 604/605. Ses 115 assertions verticales passent toutes,
  dont les nouveaux tests d'enveloppe, panneaux, collision et éclairage.
- L'unique échec porte sur le nom racine du modèle d'appartement : attendu
  `ImportedApartmentScene_v1.19.2`, reçu `russian_cigarette_pack(1).glb`.
  Le test ciblé donne 14/15 aussi bien sur la base que sur la correction.
  Le JSON de travail a été récupéré depuis les parties gzip existantes, avec
  SHA256 égal au pointeur LFS du dépôt ; ni asset ni test n'est modifié.
- Personnage : 639/639. TypeScript et builds principal/Sites réussis.
  Sortie hébergée : 148 OBJ, 148 vêtements lossless et assets de manifeste.

Commandes : `npm test -- --maxWorkers=2`, `npm run test:character`,
`npm run build`, `npm run audit:transitions`, `npm run audit:vertical`.

## Mesures et limites

Même harness `node scripts/benchmark-streaming.mjs [checkout]`, mêmes 24 seeds,
Node 24.22.1, exécutions séquentielles sans autre suite lourde en parallèle.

| Mesure | Avant médiane / P95 | Après médiane / P95 |
|---|---:|---:|
| Génération froide | 224,45 / 275,44 ms | 233,91 / 372,09 ms |
| Champ lumineux | 37,53 / 66,13 ms | 32,79 / 64,17 ms |
| Géométrie préparée dans le worker | 117,99 / 162,85 ms | 110,29 / 178,01 ms |
| Montage visuel CPU principal | 2,20 / 5,30 ms | 2,02 / 5,38 ms |
| Triangles | 14 920 / 20 802 | 13 951 / 20 182 |
| Lots visuels | 9 / 10 | 10 / 11 |
| Buffers d'architecture | 1 924 560 / 2 702 832 octets | 1 799 556 / 2 620 992 octets |
| Colliders | 997 / 1 292 | 974 / 1 261 |

Le P95 de génération froide augmente et les retours en plâtre ajoutent un lot
de matériau. Le montage principal reste proche, avec moins de triangles et de
buffers ; ces mesures ne prouvent pas une amélioration générale des FPS.
Les données brutes sont dans `ceiling-streaming-before.json` et
`ceiling-streaming-after.json`. Les caches bornés, transferts worker, instancing,
raccords lumineux entre chunks et chemin shader à deux lectures sont conservés.

L'aperçu supervisé ne démarre pas : mailbox `sites-previewd` indisponible.
Aucune inspection visuelle WebGL, capture après correction, compilation GPU ou
mesure FPS n'est revendiquée. Le benchmark exclut textures/props réels,
uploads GPU, scheduling navigateur et montage Rapier ; les contacts physiques
sont validés séparément par les tests. L'aspect final et la fluidité sur appareil
restent à vérifier en jeu.
