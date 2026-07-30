# Génération du monde

## Points d’entrée

- `src/world/types.ts` : contrat `WorldPlan` et types de features.
- `src/world/SeededRandom.ts` : unique source de hasard.
- `src/world/generateWorld.ts` : plan local fini de 112 m.
- `src/world/InfiniteWorld.ts` : adaptation du plan en chunk infini.
- `src/world/EpicStructures.ts` : pavage et contrat des monuments `epic1…epic8`.
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
5. remplace les résidus épiques par leur plan monumental canonique ;
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
- Après mutation de murs ou de zones verticales, appeler le helper de
  reconstruction prévu au bon endroit plutôt que patcher un seul tableau.
- Une `interactive-door` remplace un vrai segment de mur par deux jambages et
  un linteau. Son collider représente l’état fermé : les audits de topologie
  permanente doivent l’ignorer, puis le runtime le désactive pendant l’ouverture.

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
- Le pavage épique est horizontal et périodique modulo 3 : tout voisinage 3×3
  complet contient un chunk ordinaire et exactement `epic1…epic8`. Le résidu ne
  dépend pas de l’étage, afin que leurs volumes verticaux continuent pendant un
  changement de story. `epic1` publie son vide comme ouverture canonique à
  chaque étage.

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
| Palette de surfaces | `getInfiniteVisualBiome()` / `applyVisualBiome()` |
| Props | `PropCatalog.ts` et `PropPlacement.ts`, après topologie héritée ; réserver les scènes aux grandes salles |

## Validation minimale

- Génération locale : `npx vitest run src/world/generateWorld.test.ts`
- Contrats de chunks/étages : `npx vitest run src/world/InfiniteWorld.test.ts`
- Props : `npx vitest run src/world/PropPlacement.test.ts`
- Toute modification de type : ajouter `npm run build`

Ces suites auditent beaucoup de seeds et peuvent être lentes. Utiliser
temporairement `-t "nom exact du test"` pendant l’itération, puis exécuter le
fichier complet avant la livraison.
