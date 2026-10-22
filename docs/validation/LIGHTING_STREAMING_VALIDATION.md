# Coutures lumineuses, seuils et montage des chunks

Base comparée : `68ee0e0a0d13bf9af9c5ad25bd588cf81e3b7cdc`.
Le contrat et la génération restent en WorldPlan 15 ; les changements portent
sur le rendu et le transport des données préparées.

## Causes et corrections

- Les couches de l'atlas étaient triées localement par sol. À la fin d'une
  galerie, une même ligne d'atlas pouvait désigner un autre étage. Le filtrage
  mélangeait alors leurs lumières. La sélection se fait désormais par hauteur
  réelle à chacun des quatre texels, avant interpolation. Les texels absents
  sont renormalisés ; dans un volume haut, le sol le plus proche départage les
  volumes qui contiennent le fragment.
- Un bord d'un texel raccorde les champs des huit voisins horizontaux. Il
  sélectionne leurs données par hauteur et se rétablit au démontage. Les
  originaux CPU restent intacts. La variation fluorescente est ancrée au monde.
- Une seule couche utilise RGBA16F linéaire avec hauteur prémultipliée par sa
  validité, et RGBA8 avec validité alpha : deux lectures dans le fragment, sans
  recherche d'étage ni extension float32 linéaire. Les couches superposées
  utilisent des bornes float32 nearest et les quatre échantillons explicites.
  Palette, intensités, profils dim et blackouts gardent leur étalonnage.
- Le nettoyage des murs seuls laissait des doublons avec les dalles, paliers,
  plafonds et linteaux. `FaceExposure` soustrait leurs vrais polygones ensemble,
  avant les lots de matériaux. Il traite les faces inclinées/trapézoïdales,
  retire les interfaces internes et conserve les UV monde. Aucun décalage de
  profondeur ni changement de collider.
- Le worker prépare positions, normales, UV, couleurs et bornes de culling,
  puis transfère ces tableaux séparément du plan. Le montage ne refait plus ce
  travail ni le champ zonal 2D inutilisé. Les tableaux restent dans le cache
  CPU borné ; chaque vue possède et libère ses ressources GPU.
- Les chunks spatiaux à au moins 20 m sont des aperçus d'architecture, même
  sur la story active. Sols, murs, ouvertures, escaliers, plafonds, lumière,
  portes et collisions restent réels. Props, graffitis et dommages de plafond
  arrivent à l'approche sans reconstruction de l'architecture.

## Mesures CPU reproductibles

`node scripts/benchmark-streaming.mjs [chemin-du-checkout]`, 24 seeds fixes,
exécuté séquentiellement avant/après, sans autre suite lourde en parallèle.
Les tableaux et hashes complets sont dans les JSON voisins.

| Mesure | Avant médiane / P95 | Après médiane / P95 |
|---|---:|---:|
| Montage visuel sur le thread principal | 44.39 / 75.94 ms | 2.59 / 4.57 ms |
| Géométrie préparée séparément dans le worker | intégrée au montage | 127.07 / 213.77 ms |
| Triangles | 15434 / 20786 | 14920 / 20802 |
| Lots visuels | 9 / 10 | 9 / 10 |
| Colliders | 997 / 1292 | 997 / 1292 |

Ce gain concerne le montage visuel CPU, pas toute la frame. La nouvelle
soustraction géométrique coûte davantage de travail total, effectué dans le
worker. Le test exclut les vraies textures/props, uploads GPU, compilation des
shaders et montage Rapier : il ne mesure ni les FPS ni la latence navigateur.

## Conservation et vérifications

- Les 24 hashes SHA256 des plans complets sont identiques avant/après.
  Aucun fichier de génération des salles/features n'est modifié. Le BSP,
  épaisseurs, datums variables, salles classiques/géantes, galeries en gradins,
  escaliers facultatifs, trous, pitfalls, passages accroupis, brèches et
  monuments epic1–5 conservent leurs plans et colliders. Les rapports de
  diversité précédents restent disponibles dans ce dossier.
- Suite générale finale : **594/595**, un échec connu dans
  `ImportedApartmentIntegration.test.ts` : nom racine attendu
  `ImportedApartmentScene_v1.19.2`, reçu `russian_cigarette_pack(1).glb`.
  Ni ce test ni cet asset n'ont été modifiés ; le même échec était présent
  avant cette correction.
- Personnage : **639/639**, exécution complète terminée avec résumé Node,
  dont les chutes des FBX joueur/partagé à travers trois propriétaires réels.
- Tests ciblés finaux : 16/16 lumière, coutures, buffers et visibilité,
  puis 2/2 aperçus, incluant le voisin distant sur le même étage. L'audit des
  triangles Float32 sur 16 seeds ne trouve aucun recouvrement d'aire positive
  entre faces de même normale sur les plans d'axes, tous matériaux confondus.
  Des raycasts séparés couvrent le linteau, sa sous-face et une joue inclinée.
- `node scripts/benchmark-worker.mjs 4` : transferts Node effectifs sur quatre
  seeds dans les trois modes, avec tableaux d'architecture et lumière.
- Build principal et build Sites : réussis. Vérification hébergée : 148 OBJ
  et 148 fichiers de vêtements lossless, assets de manifeste présents.

## Limites de vérification

L'aperçu supervisé ne démarre pas : mailbox `sites-previewd` indisponible.
Aucun contrôle visuel WebGL, screenshot ou relevé FPS n'est revendiqué. Les
mesures CPU et essais Three/Rapier ne garantissent pas l'absence de saccades sur
chaque appareil, notamment pendant les uploads GPU et chargements d'assets.
