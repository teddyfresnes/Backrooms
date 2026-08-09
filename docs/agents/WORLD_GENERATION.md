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

`generateWorld(seed)` :

1. crée la coque, le BSP, les salles et les portails ;
2. choisit le spawn et réserve les salles incompatibles ;
3. ajoute features, variations de plafond, élévations et relief architectural ;
4. resynchronise murs et colliders après les transformations ;
5. classe les zones inaccessibles ;
6. reconstruit les extensions des zones en contrebas ;
7. place lumières et détails ;
8. calcule `floorOpenings`, `floorRects` et valide le plan.

L’ordre est une dépendance réelle. Un ajout qui occupe le sol doit arriver avant
les lumières et les props, ou déclencher explicitement leur recalcul.

`generateInfiniteChunk(seed, coord)` :

1. dérive un seed propre au chunk et appelle `generateWorld` ;
2. applique biome logique et biome visuel ;
3. réconcilie puits, escaliers et ouvertures avec les étages voisins ;
4. retire les landmarks réservés au monde fini ;
5. remplace les rares slots épiques par leur plan monumental canonique ;
6. recrée les limites et portes canoniques du chunk ;
7. reconstruit les extensions affectées, place les props rares hors monuments ;
8. préfixe les IDs et attache les métadonnées runtime.

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
- Une ouverture de sol ne doit conserver aucun collider de sol en dessous.
- `floorRects` décrit le sol effectivement rendu et praticable.
- Les rampes et marches ont une géométrie visuelle et des formes Rapier issues
  des mêmes dimensions.
- Une `raised-zone` réserve aussi ses `approachRoomIds` : chaque rampe doit
  traverser une pièce simple et large, sans plafond bas, carrefour ni relief
  architectural ajouté par une passe ultérieure.
- Une coque de plafond haut rejoint exactement le sommet du mur bas. Un linteau
  de portail commence légèrement au-dessus pour ne pas superposer sa sous-face
  au plafond bas voisin. Si le wrapper rabaisse ensuite la pièce à cause d’une
  ouverture verticale ou d’une façade incomplète, il supprime aussi chaque fragment de
  `upper-shell` / `upper-portal-lintel` qui ne borde plus aucune pièce haute.
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
  les coins vides d’un coude ou d’un embranchement.
- Les trous terminaux d’un cul-de-sac `flush` occupent toute la largeur du
  passage. Leurs colliders doivent être ajoutés au plan mutable, avant
  l’affectation finale de `world.colliders`.

### Topologie verticale

- Taille de chunk : `INFINITE_CHUNK_SIZE = 112`.
- Hauteur d’étage : `INFINITE_STORY_PITCH = 5.4`.
- Un chunk possède un étage canonique. Les volumes inférieurs visibles dans le
  même plan ne sont que des aperçus de transition.
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
  sont regroupées dans un enclos fermé, ancré à deux limites d’une salle ; les
  profondeurs différentes d’un même pit partagent cet invariant.
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
  atterrir. Seuls cette corniche, le court aperçu des couloirs et leurs murs ont
  des colliders sur l’étage inférieur préchargé.
- Sur l’étage actif d’`epic1`, `getEpicAbyssThroughPassageLayout` prolonge chaque
  entrée jusqu’à une porte canonique identique dans le chunk voisin. Les rares
  entrées proches prévisualisées utilisent `getEpicAbyssRoomPreviewLayout` pour
  montrer une petite pièce fermée ; les entrées lointaines restent de simples
  panneaux en retrait. La couronne s’arrête à `passageFacadeBounds` ; au niveau
  actif, seuls les vrais couloirs la prolongent jusqu’aux bords du chunk, et sur
  les niveaux prévisualisés seuls les aperçus détaillés reçoivent un sol.
- `epic3` est une faille longue de 220 m : `passageFacadeBounds` place deux
  façades intérieures symétriques et `voidBounds` les rejoint, sans corniche
  longitudinale ni rebord aux extrémités. Les seuls sols sont ceux des alcôves
  indépendantes derrière les portails. Chaque story réutilise le même gabarit
  face à face, y compris sous l’étage zéro ; `getEpic3PassagePreviewLayout`
  ferme chaque cul-de-sac, virage ou embranchement sans galerie commune.
- `epic4` dérive ses volées, paliers, ouverture sommitale et petit labyrinthe
  supérieur de `getEpicStairwellLayout`; le rendu et Rapier consomment ce même
  tracé. `applyEpicStructure` conserve le labyrinthe ordinaire hors de la zone
  d’approche et garde un sol de chunk continu autour de cette tour compacte.
- `epic5` construit ses longues cloisons et leurs linteaux avec
  `getEpicConcourseWalls`. Ces `WallSegment` standards alimentent directement le
  rendu, la lightmap et les colliders ; ne pas recréer une seconde géométrie
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
| Forme des salles/portes | `generateWorld.ts` près du BSP et des portails |
| Frontières entre chunks | portes canoniques et `emitBoundary()` dans `InfiniteWorld.ts` |
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
