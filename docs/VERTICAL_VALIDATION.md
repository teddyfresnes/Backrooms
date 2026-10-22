# Validation historique de la topologie verticale v1

Ce relevé concerne la livraison précédente. Le résultat actuel est dans
[REGIONAL_VALIDATION.md](REGIONAL_VALIDATION.md).

Mesures du 20 octobre 2026, Node 24.19.0, Three 0.185.1, Rapier 0.19.3.
Référence : `1adab41df7b3b8d7726c8b0468097b184e54613d` ; code mesuré :
`2e142b3d4cd0839d2c27e85a655038636c7b36a3`.
Le [contrat vertical](VERTICAL_TOPOLOGY.md) décrit le pipeline et ses limites.

## Résultats fonctionnels

| Contrôle | Résultat |
| --- | --- |
| Suite générale, état final | 521 réussis / 522, 92,46 s |
| Personnage, FBX et physique réels | 637 réussis / 637, 301,93 s |
| TypeScript et build Vite | Réussis, build Vite 2,56 s |
| Audit de diversité infini | 128 chunks ordinaires, aucun monument dans cet échantillon |
| Dégagement ordinaire invalide | 0 sur 22 092 surfaces ordinaires |
| Parcours vertical public inaccessible | 0 |
| Erreur de validation des plans | 0 |

L'échec général est `ImportedApartmentIntegration.test.ts`, assertion du nom de
la racine : attendu `ImportedApartmentScene_v1.19.2`, reçu
`russian_cigarette_pack(1).glb`. Le même test échoue sur le commit de référence
(14 réussis / 15). L'asset et ce test n'ont pas été modifiés par ce travail.
`npm run validate` s'arrête donc à cette assertion ; personnage et build ont été
exécutés séparément pour terminer la validation.

Les nouveaux tests utilisent les véritables corps Rapier et les géométries
Three : profils signés sur X/Z, couches superposées, capsule sur toute la largeur
utile des pentes produites, passage au-dessus et sous les galeries L/U/passerelle,
marche/course/arrêt/inversion/accroupissement avec le contrôleur inchangé,
sauvegardes sur deux couches et repli d'une restauration obstruée. Ils vérifient
aussi huit démontages/remontages d'une couture physique, les coins négatifs,
l'ordre de génération, les caches froids/chauds, le clonage worker et les
enveloppes de grandes hauteurs entre stories, dalles de plafond comprises.

Il reste 2 086 fragments de sol classés inaccessibles dans l'audit ; ce ne sont
pas des parcours verticaux ajoutés. Les passages accroupis hérités représentent
0,544 % de la surface cumulée auditée. Ils gardent leur locomotion explicite.

## Repères reproductibles

Chaque seed ci-dessous est global, de la forme `VERTICAL-PROMPT-AUDIT-N`.
Tous les repères sont dans le chunk `x=-1, z=1, story=0`. Les coordonnées sont
mondiales, l'altitude indiquée est celle du sol, pas celle du centre du joueur.
Les bornes, profils et identifiants exacts figurent dans le JSON de diversité.

| Famille | N | X | Z | Altitude du sol | Chunks concernés / 128 |
| --- | ---: | ---: | ---: | --- | ---: |
| Secteur en contrebas | 0 | -124,75 | 82,25 | -0,45 m | 78 |
| Couloir incliné | 0 | -121,00 | 84,50 | -0,45 → 0 m | 128 |
| Transition entre deux datums non nuls | 1 | -126,50 | 88,25 | -0,80 → -0,45 m | 32 |
| Galerie en U | 2 | -102,12 | 120,80 | +0,90 → +1,80 m | 2 |
| Balcon et passage inférieur | 2 | -99,12 | 120,80 | +1,80 / -0,90 m | 6 / 7 |
| Galerie en L | 19 | -139,05 | 113,68 | +1,80 → +0,90 m | 5 |
| Passerelle | 41 | -138,26 | 104,08 | +1,80 m | 1 |

`/locate rampe`, `/locate balcon`, `/locate passerelle` et
`/locate secteur-encaisse` trouvent les surfaces dans les chunks montés ;
`/noclip` et `/logs` permettent d'inspecter les repères. Les familles rares
n'existent pas dans chaque seed ou chaque voisinage monté.

Le cas initial se reproduit avec le seed BSP brut `VERTICAL-PROMPT-AUDIT-3`,
au point local `x=-44, z=-2,5`. Le mode
`?seed=RAW_LOCAL_VERTICAL-PROMPT-AUDIT-3` conserve ce BSP dans le chunk racine
du monde infini. La mesure géométrique sur le plan fini donne :

| Mesure réelle | Avant | Après |
| --- | ---: | ---: |
| Altitude du sol | 1,10 m | 0 m |
| Plafond touché par le rayon Three | 2,74 m | 2,74 m |
| Dégagement | 1,64 m | 2,74 m |
| Capsule debout en collision | Oui | Non |

## Coûts comparés

Le même script a tourné successivement, sans autre test ou build concurrent,
sur les 24 seeds `VERTICAL-PROMPT-AUDIT-0` à `-23`. Froid signifie un premier
appel par seed global, dans un processus neuf ; chaud signifie une nouvelle
génération immédiatement après le préchauffage de cette même adresse. Les
caches sont bornés et peuvent évincer des entrées pendant la série froide.
Médiane / P95, temps en millisecondes, JSON en octets :

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Génération finie | 31,03 / 62,12 | 62,62 / 120,14 |
| Génération infinie froide | 294,39 / 544,42 | 479,87 / 558,10 |
| Génération infinie chaude | 36,53 / 56,33 | 84,94 / 147,99 |
| Clonage fini | 1,51 / 2,64 | 3,57 / 6,70 |
| Clonage infini froid | 2,02 / 3,91 | 3,97 / 5,37 |
| Clonage infini chaud | 1,97 / 3,79 | 3,86 / 6,29 |
| Préparation architecture finie Three | 18,06 / 44,93 | 39,71 / 70,47 |
| Préparation architecture infinie froide Three | 31,67 / 54,21 | 57,80 / 128,26 |
| Préparation architecture infinie chaude Three | 30,34 / 45,30 | 53,92 / 126,64 |
| Montage Rapier fini | 2,67 / 5,98 | 4,28 / 7,25 |
| Montage Rapier infini froid | 3,61 / 7,39 | 4,58 / 10,04 |
| Montage Rapier infini chaud | 3,52 / 8,56 | 4,77 / 8,14 |
| JSON fini | 205 170 / 302 962 | 403 749 / 514 592 |
| JSON infini | 247 308 / 510 741 | 541 925 / 810 374 |
| Colliders finis | 424 / 783 | 582 / 779 |
| Colliders infinis | 606 / 1 374 | 698 / 1 173 |
| Triangles finis | 10 756 / 14 470 | 16 180 / 21 836 |
| Triangles infinis | 13 338 / 23 048 | 22 520 / 40 664 |
| Lots de matériaux finis | 19 / 31 | 17 / 31 |
| Lots de matériaux infinis | 26 / 38 | 25 / 36 |

Pic JS échantillonné avant/après : fini 109,54 / 116,78 Mo, infini froid
161,43 / 146,91 Mo, chaud 164,40 / 179,42 Mo. Delta retenu après GC : fini
2,81 / 3,55 Mo, froid 0,10 / 12,57 Mo, chaud 1,19 / -1,75 Mo. Ces deltas
dépendent du GC et des caches ; ils ne mesurent pas une fuite ni toute la mémoire.

La topologie augmente surtout les données, les triangles et la préparation
CPU. La génération reste déléguée au worker ; la préparation Three reste un
coût sur le thread principal. Son P95 de 128 ms demande une mesure en navigateur
avant de conclure à l'absence de saccades. Cette série n'établit aucun budget
de frame GPU. Les bornes algorithmiques sont documentées dans le contrat ;
les nombres ci-dessus sont des observations sur cette machine.

## Reproduction et limites

`npm run test:vertical`, `npm run audit:vertical`, `npm run benchmark:vertical`.
Pour comparer au commit initial, copier les deux scripts `audit-vertical.ts`
et `run-vertical-audit.mjs` dans son checkout, avec les mêmes dépendances/assets,
puis exécuter le benchmark dans chacun des deux checkouts successivement.
Les résultats bruts sont [avant](validation/vertical-before.json),
[après](validation/vertical-after.json) et [diversité](validation/vertical-diversity.json).

Le benchmark monte l'architecture sans meshes de props, graffiti, textures ni
GPU. Les colliders du plan sont conservés. Les lots de matériaux ne sont pas
des draw calls mesurés ; la mémoire JS exclut Rapier/WASM et GPU. Il ne mesure
ni shaders compilés, ni FPS, ni worker navigateur effectif.

Le contrôle visuel/WebGL n'a pas été effectué : l'outil `$control-browser` est
absent. La règle du skill [Sites](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md)
est « If `$control-browser` is unavailable, skip browser QA ». Les contrôles
géométriques et physiques ci-dessus ne remplacent pas une inspection visuelle
des textures, éclairages et sous-faces dans les deux modes de rendu.
