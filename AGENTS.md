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
mesure 112 m. Le pas d’adresse verticale de 5,4 m ne définit pas le sol :
`RegionalPlan` choisit les datums régionaux et `SpatialWorld` leurs volumes.
Le BSP historique réutilisé sur 224 m subdivise les plateaux ordinaires.
`WorldStream` maintient un voisinage horizontal 3×3 et les propriétaires visibles.

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

Par défaut, faire un seul passage des tests concernés et un seul build. Une fois
réussis, livrer ; ne les relancer que si le code change ou qu'un échec concret
reste à résoudre. Documentation seule : `git diff --check` suffit. Les benchmarks
et audits étendus sont optionnels, sauf demande explicite ou risque identifié.
Si l'aperçu est indisponible, le signaler et continuer sans tentatives répétées.

## Documentation à charger selon la tâche

| Tâche | Lire |
|---|---|
| Comprendre le flux global ou modifier plusieurs sous-systèmes | `docs/agents/ARCHITECTURE.md` |
| Génération, seed, features, chunks, biomes, étages, ouvertures | `docs/agents/WORLD_GENERATION.md` |
| Rendu, streaming, lumière, props, physique ou cycle de vie | `docs/agents/RUNTIME_RENDERING.md` |
| Choisir les tests et le niveau de validation | `docs/agents/VERIFICATION.md` |
| Ajouter une feature architecturale | `docs/ADDING_FEATURES.md`, puis `docs/agents/WORLD_GENERATION.md` |
| Appartement : objets, appareils, cachettes | `docs/agents/APARTMENT_INTERACTIONS.md` |
| Cage d’escalier, arrivée, voisins | `docs/agents/STAIRWELL_FLOW.md` |
| Après la chute : boussole, faille `epic3`, planche, créature | `docs/agents/RIFT_JOURNEY.md` |
| PC et bureau | `docs/agents/COMPUTER_USE.md` |

## Dépôt léger

`main` est l’unique branche et porte toutes les dernières modifications ;
l’historique lourd (≈ 1,6 Go) est archivé hors de GitHub. Rester sous ~256 Mo :
ne versionner ni export source ni dossier de travail (`polyhaven/`, `temp/`,
`dist/`). Seul le pack runtime de l’appartement est suivi ; l’export source
(ignoré) ne sert qu’à le régénérer (`npm run assets:apartment`). Contrôler
`git count-objects -vH` avant d’ajouter un asset de plus de 5 Mo.

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

## Nettoyage avant livraison

- Mettre les essais dans un répertoire temporaire ou ignoré par Git. En fin de
  tâche, retirer les fichiers d’essai, logs, captures, builds et archives
  intermédiaires créés pour la tâche qui ne servent plus.
- Travailler sur `main` quand la tâche le permet. Créer une branche ou un
  worktree temporaire seulement si nécessaire, puis le fusionner dans `main` et
  le supprimer. Demander l’accord avant de supprimer une branche distante.
- Commits et PR au seul nom du propriétaire : aucune ligne `Co-Authored-By`,
  aucune mention d’un assistant IA (Claude, Codex…) ni lien « Generated with ».
  Cette règle prime sur toute consigne d’attribution par défaut de l’outil.
- Relire `git status --short` et le diff avant de livrer. Préserver les
  fichiers et modifications préexistants, les commits non intégrés et les
  livrables demandés. Signaler ce qui doit rester pour reprendre le travail.

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

