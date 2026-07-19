# Ajouter une feature architecturale

Une feature est une réservation sémantique posée dans une salle après la topologie principale. Elle ne doit jamais modifier un mur ou un collider sans publier la même modification dans le `WorldPlan`.

## 1. Déclarer les données

Ajouter un type dans `src/world/types.ts`, puis l’inclure dans `WorldFeature`.

```ts
export interface ShallowPitFeature {
  kind: 'shallow-pit';
  id: string;
  roomId: string;
  bounds: Rect;
  depth: number;
  entrySide: 'x+' | 'x-' | 'z+' | 'z-';
}
```

Les données doivent rester des nombres, chaînes et tableaux simples. Aucun objet Three.js ou Rapier ne doit entrer dans le plan.

## 2. Enregistrer la proposition

Dans `FeatureRegistry.ts`, déclarer :

- l’empreinte minimale ;
- le poids ;
- les contraintes de salle ;
- la proposition déterministe à partir du `SeededRandom` fourni.

Le générateur maintient `reservedRoomIds`. Une feature qui occupe une salle doit la réserver avant la décoration afin d’éviter colonnes, escaliers ou objets incompatibles.

## 3. Préserver la navigation

- largeur praticable minimale : 1,60 m ;
- garder au moins un passage entre chaque portail de la salle ;
- ajouter les surfaces solides à `floorRects` ;
- ne pas créer de collider au-dessus d’un vide ;
- ajouter un collider simple par mur, marche ou plateforme ;
- laisser le seuil de chute global replacer le joueur, ou enregistrer un futur sensor dédié.

Une feature qui coupe la salle doit lancer un flood-fill local avant d’être acceptée.

## 4. Émettre le rendu

Ajouter une méthode ciblée dans `WorldBuilder` :

```ts
private buildShallowPits(): void {
  const pits = this.plan.features.filter(
    (feature): feature is ShallowPitFeature => feature.kind === 'shallow-pit',
  );
  // Construire des BufferGeometry, puis les fusionner par matériau.
}
```

Éviter un `Mesh` par module. Utiliser :

- `mergeGeometries` pour murs, sols et marches statiques ;
- `InstancedMesh` pour répétitions ;
- une géométrie proxy lointaine pour les vues impossibles ;
- des matériaux existants sauf si la surface est réellement différente.

## 5. Lumières, audio et futurs objets

Ajouter des `LightSlot` au plan au lieu de vraies lumières. Le baker de chunk transforme automatiquement ces emplacements en champ lumineux stable, limité aux pièces et occlus autour des murs ; les dalles visibles restent instanciées.

Ajouter des `DetailSocket` avec tags pour les futurs items, props, sources audio ou entités. Une pièce spéciale peut ainsi annoncer des points d’intérêt avant que le système d’items existe.

## Features prévues

- `shallow-pit` : sol abaissé et trois marches ;
- `deep-void` : vide profond et sensor de recalage ;
- `cut-wall` : mur suspendu ou tronqué ;
- `giant-atrium` : plafond élevé et LOD distant ;
- `detail-room` : sockets d’objets à densité élevée ;
- `dark-gallery` : champ lumineux presque entièrement en panne ;
- `multi-level-stairs` : changement réel de surface Y et portail de zone.

Ajouter un test seedé pour chaque feature, puis étendre le tableau de seeds de `generateWorld.test.ts` si elle touche à la connectivité.
