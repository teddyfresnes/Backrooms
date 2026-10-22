# Génération du monde

## Points d’entrée

- `src/world/types.ts` : contrat `WorldPlan` et types de features.
- `src/world/SeededRandom.ts` : unique source de hasard.
- `src/world/generateWorld.ts` : plan local fini de 112 m.
- `src/world/InfiniteWorld.ts` : adaptation du plan en chunk infini.
- `src/world/EpicStructures.ts` : pavage et contrat des monuments `epic1` à `epic5`.
- `src/world/StairLayout.ts` : géométrie partagée des escaliers.
- `src/world/FeatureRegistry.ts` : proposition de features enregistrées.
- `src/world/PropPlacement.ts` : props rares, après la topologie finale.

Dans les gros fichiers, chercher le symbole concerné et la fin du pipeline :

```powershell
rg -n "export const generateWorld|validateWorldPlan|fingerprintWorld" src/world/generateWorld.ts
rg -n "export const generateInfiniteChunk|prefixPlanIds|emitBoundary" src/world/InfiniteWorld.ts
```

## Ordre du pipeline

Le pipeline ordinaire (plan version 15, topologie/spatial version 2) est :

1. `RegionalPlan` choisit les districts mondiaux et leurs datums signés ;
2. il réserve les atria sur deux à quatre adresses verticales. Les galeries
   classiques gardent leur phase historique ; les salles en gradins ont une
   phase de six adresses pour accueillir trois ou quatre niveaux sans chevauchement ;
3. `RegionalPlan.hasRegionalTransition` sélectionne les raccords isolés entre
   datums différents (au plus un par cellule, centres espacés d’au moins 49 m).
   `SpatialConnectors` et `TransitionLayout` déduisent les chambres, parcours,
   toits et paliers stables ; `SpatialFeatures` réserve les anciens trous et
   passages, avec leurs vrais propriétaires source/arrivée ;
4. `SpatialWorld` réutilise `generateBspArchitecture` sur des domaines canoniques
   de 224 m (2×2 chunks), puis matérialise aux datums finaux les pièces historiques,
   murs épais, détails et plafonds ; les grandes familles restent minoritaires ;
5. `SpatialRelief` ajoute les socles et terrasses pleins au sol porteur ;
6. `BspConnectivity` ouvre les partitions ordinaires qui isolent une poche après
   découpe ; le graphe distingue les portes à ouvrir (`requiresDoorId`), les vues
   et les chutes. Les petits rectangles de dallage ne sont pas des obstacles.
   `StructuralSupports` réconcilie ensuite les coques et linteaux avec leurs
   vrais appuis après les réservations et portes ;
7. `generateInfiniteChunk` applique palette et props, préfixe les IDs et références.

Voir [les contrats de transition](../TRANSITION_INTEGRATION.md) pour les plafonds
continus, les salles de plusieurs cellules et la conservation des anciennes features.
`AtriumEnvelope` partage les retraits successifs, passages et soubassements entre
tous les propriétaires. `SteppedAtrium` matérialise les galeries intermédiaires
et leurs chutes dirigées. Les parois des galeries classiques descendent aussi
jusqu’au vrai bas ; les ouvertures sont soustraites en volume.

La génération ne lit jamais un voisin déjà produit. Les interfaces viennent des
mêmes cellules mondiales des deux côtés. Le pas d’adresse 5,4 m est une translation
entre propriétaires ; les sols locaux suivent les datums régionaux, pas zéro.

`generateLegacyWorld` et `generateLegacyInfiniteChunk` conservent le pipeline complet et les
contrats des monuments et de `RAW_LOCAL_`. `structuralOnly` utilise ce pipeline
pour les résumés historiques. Ses règles de raised-zone, coques hautes et previews
ci-dessous restent propres à ce chemin. Les tests BSP l’appellent explicitement ;
ils ne mesurent pas la distribution ordinaire actuelle. `RegionalBsp.test.ts`
contrôle cette dernière, y compris les épaisseurs, les continuations de pièces
et la connexion des sols aux vraies circulations. Le cache de 32 domaines BSP
est vidé avec `clearInfiniteWorldCaches`.

Les biomes visuels occupent des macro-zones 2×2 stables sur tous les étages.
Le jaune ordinaire couvre 70 % des macro-zones ; rouge, blanc et jaune sombre
en couvrent chacun 10 %. Le jaune sombre conserve les textures et couleurs de
néons jaunes : seul son profil d’éclairage moderne est plus faible.

## Invariants

### Déterminisme

- Utiliser `rootRng.fork('nom-stable')` par décision indépendante.
- Éviter de réutiliser un même flux RNG dans deux systèmes sans rapport :
  l’ajout d’un tirage déplacerait tous les résultats suivants.
- Une modification volontaire de l’algorithme global peut nécessiter une hausse
  de `GENERATOR_VERSION`.
- `fingerprintWorld()` et les tests multi-seeds détectent les dérives.

### Cohérence physique

- Un mur avec collision doit avoir un collider correspondant.
- `cleanWallJunctions` précède les coques hautes/basses : raccords en L fermés,
  faces alignées lorsque l'écart ne fait que quelques centimètres, suppression
  des fragments et pilastres presque enfouis. Leurs colliders suivent exactement
  les nouvelles dimensions. Les petites irrégularités restent rares et déterministes
  (2,5 %), sans toucher aux monuments, limites de chunks, portes ou détails dédiés.
- Une ouverture de sol ne doit conserver aucun collider de sol en dessous.
- `floorRects` décrit le sol effectivement rendu et praticable.
- Les rampes et marches ont une géométrie visuelle et des formes Rapier issues
  des mêmes dimensions.
- Les sols ordinaires viennent de `WalkableTopology.ts`, sans doublon à Y=0.
  `floorY` est un datum ; `ceilingHeight` reste une altitude absolue locale.
  Voir [le contrat vertical](../VERTICAL_TOPOLOGY.md) pour couches, profils,
  volumes, budgets, priorités régionales, migrations et tests physiques.
- Une coque de plafond haut rejoint exactement le sommet du mur bas. Un linteau
  de portail garde le dégagement du profil desservi et le rendu soustrait son empreinte
  du plafond voisin. Sa sous-face suit le dégagement du sol desservi : elle
  continue le plafond si au moins une pièce adjacente est basse, mais emploie le
  papier peint si les deux pièces ont un plafond haut. Si le wrapper rabaisse ensuite
  la pièce à cause d’une ouverture verticale ou d’une façade incomplète, il
  supprime aussi chaque fragment de `upper-shell` / `upper-portal-lintel` qui ne
  borde plus aucune pièce haute. Dans le générateur fini, la coque est redécoupée
  contre les murs finaux : toute portée devenue libre après les dégagements de
  portail doit être un linteau, jamais un `upper-shell` flottant.
- Après mutation de murs ou de zones verticales, appeler le helper de
  reconstruction prévu au bon endroit plutôt que patcher un seul tableau.
- Le dégagement d’arrivée d’une ouverture de plafond s’applique après les
  escaliers hérités et murs de bordure, afin qu’aucune géométrie
  ajoutée tardivement ne puisse reboucher partiellement le passage. Les chunks
  monumentaux conservent leur propre contrat vertical et ne sont pas retaillés.
- Une `interactive-door` remplace un vrai segment de mur par deux jambages et
  un linteau. Son collider représente l’état fermé : les audits de topologie
  permanente doivent l’ignorer, puis le runtime le désactive pendant l’ouverture.
- Un `wall-breach` conserve deux profils : `projecting` pour l’ancien tunnel
  court et `flush` pour une ouverture directement découpée dans la cloison.
  Les passages `flush` sérialisent leur empreinte réelle dans `passageRects` ;
  `bounds` n’est que leur rectangle englobant et ne doit pas servir à remplir
  les coins vides d’un coude ou d’un embranchement. Certaines ouvertures
  `flush` atteignent 3,2 m de large. Lorsqu’elles terminent sur un `PassageHole`,
  leur plafond descend systématiquement à hauteur d’accroupissement avant le
  puits ; une partie des variantes larges force cette terminaison.
- Les trous terminaux d’un cul-de-sac `flush` occupent toute la largeur du
  passage. Leurs colliders doivent être ajoutés au plan mutable, avant
  l’affectation finale de `world.colliders`.

### Topologie verticale

- Taille de chunk : `INFINITE_CHUNK_SIZE = 112`.
- Pas d’adresse : `INFINITE_STORY_PITCH = 5.4`, sans datum de sol implicite.
- `spatial.owner` possède ses données, pas tous les volumes de sa colonne. Un
  atrium traverse trois adresses ; son bas est un vrai plan `lower-maze`.
- `spatial.dependencies` désigne les propriétaires réels à charger. Les anciennes
  previews ci-dessous concernent uniquement le pipeline legacy des monuments.
- `floorOpenings`, `ceilingOpenings`, `lowerPreviewOpenings` et
  `stairCeilingOpenings` ont des rôles distincts ; ne pas les fusionner.
- `StairSocketFeature.layout` choisit une volée `straight` ou un demi-tour
  `switchback`; ce dernier utilise `switchbackJoin` (`joined` ou `divider`).
  `StairLayout.ts` reste la source commune du rendu et des colliders.
- Les `PassageHole` des passages accroupis sont de vrais puits : `drop`
  rejoint le palier de l’étage inférieur et `void` propage son ouverture comme
  un puits profond. Leur aperçu local vient de `PassageHoleLayout.ts`.
- Les ouvertures héritées sont dérivées de chunks canoniques voisins. Tester au
  moins une paire d’étages, pas uniquement un plan isolé.
- Une gaine profonde ne doit rester exposée que dans son étage source et son
  étage d’arrivée. Dans chaque étage seulement traversé, ses ouvertures actives
  sont regroupées dans un enclos fermé, ancré à deux limites d’une salle dès
  que la trame intermédiaire le permet. Toutes les ouvertures d’un même
  `grid-pit` partagent une destination : 1 à 5 étages plus bas, ou un vide
  mortel. Leur motif emploie une grille complète, symétrique et de taille
  homogène dans la salle.
- Le pavage épique utilise des supercellules 32×32 dépendantes du seed. Chacune
  contient exactement `epic1`, `epic2`, `epic3`, `epic4` et `epic5`, soit
  5 chunks monumentaux sur 1024. Les huit slots candidats, leurs transformations
  et leur marge garantissent qu’aucun epic ne touche un autre, même en diagonale
  ou sur une couture de supercellule.
- Le slot horizontal ne dépend pas de l’étage : les grands volumes restent
  cohérents verticalement. Dans `epic1`, chaque story absolue dérive toutefois
  sa propre rangée de passages. Le plan sérialise quatre rangées au-dessus et
  dix-sept en dessous ; chaque rangée à ±5,4 m doit être identique au plan
  réellement monté lors du hand-off vers cette story.
- `epic1.voidBounds` couvre un peu plus de 90 % du chunk. Sa
  `passageFacadeBounds`, légèrement plus grande, porte les ouvertures ; l’espace
  entre les deux forme la corniche continue sur laquelle une chute peut
  atterrir. `funnelStoryOffset` ancre le profil sur la story logique absolue :
  l'aperçu à ±5,4 m et le chunk monté après hand-off gardent donc exactement la
  même section. `getEpic1FunnelStoryBounds` réduit progressivement la façade,
  la corniche et le vide des rangées inférieures. La corniche suivante dépasse
  encore légèrement le mur de soutien de la rangée précédente ; la dernière
  rangée ne reçoit aucun cap et conserve donc le trou. Sur l’étage inférieur
  préchargé, corniche, façade, couloirs et premier mur de soutien publient des
  colliders cohérents avec ce profil.
- Sur l’étage actif d’`epic1`, `getEpicAbyssThroughPassageLayout` prolonge chaque
  entrée jusqu’à une porte canonique identique dans le chunk voisin. Ces
  passages utilisent la hauteur de bureau partagée `EPIC1_PORTAL_HEIGHT`
  (2,66 m), y compris pour les murs et plafonds physiques. Les rares
  entrées proches prévisualisées utilisent `getEpicAbyssRoomPreviewLayout` pour
  montrer une petite pièce fermée ; les entrées lointaines restent de simples
  panneaux en retrait. La couronne s’arrête à `passageFacadeBounds` ; au niveau
  actif, seuls les vrais couloirs la prolongent jusqu’aux bords du chunk, et sur
  les niveaux prévisualisés seuls les aperçus détaillés reçoivent un sol.
- `epic3` est une faille longue de 220 m : `passageFacadeBounds` place deux
  façades intérieures symétriques et `voidBounds` les rejoint, sans corniche
  longitudinale ni rebord aux extrémités. Derrière chaque façade,
  `getEpic3BackroomsGalleryLayout` construit une galerie commune de 8,5 m de
  profondeur. Toutes les entrées d’une rangée partagent son sol praticable ;
  les cloisons intermédiaires laissent une voie continue près de la façade.
  L’étage zéro et l’étage d’arrivée publient les mêmes sols et murs dans les
  colliders. Les luminaires de ces deux rangées sont obligatoirement hors de
  `voidBounds` et utilisent le plafond de galerie à 3,35 m.
- `epic4` dérive ses volées, paliers, ouverture sommitale et petit labyrinthe
  supérieur de `getEpicStairwellLayout`; le rendu et Rapier consomment ce même
  tracé. `applyEpicStructure` conserve le labyrinthe ordinaire hors de la zone
  d’approche et garde un sol de chunk continu autour de cette tour compacte.
- `epic5` construit ses longues cloisons et leurs linteaux avec
  `getEpicConcourseWalls`. Ces `WallSegment` standards alimentent directement le
  rendu zonal et les colliders ; ne pas recréer une seconde géométrie
  décorative indépendante.

### Identifiants et sérialisation

- Les IDs locaux doivent être uniques et stables.
- `prefixPlanIds()` doit préfixer chaque nouvel ID et toute référence vers un ID.
- Pour une porte, cela inclut `sourceRoomId`, `targetRoomId` et `colliderId`.
- Les métadonnées stockées en `WeakMap` disparaissent lors du passage worker.
  Toute donnée nécessaire au rendu après clonage structuré doit aussi être
  sérialisée dans `WorldPlan`.

## Où modifier selon le besoin

| Besoin | Commencer par |
|---|---|
| Nouvelle donnée ou feature | `types.ts`, puis `docs/ADDING_FEATURES.md` |
| Forme des salles/portes | `SpatialWorld.ts`, `generateBspArchitecture` et `BspConnectivity.ts` |
| Frontières entre chunks | `RegionalPlan.ts`, `getCanonicalEdgeGates`, `SpatialWorld.ts` |
| Puits ou étages | `generateWorld.ts`, `InfiniteWorld.ts`, `StairLayout.ts` |
| Monument `epicN` | `EpicStructures.ts`, puis `WorldBuilder.ts` et `WorldStream.ts` |
| Biome/topologie régionale | `getInfiniteBiome()` / `applyBiome()` |
| Palette de surfaces | `getInfiniteVisualBiome()` / `applyVisualBiome()` ; palette et `surfaceStyle` restent stables dans une même colonne verticale |
| Props | `PropCatalog.ts` et `PropPlacement.ts`, après topologie héritée ; réserver les scènes aux grandes salles |

## Validation minimale

- Génération locale : `npx vitest run src/world/generateWorld.test.ts`
- Contrats de chunks/étages : `npx vitest run src/world/InfiniteWorld.test.ts`
- Props : `npx vitest run src/world/PropPlacement.test.ts`
- Toute modification de type : ajouter `npm run build`

Ces suites auditent beaucoup de seeds et peuvent être lentes. Utiliser
temporairement `-t "nom exact du test"` pendant l’itération, puis exécuter le
fichier complet avant la livraison.
