# Escaliers isolés, plafonds et appuis — v14

Validation du 22 octobre 2026. Référence v13 :
`e3cc6a462a152a66c68c7b48915dc46ab67a319b`.
Les résultats v13 précédents restent dans `TRANSITION_VALIDATION.md`.

## Corrections vérifiées

- Les raccords régionaux sont sélectionnés avant le BSP, sans modifier les
  datums, le tirage des districts, le BSP historique ou les profils lumineux.
  Au plus une cage touche une cellule ; les centres sont espacés d’au moins
  49 m. Les frontières refusées sont fermées des deux côtés, sans fausse entrée.
- Les deux moitiés canoniques peuvent former une seule volée continue.
  L’alternative garde un vrai palier intermédiaire. Les monticules proposent
  une seule rampe ou une paire opposée symétrique ; leurs supports restent pleins.
- Le profil régional réserve 3,8 ou 4,05 m. Les rayons sur les géométries finales
  vérifient plus de 3,6 m au-dessus des marches sur toute la largeur utile,
  sans plafond ordinaire traversant la cage. Les autres gabarits sont conservés.
- Les murs de cage ont des bases verticales. Des bandes contiguës possédées
  par les adresses verticales ferment toute la hauteur chargée sans doublon.
  Les entrées latérales possèdent des piédroits, et le linteau frontal rejoint
  ces appuis. Les coques hautes importées sont recoupées sur leurs vrais supports
  après toutes les réservations et portes ; un linteau sans appuis est retiré.
- Le diagnostic initial retrouvait des recouvrements entre murs BSP, façades
  et garnitures. La soustraction des faces rectangulaires coplanaires conserve
  le plan et la phase UV, sans polygon offset. Le test de huit plans complets
  ne retrouve aucun recouvrement positif entre ces faces de même normale dans
  les lots finaux. Cela ne constitue pas un test de scintillement GPU.
- Les quatre coins des diffuseurs suivent le toit réel à 3,6 cm sous sa
  sous-face. Intensités, champ fluorescent et coefficients lumineux sont conservés.

## Résultats

| Contrôle | Résultat |
|---|---|
| Suite générale `npm test -- --maxWorkers=2` | 578/579 ; les 89 tests verticaux passent |
| Tests des personnages, vrais FBX/Three/Rapier | 638/639 ; voir l’échec détaillé ci-dessous |
| TypeScript et builds Vite du dépôt et du Site | Réussis |
| Audit transitions : 64 seeds fixes + 32 de contrôle | 96 plans, 1 442 liens externes, 90 trous sources, 85 reliefs, aucune erreur |
| Audit UV des prismes réellement découpés | 843 194 triangles, aucun UV dégénéré |
| Audit de distribution et huit voisinages 5×5 | 328 plans, 1 086 portails, aucun dégagement invalide, isolation déclarée ou couture incohérente |
| Garde-robe hébergé après finalisation du build | 148 OBJ présents et 148 fichiers de vêtement vérifiés sans perte |

Sur les 204 demi-raccords observés : **169 continus (82,8 %)** et 35 avec palier.
Les 44 monticules comprennent **30 accès uniques** et 14 paires opposées.
La longueur d’une demi-volée varie de 2,6 à 8,17 m. Les marches absorbent les
fortes pentes ; les rampes conservent leur limite de 0,40. La part des empreintes
de pièces BSP ordinaires parmi les empreintes BSP/halls admissibles reste à
79,2 % ; ce n’est pas une mesure de toute la surface du monde.

Les tests physiques parcourent les volées complètes à pied et en course,
vérifient arrêt et inversion sur rampe, passage sous linteau, sauts, chutes,
chargement/déchargement et un trajet multichunk de plus de 700 m. Le suiveur
de test tourne à l’intérieur des polygones praticables pour respecter le rayon
de la capsule aux limites artificielles de leur découpage. Les portes sont
ouvertes explicitement. Les contrôles d’ouverture excluent les contacts avec
les marches, vérifiés par les véritables traversées avec autostep.

Deux échecs hors du code modifié restent signalés :

- `ImportedApartmentIntegration` attend `ImportedApartmentScene_v1.19.2`,
  mais le fichier contient `russian_cigarette_pack(1).glb`. Le même test ciblé
  échoue à l’identique sur le snapshot v13 ; asset et assertion sont inchangés.
- `crouch-locomotion-integration`, première personne à 120 Hz : variation
  d’articulation `backward,left` de 0,193 rad pendant la suite complète et de
  0,184 rad dans le fichier isolé (20/21). Ce problème était déjà observé dans
  le rapport v13. Le fichier passe 21/21 sur le snapshot v13 pendant ce contrôle ;
  les essais ne permettent donc pas d’annoncer une suite personnage entièrement verte.
  Le personnage, le contrôleur, la physique et ce laboratoire
  de test ne sont pas modifiés ; aucune tolérance n’a été relâchée.

## Coûts CPU comparés

Snapshots v13/v14 exécutés successivement, sans tests ni builds concurrents,
avec le même Node et les mêmes 24 seeds. Valeurs médiane / P95 du chunk infini
froid, architecture sans props ni GPU. Les lots de matériaux ne sont pas des
draw calls mesurés ; le heap JS exclut la mémoire WASM et GPU.

| Mesure | v13 | v14 |
|---|---|---|
| Génération froide | 208.32 / 287.87 ms | 172.03 / 246.45 ms |
| Préparation architecture Three | 28.64 / 60.66 ms | 35.69 / 59.48 ms |
| Calcul lumineux CPU | 38.61 / 94.07 ms | 30.34 / 71.75 ms |
| Montage Rapier | 15.05 / 21.58 ms | 11.27 / 18.67 ms |
| Triangles | 19100.00 / 25056.00 | 15434.00 / 20786.00 |
| Colliders | 1405.00 / 1901.00 | 962.00 / 1363.00 |
| JSON (MiB) | 2.47 / 3.38 | 1.82 / 2.62 |

La suppression des faces coplanaires augmente la préparation Three, tandis que
les raccords plus rares réduisent les colliders, le poids du plan et le travail
de génération. Les jeux de données complets sont dans `stair-fix-before.json`
et `stair-fix-after.json` ; les valeurs ne prédisent pas le framerate navigateur.

## Reproduction et limites

Lancer `npm run test:vertical`, `npm run audit:transitions` et
`npm run audit:vertical`. Les données et seeds sont dans
`stair-fix-checks.json`, `stair-fix-integration.json` et `stair-fix-diversity.json`.
Les anciennes familles apparaissent dans la distribution normale : escaliers
L/U, galeries, passerelles, ouvertures hautes, passages accroupis et anciens trous.

Exemples locaux en story 0, chunk `(0,0)` : escalier régional sur
`REGIONAL-AUDIT-0` près de `(-53.10, 1.30, -42)` ; rampe régionale sur
`REGIONAL-AUDIT-2` près de `(52.05, 2.82, -14)`. Les positions sont des centres
de repères, pas une promesse de spawn. `/locate`, `/logs` et `/geometry uv|volumes|off`
restent les outils de diagnostic du jeu.

La capture fournie ne contient pas le seed et la pose nécessaires pour
reproduire exactement sa pièce. Le service de prévisualisation supervisée est
indisponible (`/tmp/sites-previewd/requests` absent). Les tests vérifient les
géométries CPU et Rapier ; ils ne valident ni l’aspect final WebGL, ni les shaders,
ni les performances GPU. Le contrôle visuel en jeu reste à effectuer.
