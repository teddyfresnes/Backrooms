# Grandes salles et aperçus — v15

Référence : `729cda344374f282eacb340de885f76b9f4cbff1` (v14).
Les rapports précédents restent inchangés dans ce dossier.

## Comportement

Les salles classiques conservent leurs galeries, passerelles et escaliers L/U/
droits, avec un escalier intérieur facultatif. La nouvelle famille en gradins
possède trois ou quatre niveaux sans escalier intérieur imposé. Les quatre
empreintes de 28 à 56 m sont conservées. Chaque anneau inférieur avance vers le
centre, en laissant un bas d’au moins 8 m de côté.

Les soubassements de chaque galerie descendent jusqu’au vrai sol inférieur,
y compris dans les salles classiques. Leurs bandes verticales sont contiguës
et possédées sans recouvrement par les différents owners. Des passages de 4 m,
sous des linteaux à 2,74 m, traversent les masses aux entrées canoniques.
Les coins inaccessibles sous les paliers entre deux rampes pleines sont comblés.
Les sols, collisions, ouvertures, plafonds et références d’arrivée partagent ces
descriptions. Les nouvelles terrasses ont des chutes dirigées vers le niveau
immédiatement inférieur ; les anciens trous et passages sont conservés.

Les phases classiques restent sur quatre adresses. Les gradins utilisent six
adresses pour faire tenir quatre niveaux et une séparation entre deux salles.
Le BSP ordinaire, les datums signés, les UV et les réglages lumineux sont
conservés. Des luminaires supplémentaires éclairent les entrées sous leur vrai
plafond ; un linteau au-dessus du panneau n’est plus traité comme un mur qui le
traverserait.

## Aperçus et chargement

Le budget reste limité au voisinage 3×3 et à douze owners supplémentaires.
Les supports proches sont prioritaires, puis les vues dans la direction du
regard. Les ouvertures en bordure d’atrium déclarent aussi les colonnes voisines
visibles à chaque niveau. La portée des vues passe à 72 m, avec une marge
verticale de 20 m ; la portée structurelle reste à 36 m.

Les vues hors de la story active affichent l’architecture, les matériaux,
la lumière, les luminaires et les portes réels. Les props décoratifs, graffitis
et dommages attendent l’approche. Leur promotion conserve la géométrie et les
textures de lumière déjà montées. Les collisions proviennent du plan canonique.

Une réponse worker alimente seulement le cache CPU. Le montage Three/Rapier
est admis au plus une fois par frame. Le cache de douze plans conserve aussi
les données lumineuses des zones récemment démontées, tandis que leurs
ressources GPU sont libérées. La sélection des dépendances est réutilisée dans
une marge de 1,5 m / environ 12°, et invalidée après un changement de centre ou
un montage/démontage. Le fallback sans Worker reste synchrone.

## Vérifications

| Contrôle | Résultat |
|---|---|
| Suite générale finale | 585/586 ; seule l’assertion préexistante du nom de l’asset d’appartement échoue |
| Sous-ensemble vertical | 96/96 |
| Distribution normale : 256 seeds + huit voisinages 5×5 | 456 plans, 1 086 portails, aucune erreur de topologie, de dégagement ou de couture |
| Salles en gradins dans la distribution | 70 seeds, dont 43 avec quatre niveaux |
| Familles historiques | Au moins trois seeds par famille exigée, dont escaliers L/U/droits et passerelles |
| Audit transitions, 64 seeds fixes + 32 de contrôle | 1 481 liens externes, 91 trous sources et 84 reliefs, aucune erreur |
| UV des prismes rendus | 852 996 triangles, aucun UV dégénéré |
| Part des empreintes BSP parmi BSP/halls admissibles | 79,2 %, sans prétendre mesurer toute la surface du monde |
| Garde-robe hébergé finalisé | 148 OBJ et 148 fichiers de vêtement présents et vérifiés sans perte |

Les nouveaux tests couvrent le déterminisme sur toutes les adresses, les quatre
empreintes, les retraits croissants, les parois porteuses sans lacune ni doublon,
les passages réels sur quatre niveaux, les chutes physiques entre terrasses et
les plafonds au-dessus des luminaires. Les tests de streaming couvrent le budget,
la priorité au regard et le cache ; la promotion des détails garde les mêmes
objets géométriques et le même champ lumineux, avec un détail non vide en entrée.

Les tests personnage couvrent 639 noms distincts : 638 passent et le même essai
accroupi en première personne à 120 Hz échoue, déjà signalé en v14. La première
exécution s’est interrompue sans bilan après 603 résultats ; les cinq fichiers
restants ont été exécutés séparément, 36/36. La fixture de chute libre choisit
une galerie classique, car les gradins possèdent intentionnellement un sol
intermédiaire ; les chutes entre ces nouveaux sols sont vérifiées séparément.
Aucune tolérance d’animation ou de déplacement n’a été relâchée.

## Coûts CPU

Snapshots v14/v15 mesurés successivement, sans tests ou builds concurrents,
sur les mêmes 24 seeds et le même Node. Valeurs médiane / P95 du chunk infini
froid. Le proxy exclut props, textures et GPU ; il ne mesure pas le framerate.

| Mesure | v14 | v15 |
|---|---|---|
| Génération froide (ms) | 159.12 / 268.32 | 157.43 / 225.20 |
| Préparation architecture Three (ms) | 33.90 / 53.07 | 37.15 / 52.00 |
| Calcul lumineux CPU (ms) | 27.14 / 62.26 | 31.09 / 65.32 |
| Montage Rapier (ms) | 10.24 / 14.85 | 10.63 / 16.00 |
| Triangles | 15434.00 / 20786.00 | 15434.00 / 20786.00 |
| Colliders | 962.00 / 1363.00 | 997.00 / 1292.00 |
| JSON (MiB) | 1.82 / 2.62 | 1.87 / 2.47 |

Les parois et entrées réelles augmentent légèrement la préparation graphique
et le calcul lumineux. Le gain recherché sur les aperçus vient du chargement
différé des détails, de la réutilisation des plans et de l’étalement du montage,
sans mesure GPU permettant de promettre un gain de FPS. Le cache CPU est borné ;
le heap JS ne comprend pas les allocations WASM ou GPU.


## Reproduction et limites

`npm run test:vertical`, `npm run audit:transitions` et `npm run audit:vertical`
rejouent les corpus. Les données et seeds sont dans `atrium-checks.json`,
`atrium-integration.json`, `atrium-diversity.json`, `atrium-before.json` et
`atrium-after.json`. La commande de repérage des nouvelles galeries chargées est
`/locate galerie-en-gradins` ; `/logs` et `/geometry uv|volumes|off` restent disponibles.

Le service de prévisualisation supervisée reste indisponible :
`/tmp/sites-previewd/requests` est absent. Les contrôles CPU ne prouvent ni
l’aspect final WebGL, ni la fluidité GPU, ni l’absence de toute apparition tardive
en tournant rapidement. La capture ne fournit pas le seed et la pose nécessaires
pour reproduire exactement sa salle. Le contrôle visuel en jeu reste à effectuer.
