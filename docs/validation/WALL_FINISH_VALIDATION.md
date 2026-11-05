# Murs et plinthes — validation du 27 octobre 2026

Référence : `9a404eeb41384950c7387f9fec73845e4edca31d` (version 18).
Le seed et la position de la capture ne sont pas disponibles. Sa forme est
reproduite par des cas synthétiques ; aucune reproduction exacte de la capture
ni validation visuelle WebGL n'est annoncée.

## Causes confirmées et correction

- La génération spatiale limitait les plinthes aux IDs BSP, décidait au centre
  du mur et émettait deux bandes indépendamment des faces réellement exposées.
- Des exceptions aléatoires préservaient 2,5 % de certaines opérations de
  nettoyage. Elles sont retirées pour les raccords parasites ; les vrais reliefs,
  cadres, ouvertures et détails protégés conservent leurs contrats.
- Les jonctions en T et retours de niches pouvaient manquer leur porteur de
  quelques centimètres. Ils rejoignent sa face exacte uniquement lorsque le
  porteur couvre toute leur section et leur hauteur.
- Le nettoyage spatial retire les fragments ordinaires presque enfouis après
  les réservations et les derniers supports. Prismes et collisions restent
  synchronisés ; les sols sont reconstruits lorsque nécessaire.
- La finition de la pièce BSP canonique est sérialisée dans
  `RoomRecord.baseboards`, puis héritée par ses fragments. Les exclusions
  spatiales portent aussi leur datum `floorY`. Les exclusions historiques sans
  altitude gardent leur sens par face et par intervalle.
- `SpatialBaseboards` utilise les faces verticales exposées, les sols réels et
  l'union de leurs fragments, sans filtre sur l'origine du mur. Il traite les
  piliers, façades, passages bas, paliers et rampes. Les plans affines permettent
  de raccorder des fragments de pente loin de l'origine.
- Les angles ont des onglets compatibles ; les offsets des très petites niches
  gardent une enveloppe convexe. Les contacts cachés et caps de coupe sur les
  coutures ne produisent pas de triangles. Les extrémités visibles restent fermées.
- Le rendu historique partage les exclusions avec le chemin spatial et ne
  rallonge plus arbitrairement les bandes de 2,5 cm aux extrémités.
- Un triangle de plafond déjà dégénéré dans la référence après conversion
  Float32 a été reproduit. Le rejet des triangles teste désormais les coordonnées
  réellement envoyées au GPU, sans augmenter globalement les epsilon.

Les plinthes restent décoratives, sans collision et fusionnées dans leur lot.
Le BSP, les épaisseurs architecturales, les grandes salles, les datums régionaux,
les structures historiques et les réglages d'éclairage sont conservés.

## Vérifications

- Suite générale finale : **630/631**. L'unique échec est le nom racine de l'asset
  d'appartement : attendu `ImportedApartmentScene_v1.19.2`, présent
  `russian_cigarette_pack(1).glb`. L'asset est celui de la référence, vérifié par
  son SHA256 ; il n'est pas modifié par cette correction.
- Suite personnage complète : **639/639**. Après l'optimisation des recherches,
  les trois essais de chute régionale et de garde-robe passent également.
- Les 28 essais ciblés murs/plinthes/coutures passent. Ils raycastent les vraies
  géométries, couvrent coins, exclusions partielles, contact d'extrémité, deux
  faces de styles différents, niveaux superposés, vides, sols inclinés, fragments
  étroits, profils translatés, coutures, transfert et colliders.
- Audit indépendant de 24 seeds et adresses : **0 erreur**, **586 sondes de
  finition**, normales unitaires et absence de recouvrement de triangles sur
  les plans des axes. Le nettoyage est idempotent sur les 24 plans finaux.
- Sur ces 24 seeds, les hashes des formes de pièces, des features et des
  ouvertures de sol/plafond sont identiques à la référence : **24/24** chacun.
- L'optimisation du nettoyage par index spatial conserve le hash complet des
  24 plans du corpus de performance avant/après optimisation : **24/24**.
- TypeScript et builds principal/Sites réussis. Sortie hébergée finalisée après
  tous les writers : **148 OBJ**, **148 vêtements lossless**, assets du manifeste
  présents ; appartement lossless vérifié.
- `git diff --check` passe.

Le nouveau placement a exposé une assertion personnage trop stricte : deux
quaternions strictement identiques produisaient `angleTo(self) = 2.98e-8`
(arrondi du produit scalaire). Le test du curseur compare désormais les
composantes à l'identique ; le comportement de la caméra n'est pas modifié.

Une exécution de validation en concurrence avec les builds a dépassé le délai
30 s d'un audit régional. La suite complète relancée sans cette charge donne
les 630/631 résultats ci-dessus, sans modifier le timeout ni le test régional.

## Coût CPU et géométrie

Même harnais `scripts/benchmark-streaming.mjs`, 24 seeds, caches vidés par seed,
sans charge de test concurrente pendant les mesures retenues. Colonnes :
**médiane / P95**. Les brutes sont conservées avec ce rapport.

| Mesure | Référence | Correction |
| --- | ---: | ---: |
| Génération CPU (ms) | 209.70 / 289.98 | 180.54 / 243.56 |
| Préparation des buffers CPU (ms) | 95.29 / 147.04 | 81.32 / 118.76 |
| Montage Three CPU (ms) | 2.01 / 5.28 | 2.04 / 3.72 |
| Triangles | 13951.00 / 20182.00 | 13027.00 / 18442.00 |
| Octets des buffers | 1799556.00 / 2620992.00 | 1667952.00 / 2391312.00 |
| Lots de rendu | 10.00 / 11.00 | 10.00 / 11.00 |
| Colliders | 974.00 / 1261.00 | 960.00 / 1241.00 |

Le nettoyage canonique interroge les murs voisins via un index conservateur,
dans leur ordre historique. Le travail reste dans la génération/préparation
worker ; aucun nettoyage n'est ajouté par frame. Le montage conserve les
buffers transférables et les lots par matériau.

Ces mesures sont des proxies CPU : elles ne mesurent ni uploads GPU, ni
compilation des shaders, ni FPS dans le navigateur.

## Reproduction et limite visuelle

```sh
npx vitest run src/world/SpatialBaseboards.test.ts src/world/WallJunctions.test.ts src/render/ArchitectureSeams.test.ts
node scripts/audit-wall-finishes.mjs /chemin/vers/la/reference
node scripts/benchmark-streaming.mjs
```

L'aperçu géré a échoué : `sites-previewd mailbox is unavailable at
/tmp/sites-previewd/requests`. Aucun serveur alternatif ni contrôle WebGL n'a
été substitué. L'aspect des raccords, les coutures en déplacement et les FPS
restent à vérifier en jeu.

Données : [avant](wall-finishes-before.json), [après](wall-finishes-after.json),
[audit géométrique](wall-finishes-geometry.json).
