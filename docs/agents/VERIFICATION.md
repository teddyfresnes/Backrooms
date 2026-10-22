# Vérification proportionnée

Le but est de trouver vite les erreurs sans exécuter toute la matrice à chaque
édition.

## Échelle de validation

1. Pendant l’itération, lancer un test par son nom :

   ```powershell
   npx vitest run src/world/InfiniteWorld.test.ts -t "préfixe du nom"
   ```

2. Avant livraison, lancer le fichier de test du sous-système :

   ```powershell
   npx vitest run src/core/WorldStream.test.ts
   ```

3. Lancer `npm run build` si TypeScript, imports, worker, assets ou rendu ont
   changé.
4. Lancer `npm run validate` pour une modification transversale, une évolution
   de contrat de `WorldPlan`, un changement de génération global ou une demande
   explicite de validation complète.

Les tests de génération auditent des centaines de plans et disposent d’un
timeout de 30 secondes par test. Une durée élevée n’indique pas à elle seule un
blocage.

## Matrice par changement

| Changement | Test ciblé | Complément |
|---|---|---|
| BSP, salles, murs, features | `generateWorld.test.ts` | `InfiniteWorld.test.ts` si chunk/vertical |
| Frontière, biome, étage, héritage | `InfiniteWorld.test.ts` | `WorldBuilder.test.ts` si visible |
| Sol, rampe, marche, collider | `PhysicsWorld.test.ts` | test génération + rendu concerné |
| Géométrie ou caps | `WorldBuilder.test.ts` | `npm run build` |
| Champ zonal/blackout | `ZonalLighting.test.ts` | `WorldBuilder.test.ts` si matériaux/géométrie |
| Mode classique / bake | `BakedLighting.test.ts` | `WorldBuilder.test.ts` + build |
| Streaming/offset/préfetch | `WorldStream.test.ts` | `InfiniteWorld.test.ts` |
| Contrôleur joueur | `PlayerController.test.ts` | `PhysicsWorld.test.ts` si collision |
| Personnage, Tab, caméra, ragdoll et relevés | `npm run test:character` | `CharacterEnvironment.test.ts`, puis les deux scènes |
| Props | `PropPlacement.test.ts` | build + contrôle visuel si nouvel asset |
| Qualité/post-FX | `AdaptiveQuality.test.ts` | contrôle visuel |
| UI/audio/styles | test disponible, sinon build | contrôle navigateur |
| Historique de sauvegarde | `SaveHistory.test.ts` | accueil sans/avec save + rechargement des deux runtimes |
| Escalier/appartement | tests `src/stairwell` et `src/apartment` | `PhysicsWorld.test.ts` + contrôle visuel |
| Porte du hall / route Backrooms | `HallExitInteraction.test.ts`, `ExperienceRouting.test.ts` | descente au RDC + interaction E |

`npm run validate` inclut les essais du personnage sur les véritables FBX,
avec Three.js, Rapier et un DOM hors écran. Seule la surface WebGL est absente ;
ces essais ne remplacent pas le contrôle visuel en navigateur.

## Contrôle navigateur

Pour un changement visuel ou d’interaction :

1. lancer `npm run dev` ;
2. ouvrir `http://127.0.0.1:4173/?seed=SEED-STABLE` ;
3. attendre que `window.__BACKROOMS__.ready` soit vrai ;
4. vérifier la console, le HUD et la zone modifiée ;
5. conserver le même seed pour comparer avant/après.

Partir sans stockage local et vérifier que **Continuer** ouvre un historique vide.
Lancer une partie, déplacer/orienter le joueur, ouvrir la porte et utiliser
**Sauvegarder** dans le menu de pause : la nouvelle ligne doit restaurer pose,
vue et porte. Masquer la page ou ouvrir la pause ne doit créer aucune autosave.
Franchir ensuite la porte du hall : une seule autosave **Niveau 0** doit apparaître
après le chargement. Corrompre une entrée pour confirmer qu’elle est ignorée sans
erreur console ni requête asset 404.

`window.__BACKROOMS__` expose le même snapshot structuré que `/logs` : session,
position et orientation joueur, chunk et génération courants, objet regardé,
performances, qualité, streaming et physique. Les alias historiques (`seed`,
`fps`, `drawCalls`, `chunks`…) restent disponibles à la racine. Utiliser
`/logs`, `/noclip` et `/locate` pour documenter ou atteindre une zone sans
modifier temporairement le code.

## Avant de conclure

- Relire `git diff --check`.
- Vérifier que seuls les fichiers attendus ont changé avec `git status --short`.
- Signaler clairement les tests exécutés et ceux qui ne l’ont pas été.
- Ne pas corriger ou reformater les modifications utilisateur hors périmètre.


Pour les changements de hauteur, `npm run test:vertical` couvre les plans
régionaux ordinaires, les parcours Three/Rapier, les ouvertures monumentales,
les deux modes de rendu, les sauvegardes et les cycles de montage/démontage.
`npm run audit:vertical` vérifie 128 seeds et huit voisinages de 5×5 chunks avec
des objectifs de distribution déclarés avant le relevé. Les anciens tests BSP
restent explicitement sur le générateur legacy utilisé par les monuments.
`RegionalBsp.test.ts` mesure le vrai chemin ordinaire et contrôle 32 seeds de
connectivité physique des surfaces, sans assimiler les noms de familles à des formes.
`RegionalLighting.test.ts` vérifie l’invariance par translation, plus de trois couches,
le transfert des buffers worker et le nettoyage des deux textures modernes.

`npm run benchmark:vertical` compare 24 seeds identiques : médiane/P95,
clonage, JSON, architecture Three, montage Rapier et mémoire JS.
`npm run benchmark:worker` mesure le même travail dans un worker Node avec
transfert réel par clonage structuré et bake classique. Ce proxy ne mesure pas
l’ordonnancement des Workers du navigateur. Aucun de ces benchmarks ne mesure
GPU ou draw calls. Exécuter les mesures avant/après sans charge concurrente.
Voir [TRANSITION_VALIDATION.md](../validation/TRANSITION_VALIDATION.md) pour v13
et [REGIONAL_VALIDATION.md](../REGIONAL_VALIDATION.md) pour la référence antérieure.

Les tests `TransitionLayout`, `TransitionMount`, `SpatialFeaturesPhysical`,
`ArchitecturalUV` et `ArchitectureDebug` protègent les transitions v13, les
trous réintégrés et les ressources des diagnostics. La séparation entre toit et
étage supérieur se mesure au même point horizontal, y compris sur un toit incliné.
`TransitionIsolation` et `PrismExposure` couvrent la sélection espacée v14,
la volée unique, les vrais appuis, les bandes verticales sans recouvrement,
le dégagement raycasté dans la géométrie finale et les coins des diffuseurs.
Le rapport [STAIR_FIX_VALIDATION.md](../validation/STAIR_FIX_VALIDATION.md)
distingue les contrôles CPU du contrôle visuel WebGL.
