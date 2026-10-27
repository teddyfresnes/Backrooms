# Génération liminale ordinaire — validation

Référence : `9e9d89f229797c64c9f0467ec1cde51c3549e4c2` (version 19 publiée).
Le plan ordinaire passe de 16 à 17 ; topologie et spatial restent en version 2.

## Résultat

Neuf compositions de parois : arche unique, rangée d'arches, groupe latéral,
deux groupes, passages mixtes, fenêtres hautes, rangée rectangulaire,
grande baie avec petites et ouvertures de hauteurs différentes.
Les arches extrudent le même profil échantillonné pour triangles et Rapier,
sur toute l'épaisseur. Courbes bornées à 12 segments et six baies par paroi.
Les plinthes suivent les contours exposés et la politique de la pièce.

Quatre compositions de salle : galerie sur un côté, galeries opposées inégales,
L partiel, mezzanine d'extrémité. Des couloirs de service réels conservent les
raccords du monde derrière les façades, sans imposer quatre accès centraux
visibles. Les masses descendent par bandes jusqu'au sol ; les galeries basses
avancent davantage vers le centre. Une terrasse fractionnaire peut recevoir une
seule volée si son emprise est libre. Aucun escalier automatique pour les vues.

Quatre fosses identifiables complètent les anciennes grilles : puits décentré,
faille, puits jumelés et cour encaissée. Les propriétaires source, traversés et
arrivée sont réellement construits, avec des profondeurs de 5,4 à 27 m ; les
vides intentionnels portent sur 54 m et gardent la récupération de chute à 48 m.
Les propositions historiques sont prioritaires et leur RNG reste indépendant.

Les passerelles L avec saut et les anciens atria en gradins restent réservés à
leur chemin historique. Les réparations BSP précèdent les arches et ne peuvent
pas les transformer en blocs. Les vues et chutes ne deviennent pas des marches.
Une arête de porte déjà incorrecte dans la référence a aussi été replacée sur
la frontière commune de ses deux seuils réels.

## Distribution et conservation

Les chiffres et exemples reproductibles sont générés par les scripts livrés.
Ils portent sur des seeds ordinaires, avec un corpus de validation distinct.

| Composition | 320 seeds ordinaires | 160 seeds de validation |
|---|---:|---:|
| Arche unique | 37 | 11 |
| Rangée d’arches | 22 | 13 |
| Groupe latéral | 19 | 24 |
| Deux groupes | 28 | 15 |
| Rectangles et arches | 38 | 13 |
| Fenêtres hautes | 31 | 17 |
| Rangée rectangulaire | 24 | 12 |
| Grande baie et petites | 35 | 16 |
| Hauteurs mélangées | 32 | 18 |
| Galerie sur un côté | 1 | 4 |
| Galeries opposées inégales | 2 | 4 |
| L continu partiel | 1 | 1 |
| Mezzanine d’extrémité | 5 | 2 |
| Puits décentré | 2 | 1 |
| Faille | 1 | 1 |
| Puits jumelés | 3 | 2 |
| Cour encaissée | 3 | 2 |

Le BSP représente **83.52 %** et **83.97 %** de la surface praticable réellement produite dans les deux corpus. 201/480 chunks n’ont aucune nouvelle feature. Les styles, datums et murs historiques restent la base.

L’audit couvre 3,425,421 triangles Float32 dans 279 chunks enrichis, plus 56 tranches de 20 salles complètes. **Zéro erreur** de plan, normale, UV, recouvrement sur les plans des axes ou destination inspectée. 91 destinations et interfaces contrôlées.

Sur ces 56 tranches : 55 sans nouvel escalier et une avec une seule volée. Les reliefs fractionnaires observés vont de 0,90 à 2,18 m. Les quatre fosses et toutes les profondeurs prévues (5,4 / 10,8 / 16,2 / 27 / 54 m) apparaissent dans le corpus ordinaire. Les baies mesurées font 1,63–5,92 m de large ; les fenêtres hautes ne sont pas classées comme des marches.

Comparaison à la référence sur 512 colonnes : les 174 propositions historiques (149 passages et 25 grilles) sont identiques. Les 512 datums/styles vérifiés et les propriétaires d’atria sont conservés. Les cinq monuments sont identiques par hash complet. Les 19 nouvelles fosses n’occupent que des colonnes auparavant sans proposition.

Données : [corpus](liminal-corpus.json), [conservation](liminal-preservation.json).

## Mesures CPU

Même harnais sur 24 seeds, référence et nouveau code, sans tests concurrents.
Les temps incluent la génération, la préparation des buffers, le montage Three
et Rapier ; ils n'incluent pas l'envoi GPU ni les textures réelles.

| Mesure | Médiane avant → après | P95 avant → après |
|---|---:|---:|
| Génération (ms) | 217.11 → 251.22 | 340.41 → 321.16 |
| Préparation lumière (ms) | 33.36 → 51.03 | 64.81 → 79.56 |
| Buffers géométriques (ms) | 101.76 → 111.13 | 150.20 → 158.02 |
| Montage Three (ms) | 2.49 → 2.83 | 10.48 → 6.83 |
| Montage Rapier (ms) | 13.26 → 15.34 | 17.74 → 22.31 |
| Triangles | 13027.00 → 13266.00 | 18442.00 → 18442.00 |
| Lots | 10.00 → 10.00 | 11.00 → 11.00 |
| Colliders | 960.00 → 980.00 | 1241.00 → 1241.00 |

Les coûts de génération et les extrêmes varient avec les formes rencontrées et le démarrage du moteur JS. Ces mesures ne permettent pas d’affirmer que les FPS ont augmenté. Le montage reste distinct de la préparation worker.

Données : [avant](liminal-performance-before.json), [après](liminal-performance-after.json).

Les caches et dépendances restent bornés ; aucune extension du rayon global de
chargement. Les buffers sont toujours préparés dans le worker et regroupés par
matériau. Les nouveaux profils n'ajoutent aucun traitement par frame.

## Vérifications et limites

- Suite complète reconstruite : **636/637**, 81 fichiers, avec deux workers.
- Seul échec : nom racine de l'asset d'appartement attendu `ImportedApartmentScene_v1.19.2`, obtenu `russian_cigarette_pack(1).glb`, déjà présent dans la référence.
- Source appartement récupérée sans modification : SHA256 `1b1864ff763676e6fa4bc0b66e0ae2d854a7bf9ef3e61990d2c9f6fce7067dda`.
- Six tests nouveaux : parité visible/Rapier, traversées, compositions, vrais propriétaires, fosses, ordre, couture négative et volée unique ; tous passent dans la suite complète.
- Les dix tests ciblés de régression verticale avaient également passé avant la reconstruction.
- Après la jonction finale des L et le contrôle des entrées canoniques, le fichier physique ciblé passe à nouveau : **4/4**.
- TypeScript et build principal réussis. Le build hébergé garde ses sourcemaps désactivées. Quatre JSON de crédits sont compactés dans la sortie, avec une égalité vérifiée du contenu désérialisé, pour respecter le budget de taille. Les binaires et leurs contrôles d’intégrité sont conservés.

Avant la réinitialisation du poste de travail, la suite personnage avait donné
638/639 ; l'assertion de cadence accroupie en première personne à 120 Hz a ensuite
passé dans son fichier relancé seul (21/21). Aucun code de personnage, caméra ou
contrôleur n'a été modifié. La reconstruction est contrôlée à nouveau par les
tests géométriques et physiques et les corpus générés conservés ci-dessous.

L'aperçu géré reste indisponible : `sites-previewd mailbox is unavailable`.
Aucune capture WebGL, perception du bloom ou mesure de FPS n'est revendiquée.
Les audits de triangles contrôlent les recouvrements sur les plans des axes,
les normales et UV, pas une comparaison visuelle de chaque seed.

Le build hébergé et ses contrôles passent : 3 075 fichiers, 264 234 587 octets
(sous 252 Mio), aucun fichier au-dessus de 25 Mio. L'appartement est vérifié
sans perte (349 270 200 octets décompressés), ainsi que le pack de mouvements.
Les 148 topologies OBJ et 148 fichiers de vêtements sont vérifiés, avec des
vêtements identiques octet pour octet. Les quatre JSON de crédits conservent
exactement leur contenu après compactage.

## Reproduction

| Famille | Seed | Position monde | Sol inférieur |
|---|---|---|---|
| single | `LIMINAL-ORDINARY-5` | `(121.037, -6.835, -41.700)` | — |
| rhythm | `LIMINAL-ORDINARY-2` | `(64.881, -3.735, -105.935)` | — |
| right-cluster | `LIMINAL-ORDINARY-0` | `(-91.312, -2.835, -78.938)` | — |
| two-clusters | `LIMINAL-ORDINARY-0` | `(-117.353, -2.835, -80.917)` | — |
| mixed | `LIMINAL-ORDINARY-11` | `(99.348, -2.135, -128.414)` | — |
| high-windows | `LIMINAL-ORDINARY-1` | `(-8.945, -3.985, -158.084)` | — |
| rect-rhythm | `LIMINAL-ORDINARY-6` | `(-158.373, -7.835, 129.512)` | — |
| wide-and-small | `LIMINAL-ORDINARY-3` | `(-101.490, 1.115, 38.800)` | — |
| mixed-levels | `LIMINAL-ORDINARY-23` | `(162.496, 5.215, 12.021)` | — |
| gallery-side | `LIMINAL-ORDINARY-82` | `(14.000, -1.635, -167.200)` | `(14.000, -12.435, -140.000)` |
| gallery-opposed | `LIMINAL-ORDINARY-42` | `(-154.000, 5.965, 56.800)` | `(-140.000, -4.835, 70.000)` |
| gallery-corner | `LIMINAL-ORDINARY-276` | `(-126.000, -10.735, 56.800)` | `(-126.000, -16.135, 70.000)` |
| gallery-end | `LIMINAL-ORDINARY-40` | `(14.000, -17.335, 0.800)` | `(28.000, -22.735, 14.000)` |
| offset-well | `LIMINAL-ORDINARY-73` | `(-50.600, 11.865, -154.000)` | — |
| fault | `LIMINAL-ORDINARY-172` | `(5.400, -3.185, -70.000)` | — |
| paired-wells | `LIMINAL-ORDINARY-81` | `(-134.600, -7.635, -154.000)` | — |
| sunken-court | `LIMINAL-ORDINARY-80` | `(126.000, -16.985, 89.400)` | — |
| fractional-stair | `LIMINAL-ORDINARY-42` | `(-148.912, -2.821, 65.747)` | — |


Coordonnées monde du centre du personnage (x, y, z). Pour une salle, la pose
haute correspond à une vraie entrée et la pose basse au sol central réservé.
Les données JSON détaillent aussi propriétaire, niveaux, côtés et profondeur.

Commandes :

```sh
node scripts/run-liminal-audit.mjs docs/validation/liminal-corpus.json
node scripts/audit-liminal-preservation.mjs CHEMIN_REFERENCE
node scripts/benchmark-streaming.mjs CHEMIN_REFERENCE
node scripts/benchmark-streaming.mjs
npx vitest run --maxWorkers=2
npm run test:character
npm run build
```
