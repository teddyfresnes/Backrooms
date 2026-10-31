# Murs et plinthes — 29 octobre 2026

Référence réellement examinée : `33f73c2f8960dbf1f8679171d618cb7f8198987c`,
branche `codex/vertical-topology-20261020`, version hébergée 21. Le commit
`9a404ee` cité dans la demande est antérieur : ses exceptions aléatoires et son
placement des plinthes au centre des murs avaient déjà été remplacés.

Le seed et la position de la capture du renfoncement ne sont pas disponibles.
Les reproductions synthétiques équivalentes et les seeds ci-dessous ne sont
pas présentés comme une reproduction exacte de cette capture.

## Causes restantes confirmées

1. Après les réservations et découpes, le nettoyage spatial n'appliquait pas la
   fermeture des L/T du template historique. Des continuations presque alignées
   gardaient aussi leur petite fente d'extrémité. La passe finale ferme ces
   raccords, puis reconstruit prismes, colliders et sols à partir des mêmes bornes.
2. Un sol de galerie/lower-maze peut recouvrir plusieurs pièces BSP. Le seul
   `roomId` hérité supprimait la finition de tout le sol s'il désignait une pièce
   nue. `SpatialFinishPolicy` découpe maintenant chaque face suivant les pièces
   canoniques adjacentes, leur altitude et leur politique. Les deux côtés restent
   indépendants ; aucun flood fill ne propage une finition à tout le labyrinthe.
3. Le test d'occlusion admettait l'égalité numérique : un seuil dont le sommet
   était exactement sur le sol effaçait toute la plinthe voisine. L'occlusion
   demande maintenant un recouvrement vertical strictement positif.
4. Certaines bornes de pièce et de colonne différaient de moins d'un millimètre.
   Les petites découpes éliminées laissaient une fente de sol sans support pour
   la plinthe. `SpatialFloorContacts` ferme le vrai volume de sol à ce contact,
   avec le même rendu et collider. Exemples : `WALL-FINISH-HOLDOUT-0`, adresse
   `(-1,-1,-2)`, et `WALL-FINISH-HOLDOUT-2`, adresse `(1,-1,0)`.

## Critères et invariants

- Les coordonnées sont en mètres. L'égalité numérique reste à `1e-6 m`.
  Le réalignement d'une partition est limité à 25 mm de décalage ou de fente,
  avec au plus 40 mm de différence de face ; les résidus enfouis de 40 mm au
  plus doivent représenter au plus 35 % de l'empreinte. Une vraie niche de
  30 cm est conservée dans les fixtures.
- Pour un T, le porteur couvre toute la section et la hauteur du retour. Un L
  ne change de propriétaire de coin qu'en l'absence de continuation, entre
  partitions de même hauteur ; leurs épaisseurs restent celles du BSP, jusqu'à
  2,8 m. Les grandes masses ne deviennent pas des partitions à normaliser.
- `WallSegment.junctionRole` conserve les colonnes, masses et supports après
  découpe/sérialisation. Les intrados non cubiques, détails dédiés, ouvertures,
  réservations, transitions et coupes de propriétaires sont protégés.
- Les petits contacts de sol sont limités à 5 mm, seuil de matérialisation des
  découpes spatiales. Ils ne franchissent aucun vide protégé ni frontière de
  propriétaire. Les sols inclinés et les marches ne sont pas rectangulés. Les
  marches ne reçoivent plus de bandes horizontales automatiques ; rampes et
  paliers conservent leur finition au profil réel.
- Les index spatiaux bornent les recherches. Les contacts ajoutés entrent dans
  le même index afin d'éviter les doublons. Aucun calcul par frame, mesh par
  morceau, `DoubleSide`, `polygonOffset` ou transparence n'est ajouté.
- Les UV restent exprimés dans le repère monde. `FaceExposure` et ses
  tolérances sont inchangés ; il supprime les interfaces réellement communes.

## Vérifications géométriques et physiques

- **36 tests ciblés** murs/plinthes : décroché, L et T d'épaisseurs différentes,
  pilastre enfoui/niche lisible, intrados et rôles protégés, finitions opposées,
  périmètre complet d'une pièce composée de plusieurs générateurs, pièce nue,
  passage bas, seuil, palier surélevé, pente, vide et contact de sol submillimétrique.
- **2 tests Rapier réels** sur les contacts retrouvés dans les seeds ci-dessus :
  JSON du plan, buffers transférés, triangles Three et rayons physiques
  aboutissent au même sol. Les contacts ajoutés ont une épaisseur physique.
- Frontière de chunks générée dans les deux ordres : plans identiques et traces
  de plinthes identiques de part et d'autre. Après cache vidé et régénération,
  les buffers remontés sont identiques.
- Audit indépendant de **24 seeds/adresses**, sur les buffers sérialisés et
  transférés : **58 183 sondes**, dont **748 sondes en zones nues**, réparties sur
  chaque intervalle défini par les pièces, sols et solides, au plus tous les 2 m.
  Environ **65,69 km de contours équipés** sont contrôlés. **0 erreur** : aucune
  interruption attendue manquante, plinthe dans une zone nue, plinthe sans sol,
  normale invalide ou triangle coplanaire superposé détecté.
- Le même audit sur la référence trouve **332 défauts de couverture**, dont
  environ **232,83 m** de contours équipés manquants. Ce corpus n'est pas un
  recensement de tous les mondes possibles.
- Sur ces 24 plans : **7 fragments retirés**, **17 murs corrigés**, **9 contacts
  de sol ajoutés**. Formes des pièces, features, ouvertures et données d'éclairage
  sont strictement identiques à la référence (**24/24** pour chaque hash).
- Nettoyage final idempotent et correspondance prisme/collider sur les 24 plans.
  L'architecture reste à **10 lots maximum** dans ce corpus (hors autres objets
  ajoutés au montage du jeu).

- Préservation : **512 emplacements examinés**, dont **193 structures anciennes**
  (149 squeeze-view, 25 grid-pit, 19 liminal-pit), datums/styles régionaux et
  propriétaires d'atria identiques ; **5 monuments sur 5** identiques au hash
  complet. Le BSP conserve **83,77 %** de la surface praticable des 32 plans de
  cet audit, avec les grands halls conservés.
- L'optimisation des recherches conserve le hash complet des **24 plans sur 24**
  du corpus CPU. L'index déplace ses entrées lorsque les murs changent : le test
  de coin traversant une cellule de l'index vérifie qu'aucun résidu n'est oublié.

- Suite générale finale : **659/660**, 84 fichiers, environ 255 s, sans build
  concurrent. L'unique échec porte sur le nom racine de l'asset appartement :
  attendu `ImportedApartmentScene_v1.19.2`, présent
  `russian_cigarette_pack(1).glb`. Le même test échoue sur la référence
  (**14/15** dans son fichier). L'asset est inchangé et son contenu complet est
  vérifié par le SHA256
  `1b1864ff763676e6fa4bc0b66e0ae2d854a7bf9ef3e61990d2c9f6fce7067dda`.
- TypeScript et les builds principal/hébergé passent. La version hébergée passe
  aussi **39/39** tests ciblés, incluant le vrai montage des buffers transférés.
  La sortie finale contient **3 075 fichiers**, **264 181 004 octets**, un fichier
  maximal de **16 MiB** ; les **148 OBJ** et **148 vêtements lossless** sont
  vérifiés, les assets du manifeste sont présents et l'appartement est lossless.
  La suite personnage FBX n'est pas relancée : ses modules
  d'animation, ragdoll et caméra ne changent pas ; les tests physiques natifs et
  régionaux de la suite générale ainsi que les deux nouveaux cas sont exécutés.

## Fichiers concernés

- Géométrie finale : `SpatialWallJunctions.ts`, `SpatialFloorContacts.ts`,
  `SpatialWorld.ts`, `RectIndex.ts`, `WalkableTopology.ts`, `types.ts`.
- Finition : `SpatialFinishPolicy.ts`, `SpatialBaseboards.ts`.
- Régressions : `SpatialBaseboards.test.ts`, `SpatialFinishesPhysical.test.ts`,
  `tests/support/finish-audit.ts`, `scripts/audit-wall-finishes.mjs`.
- Contrats et résultats : les trois guides génération/rendu/vérification et les
  fichiers de données liés ci-dessous. `WallJunctions`, les templates BSP, le
  rendu historique et `FaceExposure` ont été examinés ; leurs corrections
  antérieures restent en place.

## Coût CPU

Même harnais `benchmark-streaming.mjs`, 24 seeds, caches vidés, mesures finales
sans test ou build concurrent. Médiane / P95 :

| Mesure | Référence | Correction |
| --- | ---: | ---: |
| Génération worker (ms) | 224,04 / 277,87 | 234,53 / 329,26 |
| Préparation des buffers worker (ms) | 96,84 / 126,92 | 101,13 / 141,27 |
| Montage Three CPU (ms) | 2,53 / 5,12 | 2,73 / 5,97 |
| Montage Rapier CPU (ms) | 12,73 / 22,01 | 13,62 / 18,64 |
| Triangles | 13 251 / 18 416 | 13 197 / 18 206 |
| Octets des buffers | 1 692 372 / 2 387 880 | 1 685 244 / 2 360 160 |
| Lots du montage complet | 10 / 11 | 10 / 11 |
| Colliders | 982 / 1 249 | 983 / 1 251 |

La correction ajoute environ 10,50 ms à la génération médiane et 4,29 ms à la
préparation médiane dans le worker. La hausse du P95 de génération reste visible
dans cette mesure ; aucune absence universelle de lag n'est revendiquée. Les
recherches utilisent des index locaux et un chemin direct lorsque le sol
appartient entièrement à une pièce non ambiguë. Aucun travail n'est ajouté par
frame ; lots et volume de triangles n'augmentent pas. Ce sont des mesures CPU,
sans upload GPU, compilation des shaders ni FPS réels.

## Reproduction

```sh
npx vitest run src/world/WallJunctions.test.ts src/world/SpatialBaseboards.test.ts src/world/SpatialFinishesPhysical.test.ts --maxWorkers=2
node scripts/audit-wall-finishes.mjs /chemin/vers/33f73c2
node scripts/benchmark-streaming.mjs /chemin/vers/33f73c2
node scripts/benchmark-streaming.mjs
```

Données : [couverture avant/après](wall-finishes-current.json),
[coût avant](wall-finishes-current-before.json),
[coût après](wall-finishes-current-after.json),
[préservation](wall-finishes-preservation-current.json),
[identité après optimisation](wall-finishes-optimization-current.json),
[résumé des contrôles](wall-finishes-checks-current.json).

## Publication

Version **22** publiée : https://backrooms-integre.teddykoeh.chatgpt.site.
La source hébergée est `b1921322189823af850e195d6ed5a607d07c51e8`.
Le transfert de l'archive locale a expiré après 300 s, sans créer de version.
Après vérification de l'historique, la publication depuis cette même source a
réussi. La version sauvegardée possède son archive de 3 076 fichiers ; ses
identifiants et les deux provenances d'archive figurent dans
[deployment-v22.json](deployment-v22.json). L'accès existant est conservé.

## Limite visuelle

L'aperçu géré et son statut signalent `sites-previewd mailbox is unavailable at
/tmp/sites-previewd/requests`. Aucun contrôle en jeu près des murs ou en mouvement
n'a pu être effectué. Les contrôles CPU de contours, UV, normales et triangles
ne remplacent pas une observation WebGL du clignotement, du bloom ou des FPS.
