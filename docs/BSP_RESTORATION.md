# Labyrinthe historique dans le relief régional — version 12

Le monde ordinaire réutilise le BSP et les détails historiques, dans les volumes
à datums régionaux. Les cellules de 28 m ne dessinent plus quatre pièces fixes
ni une façade à chaque frontière d’un plateau. Les grands espaces, atria,
escaliers, ouvertures hautes, passerelles et niveaux inférieurs restent présents.

## Références et intégration

- Avant les refontes verticales : `1adab41df7b3b8d7726c8b0468097b184e54613d`.
- BSP et première topologie verticale : `f5cf66e4367402e4cf5c482fa43f11ef2224fb39`.
- Plan régional simplifié comparé : `49a413d09ba447efe0edf1f04b1f0cff1b11de25`.
- `WorldPlan.version = 12` ; topologie et spatial restent en version 2.

`generateBspArchitecture` réutilise les vrais helpers de subdivision, choix des
épaisseurs et ouvertures, grand hall, plafonds, pilastres, niches, cloisons
partielles, masses, portes, lumières et sockets. Un domaine de 224 m couvre quatre
chunks ; ses pièces et ses murs sont découpés aux altitudes définitives. Le cache
est borné à 32 domaines et vidé par `clearInfiniteWorldCaches`.

Les régions conservent leurs datums signés ; l’adresse `story` ne devient pas un
sol par défaut. Les réservations des liaisons précèdent les murs. Leur marge
latérale laisse réellement passer le corps, au lieu de conserver une bande
inutilisable de 44 cm à côté d’une rampe. Les plafonds ordinaires retrouvent une
base de 2,74 m, avec variations bornées à 4,35 m dans le contrat d’adresse actuel.

Les jonctions, teintes et plinthes historiques sont réutilisées. Les masses et
murs pleins sont retranchés des surfaces de navigation. `BspConnectivity` répare
les poches créées par les découpes, en huit passes bornées au maximum : seules
les partitions BSP sont ouvertes, jamais une façade régionale, un support de
rampe ou une porte. Les portes portent une relation conditionnelle
`requiresDoorId`, dont la référence est préfixée avec le chunk.

Les sommets et indices restent communs à Three et Rapier. Les faces orientées
des grandes dalles sont conservées. Le rendu écrit directement les buffers par
matériau ; un test vérifie l’identité des positions, normales, UV et couleurs par
rapport à la concaténation des géométries individuelles. Aucun réglage du
contrôleur, de l’autostep, de la gravité ou du saut n’a été changé.

## Lumière

Les pièces réutilisent les dispositions et panneaux historiques : plusieurs
teintes, intensités 0,98–1,18, panneaux fiables hors blackouts intentionnels.
Les sources sont aux plafonds réels et rejetées si leur empreinte traverse un
mur final, y compris après les raccords régionaux.

Le multiplicateur régional supplémentaire a été retiré. En moderne, le champ
fluorescent historique est sélectionné par volume : bornes verticales float en
nearest, exposition/contact/blackout en RGBA8 linéaire, à 96² par couche. Le nombre
de couches suit le chevauchement réel sans troncature à trois. Les contacts sont
relatifs au sol et au plafond ; une pièce translatée garde son champ lumineux.

Les volumes ayant les mêmes sources et structures réutilisent leur calcul. Les
buffers sont préparés dans le worker et transférés ; le montage ne fait que
créer ses deux textures, libérées avec la vue. Le mode classique garde son bake,
avec filtrage vertical des sources et des occluders. Le post-traitement global,
les palettes et les scènes du hall/appartement n’ont pas été réétalonnés.

## Contrôles

- Suite générale : **544/545**. Le seul échec est l’assertion de nom racine de
  l’asset d’appartement déjà présente avant ces changements :
  `russian_cigarette_pack(1).glb` au lieu de `ImportedApartmentScene_v1.19.2`.
  L’asset et l’assertion n’ont pas été modifiés.
- Checkout hébergé : **56/56** tests verticaux, avec build TypeScript/Vite réussi.
- Personnage : **639/639**, avec les vrais FBX et Rapier, dont les deux chutes
  régionales joueur/personnage partagé sur trois propriétaires.
- Après l’optimisation des lots : **15/15** tests ciblés de géométrie, lumière et
  parcours physiques ; build TypeScript/Vite réussi.
- **328 plans ordinaires**, huit voisinages de 5×5 chunks : aucune erreur de
  topologie/propriété, de dégagement ou de couture dans l’échantillon.
- Contrôle supplémentaire sur **32 seeds** : aucune poche de sol de plus de
  1 m × 1 m sans accès au graphe des circulations et ouvertures réelles.
- **48 seeds**, dont 16 réservées à la validation : 76,22 % de l’emprise mesurée
  des pièces ordinaires hors grands halls ; 74,57 % de la longueur des murs BSP
  structurels a plus de 65 cm d’épaisseur ; 189 pièces reconstituées traversent
  une limite de cellule. Cette proportion d’emprise n’est pas une mesure du temps
  d’exploration et les dimensions des fragments ne sont pas celles des pièces
  complètes. Les pièces de cellule parentes ne sont plus comptées en doublon.
- Une boucle franchit quatre chunks et trois datums dans les deux sens, via les
  vraies ouvertures du BSP : environ **1,54 km de parcours commandé** en physique.
  Les escaliers complets L/U/droits, chutes, saut couru, passages sous pont et
  cycles de sauvegarde/montage sont également couverts.

Données : [architecture](validation/bsp-architecture.json),
[connectivité](validation/bsp-connectivity.json),
[distribution régionale](validation/bsp-regional-distribution.json).

## Coûts mesurés

Même environnement Node, mêmes 24 seeds `VERTICAL-PROMPT-AUDIT-0` à `-23`, adresse
`(-1, 1, 0)`, sans charge de test concurrente. Valeurs médiane / P95.

| Mesure | Régional simplifié v11 | BSP régional v12 |
|---|---:|---:|
| Génération froide | 13,04 / 41,21 ms | 172,24 / 294,83 ms |
| Génération chaude | 13,07 / 25,59 ms | 76,86 / 125,31 ms |
| Clonage du plan | 8,96 / 16,39 ms | 16,27 / 21,24 ms |
| Préparation Three au montage | 26,41 / 52,52 ms | 27,28 / 43,01 ms |
| Montage Rapier | 10,05 / 17,50 ms | 18,19 / 30,04 ms |
| Taille JSON du plan | 1,31 / 2,58 Mo | 2,55 / 3,70 Mo |
| Colliders | 1 186 / 2 013 | 1 656 / 2 485 |
| Triangles d’architecture | 14 312 / 24 270 | 24 528 / 35 838 |
| Lots de matériaux | 8 / 9 | 9 / 10 |

Le champ moderne coûte en plus 24,75 / 62,17 ms de calcul, déplacé dans le worker.
Le proxy worker réel mesure 233,94 / 424,74 ms aller-retour moderne à froid, dont
37,15 / 59,62 ms de préparation lumineuse, et 184 / 369 Ko de buffers lumineux
transférés. Ces mesures incluent les différences de JIT/GC entre processus.

La référence BSP historique complète, avec sa première topologie verticale,
mesure séparément 473,58 / 590,58 ms à froid et 83,19 / 171,86 ms à chaud. Ses
features diffèrent : cette référence situe le coût de l’ancien générateur, elle
ne transforme pas le retour du BSP en optimisation par rapport à la grille v11.

Les plans et le montage physique sont plus coûteux que dans la simplification.
Les lots directs ramènent la préparation Three au voisinage du coût précédent,
malgré la géométrie supplémentaire. Le pic JS échantillonné passe d’environ 171
à 258 Mo ; il exclut WASM/GPU. Les deltas de heap retenue dépendent du GC et des
caches : un delta négatif ne prouve pas un gain mémoire.

Données brutes : [avant](validation/bsp-before.json),
[après](validation/bsp-after.json), [worker](validation/bsp-worker.json),
[référence historique](validation/bsp-historical-generation.json).

## Reproduire et limites

- `npm run test:vertical` : parcours, maillages, lampes, worker, sauvegardes.
- `npx vitest run src/world/RegionalBsp.test.ts --reporter=verbose` : proportions
  et connectivité ; `BSP-RESTORE-0` à `-31`, `BSP-HOLDOUT-32` à `-47`, puis
  `BSP-CONNECTIVITY-0` à `-31`.
- `REGIONAL-AUDIT-0` : boucle dans les chunks `(-2,-2)`, `(-1,-2)`, `(-1,-1)`,
  `(-2,-1)`, story 0. Sols à 6,2 m, −1,05 m et −3,85 m ; le test imprime les
  points et emprunte leurs connexions réelles au lieu de traverser les murs.
- `REGIONAL-AUDIT-6`, `/locate escalier-l`, `/locate escalier-u`,
  `/locate galerie-l`, `/locate saut-passerelle` : variantes ordinaires.
- `/locate ouverture-haute`, `/locate rampe-regionale` et
  `/locate escalier-regional` : autres circulations ; les tests recherchent
  leurs occurrences dans les seeds ordinaires, sans forcer leur présence.

**Contrôle WebGL non effectué.** Le superviseur d’aperçu est indisponible :
`sites-previewd mailbox is unavailable at /tmp/sites-previewd/requests`.
Aucune capture, compilation GPU, mesure de draw calls ou temps de frame n’est
attestée. Les tests de shader vérifient sa préparation textuelle, pas son lien
GPU. L’identité visuelle avec l’ancienne version reste à confirmer en jeu.

Le bake classique et le champ moderne restent des approximations d’éclairage,
pas une GI 3D. La géographie se répète encore au pas d’adresse de 5,4 m, avec les
atria communs à trois adresses : ce n’est pas un partitionnement 3D arbitraire.
Les contrôles statistiques portent sur un corpus fini, pas sur tous les seeds.
