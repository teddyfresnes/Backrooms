# Ajouter une feature architecturale

Ce guide décrit le chemin minimal. Lire aussi
`docs/agents/WORLD_GENERATION.md` pour les invariants de chunks et d’étages.

## 1. Définir un contrat de données

Ajouter une interface sérialisable dans `src/world/types.ts`, avec un
discriminant `kind`, puis l’inclure dans `WorldFeature`.

Le plan accepte des nombres, chaînes, booléens, tableaux et objets de données
simples. Ne jamais y mettre d’objet Three.js/Rapier, de fonction, `Map` ou `Set`.

Ajouter uniquement les données nécessaires à plusieurs consommateurs. Un détail
utilisé seulement pour construire une géométrie peut souvent être dérivé de
`bounds`, de l’orientation et des constantes partagées.

## 2. Proposer la feature de façon déterministe

Pour une proposition réutilisable, enregistrer une `FeatureDefinition` dans
`src/world/FeatureRegistry.ts`. Pour une transformation liée à une phase précise
du générateur, l’insérer directement près de cette phase dans
`generateWorld.ts`.

- utiliser le `SeededRandom` fourni et un fork nommé stable ;
- vérifier taille, accès et contraintes de la salle ;
- respecter `reservedRoomIds` et réserver la salle dès acceptation ;
- ne pas placer une feature dans le spawn ou une autre réservation incompatible ;
- conserver des IDs locaux uniques et stables.

## 3. Publier toute la géométrie jouable

La même intention doit apparaître dans toutes les données concernées :

- `floorRects` pour les surfaces praticables ;
- `floorOpenings` et champs verticaux spécialisés pour les vides ;
- `walls`, colonnes ou masses pour les obstacles visibles ;
- `colliders` pour la physique ;
- `LightSlot` et `DetailSocket` pour les consommateurs ultérieurs.

Si la feature modifie murs, planchers ou hauteur après leur création, utiliser
les helpers de reconstruction existants. Ne pas supprimer seulement la face
visible ou seulement le collider.

Préserver au moins 1,60 m de largeur praticable et les accès nécessaires entre
portails. Une transformation qui peut couper une salle doit être auditée par le
graphe ou le flood-fill utilisé par le générateur.

## 4. Gérer les chunks et les étages

Si la feature contient des IDs référencés, étendre `prefixPlanIds()` dans
`src/world/InfiniteWorld.ts`.

Si elle traverse un étage :

- définir clairement le propriétaire canonique de l’ouverture ;
- réconcilier le plan avec le chunk au-dessus ou en dessous ;
- sérialiser dans `WorldPlan` les données dont le worker et `WorldView` ont
  besoin ;
- tester le chunk source, le chunk destination et au moins un étage
  intermédiaire si la portée dépasse 5,4 m.

Une géométrie compacte sous un trou est un aperçu local, pas un deuxième chunk
canonique.

## 5. Construire le rendu

Ajouter une méthode `build…()` ciblée dans `WorldView` et filtrer les features par
leur `kind`.

- fusionner les surfaces statiques par matériau ;
- utiliser `InstancedMesh` pour les répétitions ;
- réutiliser les matériaux existants ;
- conserver le décorateur zonal sur tout matériau cloné visible dans un blackout ;
- construire les faces réellement visibles depuis les étages adjacents ;
- libérer toute ressource possédée dans `dispose()`.

### « Blinking » dans les retours visuels

Dans ce projet, **blinking** (ou texture qui clignote) désigne un **z-fighting** :
deux faces coplanaires se disputent le même pixel et alternent quand la caméra
bouge. L’exemple canonique est le cap horizontal d’un mur posé à `y = 0`
superposé à la moquette d’une entrée d’`epic1`. Corriger la géométrie à la source
en supprimant ou en découpant la face redondante ; ne pas masquer le problème
avec un petit décalage arbitraire.

## 6. Tester au niveau du contrat

Ajouter seulement les tests qui protègent le risque introduit :

- déterminisme, distribution et navigation dans `generateWorld.test.ts` ;
- héritage, frontières et IDs dans `InfiniteWorld.test.ts` ;
- surfaces/caps dans `WorldBuilder.test.ts` ;
- franchissement et colliders dans `PhysicsWorld.test.ts` ;
- éclairage zonal dans `ZonalLighting.test.ts`.

Itérer avec `npx vitest run <fichier> -t "nom du test"`, puis lancer le fichier
complet et `npm run build`. Utiliser `npm run validate` si le contrat
`WorldPlan` ou plusieurs couches ont changé.
