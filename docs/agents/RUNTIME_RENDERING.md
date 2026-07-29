# Runtime, rendu et physique

## Streaming

`WorldStream` maintient les chunks actifs, les `WorldView` et les colliders
associés. Le voisinage normal est un 3×3 sur l’étage courant.

- Au démarrage, jusqu’à trois workers temporaires préparent les voisins.
- Ensuite, un worker persistant génère un chunk à la fois.
- Les destinations verticales sont préchargées près des puits et escaliers.
- Une transition d’étage est différée tant que le chunk cible n’est pas prêt.
- Sans `Worker`, un fallback synchrone reste disponible.

Le worker (`src/world/infinite.worker.ts`) calcule à la fois le `WorldPlan` et les
pixels de lightmap. `WorldStream.mountChunk()` applique l’offset monde au groupe
Three.js et au lot de colliders. Le démontage doit retirer les deux.

## Construction visuelle

`WorldView` dans `src/render/WorldBuilder.ts` consomme un plan local :

- géométries statiques fusionnées par matériau ;
- éléments répétitifs en `InstancedMesh` ;
- lightmaps de plafond et générales produites par `BakedLighting.ts` ;
- graffitis procéduraux via `WallGraffiti.ts` ;
- portes de bureau articulées via `WorldDoors.ts` ;
- props asynchrones via `WorldProps.ts`.

Chercher la méthode `build…` correspondant à la feature. Ne pas lire tout
`WorldBuilder.ts`. Les helpers du début du fichier gèrent notamment les caps, la
soustraction de rectangles et les réparations de jonction.

### Règles de rendu

- Préférer une géométrie fusionnée ou instanciée à un `Mesh` par module.
- Réutiliser les `MaterialSet`; cloner seulement pour une variation réellement
  propre au chunk ou à la feature.
- Appeler `ensureBakedLightUv()` pour une géométrie utilisant les matériaux
  éclairés.
- Les plafonds et sols troués doivent être construits par soustraction de
  rectangles, sans faces coplanaires de réparation qui se chevauchent.
- Une géométrie visible depuis un étage voisin doit avoir les faces/caps
  nécessaires ; ne pas compter uniquement sur le back-face culling.
- Toute nouvelle ressource détenue par `WorldView` doit être libérée dans
  `dispose()`.

## Lumière

`LightSlot` est une donnée de génération, pas une lumière Three.js. Le baker
calcule un champ stable par chunk avant le montage. Les champs général et plafond
sont séparés parce que les occluders pertinents ne sont pas identiques.

Dans le streaming courant, `WorldView` est créé avec `createLightRig: false` :
l’éclairage principal est baked. Ne pas ajouter de nombreuses lumières
dynamiques pour corriger un problème de lightmap.

Les coordonnées de `LightSlot.ceilingY` sont absolues dans le plan local ;
`WorldBuilder` applique ses petits offsets visuels une seule fois.

## Physique et joueur

`PhysicsWorld` possède un personnage cinématique Rapier et des lots de colliders
indexés par clé de chunk. Les mutations groupées passent par
`batchChunkChanges()` pour limiter les synchronisations.

Une porte interactive garde son collider fermé au début de l’animation.
`WorldDoorLayer` signale à `WorldStream` quand l’ouverture devient praticable,
puis `PhysicsWorld.setChunkColliderEnabled()` désactive uniquement ce collider.
La broad phase prend ce changement au tick fixe planifié suivant : ne pas forcer
un `world.step()` supplémentaire depuis la mise à jour d’interaction.
Un appui bref sur E ouvre vite ; un maintien d’une seconde ouvre en deux secondes.

`Game.frame()` :

1. borne le delta et exécute `PlayerController.fixedUpdate()` à 60 Hz ;
2. interpole la caméra avec `renderUpdate()` ;
3. met à jour le streaming et les interactions ;
4. adapte progressivement la résolution ;
5. rend via `PostFX`.

Ne pas déplacer la physique dans la mise à jour de rendu variable. Les rampes,
marches, accroupissement et transitions verticales sont sensibles à cette
séparation.

## Props et assets

- `PropCatalog.ts` décrit chemins, tailles, catégories et transformations.
- `PropPlacement.ts` sélectionne des placements déterministes et sûrs.
- `WorldProps.ts` charge, normalise, clone et détruit les modèles.
- Le catalogue runtime est volontairement resserré : ancres PBR Poly Haven,
  petit désordre Kenney seulement. Les sources sont servies depuis
  `public/assets/textures/{polyhaven,kenney}`.
- `WorldProps` met en cache le modèle normalisé et partage ses géométries entre
  instances ; seules les matières teintées appartiennent au chunk et sont
  détruites au démontage.
- `WorldView.ready` permet au chargement initial d’attendre les assets visibles.
- Toute ressource ajoutée doit être locale et déclarée dans
  `public/assets/licenses.json`.

## Diagnostic rapide

| Symptôme | Vérifier d’abord |
|---|---|
| Objet décalé dans les chunks voisins | offset appliqué deux fois ou coordonnées non locales |
| Collision fantôme après déplacement | `unmountChunk()` / propriété du collider |
| Trou noir ou face manquante vue d’en dessous | caps, normales et matériau du puits/plafond |
| Halo ou couture lumineuse | occluders et soustraction dans `BakedLighting.ts` |
| Stutter à l’approche d’un étage | file de préfetch et données worker sérialisées |
| Mémoire qui monte en explorant | `dispose()` du `WorldView`, des props et lightmaps |
| Prop dans un mur/trou | ordre de `populateRareProps()` et empreinte de placement |

## Tests associés

- rendu architectural : `src/render/WorldBuilder.test.ts`
- lumière baked : `src/render/BakedLighting.test.ts`
- graffiti : `src/render/WallGraffiti.test.ts`
- streaming : `src/core/WorldStream.test.ts`
- physique : `src/physics/PhysicsWorld.test.ts`
- déplacement : `src/player/PlayerController.test.ts`

Voir `docs/agents/VERIFICATION.md` avant de lancer plusieurs suites lourdes.
