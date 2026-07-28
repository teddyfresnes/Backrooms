# Guide des agents

Ce fichier est un **routeur de contexte**. Le lire en entier, puis n’ouvrir que la
sous-documentation correspondant à la tâche. Ne pas charger tous les documents
« au cas où ».

## Démarrage économique

1. Vérifier `git status --short` et préserver toutes les modifications existantes.
2. Repérer les symboles avec `rg -n` avant d’ouvrir du code.
3. Lire des plages ciblées dans les gros fichiers, pas le fichier entier.
4. Utiliser les tests proches comme spécification exécutable.
5. Lancer d’abord le test le plus ciblé, puis élargir selon le risque.

Fichiers particulièrement longs :

- `src/world/generateWorld.ts`
- `src/render/WorldBuilder.ts`
- `src/world/InfiniteWorld.ts`
- leurs gros fichiers de tests

Ne pas inventorier `public/assets/`. Pour les objets, commencer par
`src/world/PropCatalog.ts`, `src/world/PropPlacement.ts` et
`public/assets/licenses.json`.

## Projet en 30 secondes

Application Vite/TypeScript en vue FPS, avec Three.js pour le rendu et Rapier
pour la physique. Le monde est déterministe à partir d’un seed. Chaque chunk
mesure 112 m, chaque étage logique 5,4 m, et `WorldStream` maintient un voisinage
horizontal 3×3.

Flux principal :

```text
main → Game → generateInfiniteChunk → WorldPlan
                         ↓
       WorldStream → WorldView + PhysicsWorld
                         ↓
               PlayerController → PostFX
```

Commandes :

```powershell
npm run dev
npm test
npm run build
npm run validate
```

`npm run validate` exécute toute la suite puis le build ; ne pas le lancer
automatiquement après une petite modification locale si un test ciblé et le
build couvrent déjà le risque.

## Documentation à charger selon la tâche

| Tâche | Lire |
|---|---|
| Comprendre le flux global ou modifier plusieurs sous-systèmes | `docs/agents/ARCHITECTURE.md` |
| Génération, seed, features, chunks, biomes, étages, ouvertures | `docs/agents/WORLD_GENERATION.md` |
| Rendu, streaming, lumière, props, physique ou cycle de vie | `docs/agents/RUNTIME_RENDERING.md` |
| Choisir les tests et le niveau de validation | `docs/agents/VERIFICATION.md` |
| Ajouter une feature architecturale | `docs/ADDING_FEATURES.md`, puis `docs/agents/WORLD_GENERATION.md` |

## Contrats à ne pas casser

- `WorldPlan` reste sérialisable : aucune instance Three.js, Rapier, fonction,
  map ou set dans les données transmises au worker.
- Toute génération aléatoire passe par `SeededRandom` et des forks nommés ;
  jamais `Math.random()`.
- Rendu, sol praticable, ouvertures et colliders doivent raconter la même
  géométrie.
- Les plans de chunks utilisent des coordonnées locales. L’offset monde est
  appliqué au montage par `WorldStream`.
- Les identifiants d’un chunk sont préfixés dans `InfiniteWorld`; mettre à jour
  les références croisées quand un nouveau champ contient des IDs.
- Tout objet GPU, écouteur, worker ou collider créé doit avoir un chemin de
  nettoyage dans `dispose()` ou au démontage du chunk.

## Entretien documentaire léger

Mettre à jour la documentation seulement si une modification change :

- une commande, une dépendance ou un point d’entrée ;
- un contrat de données, une responsabilité de module ou un flux entre modules ;
- un invariant subtil qui ferait probablement répéter une erreur ;
- la méthode de validation attendue.

Ne pas documenter chaque refactor, constante ou helper. Ne pas tenir de journal
de session. Préférer corriger un paragraphe existant plutôt qu’ajouter une
nouvelle section.

Garder `AGENTS.md` sous environ 120 lignes et chaque sous-document sous environ
200 lignes. Si un document approche 250 lignes ou mélange plusieurs sujets,
le remplacer par un index court et des documents spécialisés. Supprimer les
informations devenues fausses au lieu d’empiler des correctifs historiques.

