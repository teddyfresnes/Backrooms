# Transitions et volumes intégrés — version 15

Les salles ordinaires conservent le BSP historique, ses murs épais et son
éclairage. Les transitions et les salles à plusieurs hauteurs sont composées
avant leurs réservations ; leurs surfaces finales alimentent Three et Rapier.

## Causes corrigées

- `TransitionLayout` décrit une chambre, une approche et un seul profil de toit
  par volée. Le dégagement régional passe de 3,05 m à 3,8 ou 4,05 m ; la coupe
  du plafond ordinaire inclut toute l’épaisseur des murs de la cage.
- Les raccords entre datums différents sont sélectionnés avant les réservations :
  un maximum par cellule et au moins 49 m entre centres. Une frontière non
  sélectionnée garde sa façade fermée. Les passages à même datum sont conservés.
- Les deux moitiés canoniques d’un raccord partagent `linkId`, composition et
  gabarit. Environ 80 % demandent une seule volée continue ; les autres ont un
  vrai palier intermédiaire. Les grands dénivelés imposent la volée continue.
  Une couture de chunk ou de cellule ne crée pas un deuxième escalier.
- La largeur, la longueur et le revêtement de la volée variaient peu. Les
  chambres mesurent 4 / 4,8 / 5,6 m de large ; leurs parois mesurent 0,6 à
  1,05 m. Le choix rampe/escalier dépend du dénivelé et de la longueur disponible.
- Les approches plates de 2,2 m ont des entrées latérales de 1,6 m entre vrais
  piédroits. Un linteau frontal ferme le changement de hauteur du plafond.
  La façade est découpée selon la largeur réelle du raccord, sans bande basse
  traversant une volée continue à la couture.
- Les parois de cage sont des bandes verticales porteuses contiguës de 5,4 m,
  possédées sans chevauchement par les adresses verticales. Les dépendances
  chargent toutes les bandes nécessaires du point bas au toit. Aucune base
  diagonale ne laisse une pointe de mur suspendue au-dessus de la pièce voisine.
- Après les découpes et portes, `StructuralSupports` réduit les `upper-shell`
  aux murs porteurs réels. Un linteau garde ses deux appuis ou sa continuation
  canonique ; les fragments sans appui sont retirés du rendu et de la collision.
- Les hauteurs finales des marches échantillonnaient le milieu de chaque
  intervalle. La dernière marche atteint exactement la destination ; les
  contremarches restent au plus à 17,5 cm et les dalles de marche font 27 cm.
- Les coupes de navigation ignoraient certains prismes structurels. Le sol
  praticable est aussi retranché de leurs empreintes ; les petites bandes dans
  les murs ne sont plus considérées comme des pièces utilisables.
- Certaines portes épaisses conservaient une lacune de sol. Deux demi-seuils
  physiques couvrent leur ouverture, reliés conditionnellement par la porte.
- La projection UV par triangle pouvait écraser les caps inclinés. Une même
  face emploie une même projection ; la moquette retrouve 2,15 m par motif,
  le plafond 2,4 m et le papier peint 2,05 × 2,45 m.

## Contrats

`WorldPlan.version` vaut 15. Les champs ajoutés à `SpatialArchitecture` sont
optionnels pour la lecture des anciens plans ; la topologie reste compatible
avec la version 2. Les ancrages de sauvegarde sont recherchés puis vérifiés
contre le corps réel, avec le repli sûr existant.

`TransitionLayout` porte l’emprise, les extrémités, la largeur, le profil du sol,
le profil du toit et l’épaisseur des murs. La même description est utilisée pour
les réservations BSP, les surfaces praticables, les plafonds, les parois, les
luminaires et les diagnostics. Le toit n’hérite pas du nombre de marches.
La géométrie de colonne est commune aux propriétaires verticaux : une variation
aléatoire entre stories ne doit pas faire entrer un sol dans le toit précédent.
`regionalBaseAt` utilise ce même tracé pour son inverse de secours.

Les sols continuent de suivre les datums régionaux signés. Une transition peut
relier un dénivelé partiel ; la story logique ne fixe pas son altitude. Les rampes
sont limitées à une pente de 0,4, sans changement du contrôleur, du saut, de
l’autostep, de la gravité ou du tick fixe.

Les gabarits d’atrium réunissent une à quatre cellules : 28×28, 56×28, 28×56
ou 56×56 m, à l’intérieur d’un chunk. Le BSP ordinaire conserve ses domaines de
224 m et ses pièces traversant les chunks. Les couronnes font 2,7 à 4,8 m et les
circulations 2,4 à 3,8 m. Les volumes occupent une à trois différences d’adresse,
avec deux à quatre niveaux. Les galeries classiques peuvent garder un escalier
ou rester sans escalier ; les salles en gradins développent des anneaux successifs
sans escalier intérieur imposé. Chaque niveau plus bas avance vers le centre.
Les soubassements atteignent le vrai sol ; des passages de 4 m sous linteau les
traversent aux entrées canoniques. Les coins enfermés entre deux rampes pleines
et le soubassement sont comblés jusqu’au palier, sans faux sol utilisable dessous.
Une longue circulation peut être une
rampe droite ou en plusieurs tronçons. Les ponts sont placés avec un dégagement
réel au-dessus des volées ; les galeries en L peu profondes gardent leur couronne
sans ajouter un pont trop bas sur l’escalier.

Les paliers d’arrivée des chutes et escaliers possèdent des IDs stables et une
emprise propre, réservée avant le BSP. Leur découpage ne disparaît pas lorsqu’un
relief est ajouté au sol inférieur. Les relations dirigées référencent ces vrais
paliers, jamais une preview décorative.

`SpatialRelief` produit des monticules à une rampe (65 % des tirages) ou à deux
rampes opposées symétriques, ainsi que des terrasses successives.
Leurs surfaces ont `support: solid` et `supportBottom` au véritable sol porteur.
Les grands reliefs peuvent rejoindre 3,6 m dans un atrium ; les reliefs ordinaires
restent entre 0,4 et 1,2 m, sous un toit compatible avec le propriétaire suivant.
Les retours du plafond haut ferment le raccord au plafond ordinaire ; les
colonnes porteuses sont prolongées jusqu’au nouveau toit.

Les UV utilisent l’origine monde du propriétaire. Les quatre chunks d’un même
BSP partagent les échelles et la rotation de leurs motifs, tout en conservant les
teintes historiques des colonnes. La projection des sols inclinés reste
planimétrique, comme la référence historique ; elle assure la continuité au
palier plutôt qu’une nouvelle phase de texture à chaque marche.
`SurfaceExposure` supprime les chants complètement internes et la partie enfouie
des contremarches massives, sans retirer les sous-faces des ponts.
`PrismExposure` soustrait les recouvrements rectangulaires coplanaires de même
orientation entre tous les matériaux structurels, avant leur mise en lots.
Les fragments gardent la même phase UV monde ; aucun décalage de profondeur
ne masque les doublons. Les faces inclinées conservent leurs sommets exacts.
`CeilingFixture` incline chaque diffuseur selon le toit réel et place toute sa
face à 3,6 cm sous la sous-face, y compris sur les rampes. Le champ fluorescent,
les intensités et les coefficients des deux modes d’éclairage sont conservés.

Les cycles qui retirent tous les chunks reconstruisent l’index de requête Rapier
quand aucun collider d’environnement ne subsiste. Cela évite de réutiliser son
BVH vide au rechargement ; seul l’index natif est remplacé dans son enveloppe
partagée par les contrôleurs. Les corps, vitesses et réglages physiques sont conservés, et la synchronisation reste sur le tick prévu.

## Conservation des familles historiques

| Famille | Chemin ordinaire v15 | Conservation / adaptation |
|---|---|---|
| BSP, masses, niches, colonnes, portes | Présent | Helpers historiques, seuils et références de porte réconciliés |
| `epic1` à `epic5` | Colonnes monumentales protégées | Générateur legacy et helpers géométriques conservés |
| `grid-pit` | Réintégré | Même constructeur de motif ; sol réellement découpé, destination canonique |
| `squeeze-view` room-network | Réintégré | Propositions historiques, murs et plafonds bas matérialisés au datum réel |
| wall-breach / flush | Réintégré | Même proposition de brèche ; réservation contre le BSP avant matérialisation |
| Bosses de passage | Réintégrées | Solides ancrés au sol, rampes réelles, dégagement accroupi d’au moins 1,30 m |
| `PassageHole` / puits de passage | Réintégré | Trous physiques et destinations communes aux plans source/arrivée |
| Puits profonds | Présent | Enclos des propriétaires traversés ; vide de 54 m sous le seuil de récupération de 48 m |
| Anciennes zones surélevées | Vocabulaire conservé et étendu | Monticules massifs et terrasses, `raised-zone` cohérent avec les surfaces |
| Escaliers droits / L / U | Présent | Parcours régionaux explicites ; `StairLayout` legacy conservé pour les monuments et RAW |
| `RAW_LOCAL_` et ancienne vista finie | Chemin historique conservé | Aucun second pipeline ajouté par-dessus les plans régionaux |

`SpatialFeatures` choisit une colonne canonique avec propriétaire source, arrivée
et propriétaires traversés, indépendamment de leur ordre de génération. Ses
propositions réutilisent `buildGridPit`, `addSqueezeViews` et `addWallBreaches`.
Les colliders et previews à Y=0 des propositions historiques sont écartés ; leur
architecture est matérialisée à la bonne altitude dans le plan spatial.
Les anciens constructeurs visuels ne redessinent pas les features déjà spatiales.

Les ouvertures de sol et de plafond restent distinctes. Les propriétaires
intermédiaires ferment le groupe de puits dans un enclos de 60 cm ; le propriétaire
d’arrivée conserve son vrai sol et ouvre son plafond. Les sources de vide
s’étendent sur dix adresses, au-delà de la récupération du joueur ; ce volume est
borné, pas une simulation infinie de sous-sols.

Les pièces à feature sont réservées avant les partitions et les props. Les
propositions conflictuelles avec un monument, un changement de datum ou un atrium
sont refusées de manière déterministe. Les caches sont bornés à 32 domaines BSP
et 256 propositions, et vidés avec les caches du monde infini.

## Vérification et reproduction

`/geometry uv` affiche une grille de texture non éclairée ; `/geometry volumes`
affiche les volumes de dégagement en vert, les structures en orange et les
colliders en rose ; `/geometry off` restaure les matériaux et libère les ressources.
Les commandes `/locate` et `/logs` restent disponibles sans ajout d’interface au jeu.

Les tests de la volée vérifient les formules de raccord, le toit unique, la
hauteur des marches, le corps sur toute la largeur, le déterminisme entre
propriétaires et les IDs des vraies arrivées. Les tests UV utilisent des dimensions
connues et une face inclinée, en complément de l’équivalence des lots de géométrie.
Les essais physiques couvrent les passages accroupis, leurs bosses et une chute
réelle à travers un ancien puits sur plusieurs propriétaires.

`npm run test:vertical` comprend ces essais et les cycles de montage/démontage.
Les mesures, limites et reproductions sont dans
[STAIR_FIX_VALIDATION.md](validation/STAIR_FIX_VALIDATION.md) ; les résultats
v13 de `TRANSITION_VALIDATION.md` et v12 de `BSP_RESTORATION.md` restent des
références historiques.
Les salles à plusieurs anneaux et le streaming des aperçus sont vérifiés dans
[ATRIUM_VALIDATION.md](validation/ATRIUM_VALIDATION.md).
Le service de prévisualisation supervisée étant indisponible dans l’environnement
de réalisation, le rendu WebGL, les shaders, les draw calls et l’aspect final des
textures ne peuvent pas être déclarés vérifiés par ces tests CPU.
