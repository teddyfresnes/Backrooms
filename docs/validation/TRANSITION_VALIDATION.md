# Validation des transitions intégrées — v13

Relevé du 21 octobre 2026. Référence avant : commit
`2ca85cf221747f77628f47cf7e84b49791b58061` (v12).
Les mesures CPU emploient les mêmes 24 seeds et le même environnement, sans
suite de tests ou build concurrent. Le proxy worker avant utilise un instantané
isolé de ce commit avec les mêmes dépendances.

## Vérifications

- Suite verticale finale : **80/80**, dont les parcours complets droits/L/U,
  sauts, chutes, sols inclinés sur leur largeur, couture entre chunks,
  sauvegardes, matériaux, UV et nettoyage.
- Rechargement physique : huit seeds × cinq cycles de cinq propriétaires,
  plus huit cycles avec support conservé. Un test traverse réellement l’entrée
  latérale du coin anciennement enfermé entre deux cages.
- Audit de distribution : **328 plans** (128 seeds à adresse fixe et huit
  voisinages de 5×5 chunks). Aucun dégagement invalide, aucune isolation ou
  couture incohérente ; toutes les fréquences minimales déclarées sont atteintes.
- Audit complémentaire : **96 seeds**, dont 32 de contrôle à
  coordonnées négatives ; **1746 références externes** et
  arrivées réelles, **889284 triangles UV**, aucune erreur.
  90 ouvertures historiques, 1 source(s)
  de vide et 49 reliefs sont observés.
- La part ordinaire, mesurée sur les empreintes des pièces BSP/halls admissibles,
  est de **79.2 %**. Ce n’est pas une
  mesure du volume 3D total ni de la fréquence de chaque pièce.
- Personnages FBX : **639/639** au premier passage complet. Après les dernières
  corrections, les deux chutes régionales réelles, la locomotion et les contacts
  au sol passent. Le sous-ensemble final a donné 56/57 ; l’essai d’animation
  accroupie à 120 Hz, inchangé, a échoué sous charge puis le fichier passe
  **21/21 en isolement**. Aucun seuil d’animation n’a été modifié.
- Passage général : **568/570** avant l’alignement du test de passerelle sur
  l’emprise complète X/Z. Ce cas passe dans les 80 tests finaux. L’autre échec
  est préexistant : le test de l’appartement attend la racine
  `ImportedApartmentScene_v1.19.2`, l’asset fournit `russian_cigarette_pack(1).glb`.
  L’asset et cette assertion sont inchangés.
- Build TypeScript/Vite hébergé réussi ; 148 OBJ de garde-robe vérifiés par leur
  topologie et 148 fichiers de vêtement vérifiés sans perte. Les copies sources
  redondantes ont été retirées après la fin des écritures du build.

## Variations observées

Les dimensions des salles observées sont : 28x28x10.8, 28x28x5.4, 28x56x10.8, 28x56x5.4, 56x28x10.8, 56x28x5.4, 56x56x10.8 m
(largeur × profondeur × dénivelé).
Les demi-volées régionales ont des longueurs de
3.00 à 7.71 m
et des dénivelés de 0.025 à
7.25 m. Les rampes continues sont limitées à une
pente de 0,4 ; les valeurs supérieures correspondent à des escaliers.
Les dimensions et fréquences ne sont pas forcées sur les seeds de démonstration.

## Coûts CPU avant / après

Valeurs médiane / P95. Architecture sans meshes de props, graffiti, textures ou
GPU ; montage Rapier sur les colliders générés. Les lots ne sont pas des draw calls.

| Mesure, chunk froid | Avant | Après |
|---|---:|---:|
| Génération froide (ms) | 181.32 / 268.77 | 221.76 / 342.08 |
| Préparation Three (ms) | 29.36 / 63.93 | 38.97 / 77.93 |
| Champ lumineux (ms) | 22.35 / 62.64 | 56.71 / 88.16 |
| Montage Rapier (ms) | 17.01 / 25.46 | 18.08 / 27.99 |
| Clonage structuré (ms) | 16.56 / 21.41 | 16.31 / 25.96 |
| Plan JSON (MiB) | 2.43 / 3.53 | 2.47 / 3.38 |
| Colliders | 1656 / 2485 | 1405 / 1901 |
| Triangles préparés | 24528 / 35838 | 19100 / 25056 |
| Lots de matériau | 9 / 10 | 9 / 10 |

| Aller-retour worker Node (ms), médiane / P95 | Avant | Après |
|---|---:|---:|
| cold-modern | 246.16 / 512.02 | 345.40 / 524.48 |
| warm-modern | 117.26 / 180.49 | 148.46 / 240.94 |
| cold-legacy | 599.28 / 714.78 | 685.67 / 928.65 |

Sur ce corpus, les triangles préparés baissent de 22 % et les colliders de
15 % en médiane. La génération froide prend 22 % de temps supplémentaire, et
le champ lumineux calculé dans le worker est plus coûteux. La préparation Three
au montage passe de 29 à 39 ms : le risque de saccade doit encore être évalué
dans le navigateur. Les lots restent au même nombre.

Les coûts supplémentaires, tailles des plans et pics de mémoire sont publiés
sans les assimiler à des FPS. Les JSON bruts comprennent aussi les caches chauds,
le transfert et les heaps JS ; ils excluent les mémoires WASM et GPU.

- [Architecture avant](transition-before.json) et [après](transition-after.json).
- [Worker avant](transition-worker-before.json) et [après](transition-worker-after.json).
- [Distribution](transition-diversity.json) et [features / références / UV](transition-integration.json).

## Reproduction

```sh
npm run test:vertical -- --maxWorkers=2
npm run audit:transitions
npm run audit:vertical
npm run test:character -- tests/character/regional-fall-integration.test.mjs
npm run benchmark:vertical
npm run benchmark:worker
npm run build
```

Les deux rapports d’audit donnent les seeds, propriétaires et coordonnées exactes
pour chaque famille. En jeu, `/locate` atteint les repères ; `/geometry uv` montre
la grille, `/geometry volumes` les dégagements/structures/colliders, et
`/geometry off` restitue le rendu normal. `/logs` documente le propriétaire réel.

Le service de prévisualisation supervisée est indisponible (mailbox absente).
Aucune capture WebGL, validation des shaders, mesure GPU ou inspection visuelle
finale n’est annoncée. Les vérifications Three ci-dessus sont géométriques et CPU.
Les limites structurelles restent explicites : tranches ordinaires translatées
avec une adresse de 5,4 m, atria bornés à deux ou trois propriétaires et puits
profonds bornés. Le détail des contrats et la matrice de conservation sont dans
[TRANSITION_INTEGRATION.md](../TRANSITION_INTEGRATION.md).
