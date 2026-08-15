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
| Props | `PropPlacement.test.ts` | build + contrôle visuel si nouvel asset |
| Qualité/post-FX | `AdaptiveQuality.test.ts` | contrôle visuel |
| UI/audio/styles | test disponible, sinon build | contrôle navigateur |
| Sauvegarde russe | `GameSave.test.ts` | accueil sans/avec save + rechargement |
| Escalier/appartement | tests `src/stairwell` et `src/apartment` | `PhysicsWorld.test.ts` + contrôle visuel |
| Porte du hall / route Backrooms | `HallExitInteraction.test.ts`, `ExperienceRouting.test.ts` | descente au RDC + interaction E |

## Contrôle navigateur

Pour un changement visuel ou d’interaction :

1. lancer `npm run dev` ;
2. ouvrir `http://127.0.0.1:4173/?seed=SEED-STABLE` ;
3. attendre que `window.__BACKROOMS__.ready` soit vrai ;
4. vérifier la console, le HUD et la zone modifiée ;
5. conserver le même seed pour comparer avant/après.

Pour Russian Stairwells, partir sans stockage local et vérifier que **Charger**
est désactivé. Lancer une partie, déplacer/orienter le joueur, ouvrir la porte,
revenir au menu ou masquer la page, puis recharger et choisir **Charger** : pose,
vue et porte doivent être restaurées. Corrompre ensuite le slot le plus récent
pour confirmer le repli sur le second sans erreur console ni requête asset 404.

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

