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
| Lightmap/occlusion | `BakedLighting.test.ts` | `WorldBuilder.test.ts` si UV/géométrie |
| Streaming/offset/préfetch | `WorldStream.test.ts` | `InfiniteWorld.test.ts` |
| Contrôleur joueur | `PlayerController.test.ts` | `PhysicsWorld.test.ts` si collision |
| Props | `PropPlacement.test.ts` | build + contrôle visuel si nouvel asset |
| Qualité/post-FX | `AdaptiveQuality.test.ts` | contrôle visuel |
| UI/audio/styles | test disponible, sinon build | contrôle navigateur |

## Contrôle navigateur

Pour un changement visuel ou d’interaction :

1. lancer `npm run dev` ;
2. ouvrir `http://127.0.0.1:4173/?seed=SEED-STABLE` ;
3. attendre que `window.__BACKROOMS__.ready` soit vrai ;
4. vérifier la console, le HUD et la zone modifiée ;
5. conserver le même seed pour comparer avant/après.

`window.__BACKROOMS__` expose notamment seed, fingerprint, position joueur, FPS,
draw calls, triangles, chunks et chargements en attente. Utiliser `/noclip` et
`/locate` pour atteindre une zone sans modifier temporairement le code.

## Avant de conclure

- Relire `git diff --check`.
- Vérifier que seuls les fichiers attendus ont changé avec `git status --short`.
- Signaler clairement les tests exécutés et ceux qui ne l’ont pas été.
- Ne pas corriger ou reformater les modifications utilisateur hors périmètre.

