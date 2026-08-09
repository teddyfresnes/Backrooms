# Architecture utile aux modifications

Lire ce document uniquement pour une tâche transversale. Pour un problème
localisé, utiliser directement le guide de sous-système indiqué dans
`AGENTS.md`.

## Flux d’exécution

```text
src/main.ts
  └─ Game
      ├─ génère le chunk origine et valide son WorldPlan
      ├─ charge MaterialLibrary et crée PhysicsWorld
      ├─ initialise WorldStream
      │   ├─ génère/prépare les chunks avec infinite.worker.ts
      │   ├─ monte un WorldView par chunk
      │   └─ ajoute/retire les colliders du même chunk
      ├─ pilote PlayerController à pas fixe (60 Hz)
      └─ présente la scène via PostFX à chaque frame
```

Le contrat central est `WorldPlan` dans `src/world/types.ts`. La génération ne
crée que des données. Le rendu et la physique consomment ces données séparément.

## Responsabilités

| Zone | Responsabilité | Points d’entrée |
|---|---|---|
| `src/core` | orchestration, boucle, streaming | `Game`, `WorldStream` |
| `src/world` | plan déterministe, topologie, chunks, props | `generateWorld`, `generateInfiniteChunk` |
| `src/render` | géométrie Three.js, matériaux, lumière, post-FX | `WorldView`, `MaterialLibrary`, `ZonalLighting` |
| `src/physics` | personnage Rapier et colliders par chunk | `PhysicsWorld` |
| `src/player` | entrée FPS, déplacement, chute, noclip | `PlayerController` |
| `src/ui` | chargement, HUD, console locale | `ExperienceUI` |
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

- `Game` possède les grands systèmes et les détruit dans `dispose()`.
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

