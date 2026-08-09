# Runtime, rendu et physique

## Streaming

`WorldStream` maintient les chunks actifs, les `WorldView` et les colliders
associés. Le voisinage normal est un 3×3 sur l’étage courant.

- Au démarrage, jusqu’à trois workers temporaires préparent les voisins.
- Ensuite, un worker persistant génère un chunk à la fois.
- Les destinations verticales sont préchargées près des puits et escaliers.
- Les volumes hauts de `epic2`, `epic3`, `epic4` et `epic5` épinglent leur
  story source au lieu de remonter tous les 5,4 m. Le runtime source est résolu
  depuis la position du joueur, y compris juste après une téléportation haute.
- `epic3` dépasse son chunk propriétaire sur l’axe longitudinal. Tant que le
  joueur est dans son volume, le streamer garde ce propriétaire comme centre et
  exclut ses voisins en x, dont les murs ordinaires couperaient la faille.
- `epic1` n’est jamais épinglé : seule la story immédiatement inférieure est
  préchargée en priorité à l’approche du gouffre. Chaque story montée prépare la
  suivante, sans rafale de trois générations, puis utilise le même hand-off à
  mi-hauteur que les pits.
  Au démontage, le dernier palier sûr conserve seulement son plan et sa lightmap
  CPU ; le callback de chute le remonte immédiatement, sans régénération ni
  superposition des aperçus verticaux.
- Une transition d’étage est différée tant que le chunk cible n’est pas prêt.
- Sans `Worker`, un fallback synchrone reste disponible.

Le worker (`src/world/infinite.worker.ts`) calcule à la fois le `WorldPlan` et les
pixels de lightmap. `WorldStream.mountChunk()` applique l’offset monde au groupe
Three.js et au lot de colliders. Le démontage doit retirer les deux.

`/locate epic1`, `/locate epic2`, `/locate epic3`, `/locate epic4` et
`/locate epic5` résout analytiquement l’occurrence la plus proche, même hors du
voisinage monté. Un worker auxiliaire prépare le plan et la lightmap hors du
thread principal ; le chunk central, sa vue et ses colliders sont ensuite montés
avant la téléportation. Pour `epic1`, le voisin nord visible depuis le point
d’arrivée est monté dans le même warmup ; les autres voisins rejoignent le flux
normal du streamer.
Pour `epic3`, seuls les voisins nord et sud restent montés pendant la visite.

## Construction visuelle

`WorldView` dans `src/render/WorldBuilder.ts` consomme un plan local :

- géométries statiques fusionnées par matériau ;
- gaines profondes doublées de moquette à l’intérieur, mais enclos des étages
  traversés rendus avec le papier peint ordinaire pour rester architecturaux ;
- volumes monumentaux dérivés de `EpicStructureFeature`; leurs rangées de
  passages sérialisées construisent de vraies ouvertures, plateformes et
  previews de couloir, tandis que toute partie accessible partage ses mesures
  avec les colliders ;
- `epic1` rend quatre stories au-dessus et une profondeur finie de stories sous
  le joueur, puis masque leur terminaison par des couches de brume à bords
  fondus sans collision. L’étage actif ouvre ses couloirs jusqu’aux chunks
  voisins. Dans une fenêtre verticale de trois stories, seules quatre entrées
  latérales proches du point d’arrivée reçoivent une petite pièce, son plafond
  et un luminaire ; les autres sont des panneaux en retrait. Les faces basses
  des murs sont supprimées pour ne jamais se superposer à la corniche. Cette
  corniche s’arrête à la façade et seul un aperçu détaillé ajoute du sol derrière
  son ouverture. Les plafonds génériques de pit et de salle haute sont désactivés
  dans ce chunk : les rangées propres à `epic1` restent visibles vers le haut ;
- `epic3` construit les cellules de labyrinthe complètes près du point
  d’arrivée dans une fenêtre de quatre stories sous le joueur et trois stories
  au-dessus. Dans cette même fenêtre, les entrées latéralement plus éloignées
  montrent un vestibule court mais entièrement fermé (sol, plafond, côtés et
  fond). Hors de cette fenêtre, un panneau en retrait ferme toute la largeur de
  l’ouverture ; aucun trou ne doit révéler la coque extérieure. Aucun mesh de
  plateforme ne longe le vide. Deux nappes de brume séparées masquent le haut
  et le fond du gouffre ;
- `epic5` reste sur le chemin de rendu ordinaire des murs et du plafond. Ses
  luminaires ont tous `ceilingY` sur le plafond réel, sans panneau lumineux
  décoratif ou hauteur aléatoire supplémentaire ;
- les escaliers inter-étages rendent des contremarches minces et une sous-face
  inclinée texturée, jamais des marches remplies jusqu’au sol. Les murs d’une
  preview s’arrêtent à son vrai plafond ; la cage réelle habille seule le
  plénum, et les luminaires de preview doivent rester entièrement hors de
  l’ouverture ;
- plafonds bas des `squeeze-view` construits sur `passageRects` quand ce champ
  existe, afin qu’un passage en L ou en T ne couvre pas son rectangle englobant ;
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
- Les jupes latérales des rampes suivent la pente avec des rideaux verticaux,
  sans cap supérieur : le tapis déborde déjà sur la couture et deux surfaces à
  cet endroit provoquent du z-fighting.
- Les volées hautes d’`epic4` ajoutent une sous-face en papier peint non baked,
  décalée de 18 cm sous la pente. Leurs côtés sont de minces fascias suivant la
  pente, jamais des rideaux triangulaires descendant à la base de la volée. Un
  palier sépare obligatoirement sa moquette supérieure, sa tranche en papier
  peint et sa dalle de plafond inférieure ; un luminaire de palier s’attache à
  cette dalle et ne doit jamais apparaître sous une face en moquette.
- Tout plafond au-dessus de la ligne des murs utilise un matériau texturé sans
  fog, double face et légèrement émissif, sans réutiliser la lightmap 2D du
  plafond bas, pour ne pas se confondre avec le fond.
  Les plafonds de preview verticale modulent aussi leur émission avec la texture
  de dalles afin que le plafond reste lisible en regardant depuis l’étage bas.
  À partir de 18 m, la variante distante renforce ce traitement et réduit aussi
  l’échelle UV des dalles en fonction de la hauteur.
- Les fragments de coque haute gardent leurs faces d’extrémité : leur retrait
  produit des fentes verticales noires aux raccords. Leur base rejoint exactement
  le sommet du mur bas pour ne laisser aucune fente horizontale ; le plafond bas
  voisin se termine sur ce même plan et masque la jonction de son côté.
- La sous-face d’un `upper-portal-lintel` reste légèrement au-dessus du plafond
  bas : les deux plans ne doivent jamais être coplanaires, sinon leurs textures
  clignotent à la frontière entre salle haute et salle normale.
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
