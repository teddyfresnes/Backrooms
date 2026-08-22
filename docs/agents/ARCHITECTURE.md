# Architecture utile aux modifications

Lire ce document uniquement pour une tâche transversale. Pour un problème
localisé, utiliser directement le guide de sous-système indiqué dans
`AGENTS.md`.

## Flux d’exécution

```text
src/main.ts
  ├─ joue l'introduction d'ouverture pendant le chargement du fond de menu
  ├─ monte un Game Level 0 neuf comme fond non jouable du menu principal
  ├─ Continuer choisit la session locale la plus récente, ou un nouveau départ
  ├─ import dynamique de RussianStairwellGame
      ├─ StairwellEnvironment + ImportedApartmentEnvironment
      ├─ PhysicsWorld (plan statique + trimesh de l’appartement)
      ├─ PlayerController + porte, verrou, interrupteur et stores interactifs
      ├─ SaveHistory (niveau, pose, porte/verrou, lumière, stores et temps de jeu)
      └─ HallExitInteraction -- E sur la porte du RDC ─┐
                                                       ↓
  └─ import dynamique de Game (labyrinthe procédural précédent)
      └─ SaveHistory (seed, chunk, pose et temps de jeu)

Runtime procédural conservé :
  Game
      ├─ génère le chunk origine et valide son WorldPlan
      ├─ charge MaterialLibrary et crée PhysicsWorld
      ├─ initialise WorldStream
      │   ├─ génère/prépare les chunks avec infinite.worker.ts
      │   ├─ monte un WorldView par chunk
      │   └─ ajoute/retire les colliders du même chunk
      ├─ pilote PlayerController à pas fixe (60 Hz)
      └─ présente la scène via PostFX à chaque frame
```

Le runtime procédural Level 0 sert toujours de fond au lancement et au retour au
menu principal. Il ne devient pas jouable depuis ce menu : **Continuer** restaure
la dernière entrée (ou crée un hall neuf) et **Nouvelle partie** crée toujours un
hall neuf. Les deux runtimes utilisent le même `ExperienceUI`, toujours présenté
comme le menu Backrooms. La scène russe
reste finie et statique : ne pas la faire passer par `WorldStream`, dont les
coordonnées de chunks et d’étages appartiennent au monde procédural. `src/main.ts`
détruit ce runtime avant d’instancier `Game` lorsque la porte-portail du hall est
activée.

Au premier chargement de la page, `OpeningIntro` joue au-dessus de `#app`
pendant que le fond Level 0 s'initialise. Sa durée minimale et le chargement du
runtime se rejoignent avant que le logo animé converge vers le menu. Les retours
ultérieurs au menu principal ne rejouent pas cette introduction.

Une session jouable masque l’overlay avant de demander le verrouillage de souris :
le refus asynchrone du navigateur ne doit jamais rouvrir le menu de pause. Le
canvas permet ensuite de redemander le verrouillage sur un clic utilisateur.
Le routeur conserve l’écran de chargement jusqu’à la compilation, au warmup et
au décodage de tous les sons du runtime. `initialize(onProgress)` combine la
progression visuelle et audio ; l’entrée directe masque le menu sans transition
avant que cet écran soit retiré, afin qu’aucune frame du menu ne fuite en jeu.
Le contrat central du labyrinthe reste `WorldPlan` dans `src/world/types.ts` ;
la génération ne crée que des données et le rendu et la physique les consomment
séparément.

## Responsabilités

| Zone | Responsabilité | Points d’entrée |
|---|---|---|
| `src/core` | lancement, historique de sauvegarde, boucles et streaming | `RussianStairwellGame`, `SaveHistory`, `Game`, `WorldStream` |
| `src/stairwell` | scène statique, matériaux et météo russe | `StairwellEnvironment`, `createStairwellPlan` |
| `src/apartment` | appartement importé et porte persistante | `ImportedApartmentEnvironment`, `ImportedApartmentDoorInteraction` |
| `src/world` | plan déterministe, topologie, chunks, props | `generateWorld`, `generateInfiniteChunk` |
| `src/render` | géométrie Three.js, matériaux, lumière, post-FX | `WorldView`, `MaterialLibrary`, `ZonalLighting`, `PostFX` |
| `src/physics` | personnage Rapier et colliders par chunk | `PhysicsWorld` |
| `src/player` | entrée FPS, déplacement, chute, noclip | `PlayerController` |
| `src/ui` | démarrage, menus, réglages persistants, console et diagnostic | `ExperienceUI` |
| `src/audio` | ambiance et retours de déplacement | `AudioSystem` |

## Deux espaces de coordonnées

- Le contenu d’un `WorldPlan` est local à son chunk.
- `getChunkWorldOffset()` transforme `(x, z, story)` en position monde.
- `WorldStream.mountChunk()` applique cet offset au groupe Three.js et aux
  colliders Rapier.
- Les requêtes runtime (`findRoomAt`, interactions, lumières) reconvertissent la
  position du joueur en coordonnées locales du chunk.

Éviter d’inscrire des offsets globaux dans le plan : cela produit généralement
des collisions ou interactions décalées deux fois.

## Changements qui traversent plusieurs couches

Une nouvelle géométrie jouable implique généralement :

1. type et données dans `src/world/types.ts` ;
2. émission déterministe dans `generateWorld.ts` ou `InfiniteWorld.ts` ;
3. représentation visuelle dans `WorldBuilder.ts` ;
4. `floorRects`, ouvertures et/ou `colliders` cohérents ;
5. préfixage des IDs dans `prefixPlanIds()` si nécessaire ;
6. validation pure, test de rendu et test physique selon le cas.

Une nouvelle prop implique plutôt `PropCatalog.ts` → `PropPlacement.ts` →
`WorldProps.ts`, plus la licence dans `public/assets/licenses.json`.

Une modification de streaming implique souvent `InfiniteWorld.ts`,
`infinite.worker.ts`, `WorldStream.ts` et `PhysicsWorld.ts`. Le worker renvoie
uniquement le plan sérialisable ; le champ lumineux zonal est créé au montage.

## Propriété et nettoyage

- `RussianStairwellGame` possède sa scène, le joueur, la physique, l’appartement,
  la porte, le post-traitement et l’UI ; il les détruit tous dans `dispose()` avant de recréer une
  session.
- `Game` possède les grands systèmes du runtime procédural et les détruit dans
  `dispose()`.
- `WorldStream` possède les `WorldView` montés et leurs entrées physiques.
- `WorldView` possède sa géométrie, ses matériaux zonaux clonés, textures
  générées et couche de props.
- Les matériaux partagés de `MaterialLibrary` restent la propriété de la
  bibliothèque ; ne pas les détruire depuis un chunk.

Lors d’un ajout runtime, identifier le propriétaire avant de coder. Un objet sans
propriétaire clair finit souvent dupliqué à chaque changement de chunk.

## Diagnostic rapide

- Monde invalide dès le démarrage : `generateWorld` / `validateWorldPlan`.
- Résultat différent entre worker et thread principal : donnée non sérialisable,
  métadonnée `WeakMap` non recopiée, ou hasard non déterministe.
- Visuel correct mais collision fausse : vérifier `WorldPlan.colliders` et
  l’offset passé à `PhysicsWorld.addChunk`.
- Correct dans le chunk origine mais faux chez un voisin : vérifier les
  transformations et préfixages d’`InfiniteWorld`.
- Correct après chargement mais fuite/stutter après déplacement : vérifier
  montage, démontage et `dispose()`.

