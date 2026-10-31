# Transitions et volumes intégrés — version 18

Les salles ordinaires conservent le BSP historique, ses murs épais et ses
matériaux. Les coordonnées de story restent des adresses, pas un sol par défaut.

## Enveloppe des transitions

`TransitionLayout` réserve un tracé canonique avant le BSP : largeurs 4 / 4,8 /
5,6 m, volée unique majoritaire ou vrai palier, dénivelés partiels. Les centres
restent espacés d'au moins 49 m, avec au plus une transition sélectionnée par
cellule. Les deux moitiés partagent leur `linkId`, dimensions et datum médian.
Une grande salle ouverte partage une composition canonique sur tout son district :
un seul relief proposé, au plus deux accès distants d'au moins 98 m. Ce budget
précède les réservations, s'applique des deux côtés et ne modifie pas le BSP.

`SpatialTemplates` interroge les mêmes domaines BSP de 224 m que la génération,
y compris à travers un chunk. `TransitionLayout.roofPolicy` choisit avant
matérialisation une des trois enveloppes, appliquée par `TransitionSurfaces` :

- `room` conserve le vrai plafond plat, seulement si les pièces recoupées ont
  un plafond uniforme et assez de dégagement sur les deux moitiés. Les chants
  entre deux plafonds différents sont fermés au-dessus du passage.
- `upper-slab` perce le plafond local. La sous-face du vrai sol du propriétaire
  supérieur couvre la volée. Aucun toit indépendant n'est rendu ou simulé ici.
  La dépendance physique supérieure est explicite ; `OpenTransitionEnvelope`
  ferme le plénum de la dalle de pièce, sans remplir le vide de la circulation.
- `flight` conserve un toit propre pour une transition réellement encloisonnée.
  Il raccorde les vrais plafonds aux extrémités et leur moyenne canonique au joint.

Le dégagement minimum reste 2,74 m, plus de 2,50 m sur marches et luminaires.
La sous-face réelle tient compte de l'épaisseur normale de chaque dalle.
Les marches sous une dalle supérieure en marches gardent un profil de plafond
par marche ; leur luminaire se place sous l'approche plate. Les rampes ouvertes
gardent un panneau parallèle à la vraie sous-face supérieure. Métadonnées,
éclairage, collisions et rendu ne doivent pas dépendre d'un toit supprimé.

La couverture des murs parallèles des deux extrémités décide si la volée est
ouverte, adossée à un seul côté ou réellement encloisonnée. Elle vient du BSP
canonique de story zéro, pour conserver la même colonne structurelle entre
propriétaires verticaux. Aucun portique autonome ni jambage n'est ajouté à
l'approche. Les murs requis conservent leurs appuis et leurs bandes disjointes.

La coupe du plafond réserve la vraie épaisseur des murs seulement sur les
côtés qui en ont besoin ; l'approche ouverte garde une coupe exacte. Les vues
latérales préchargent le vrai niveau inférieur, sans inventer de plancher sous
une ouverture verticale.

## Décrochements et reliefs

`CeilingEnvelope` raccorde les chants des plafonds bas au plafond haut réellement
adjacent, sur un même datum. Un solide en plâtre ferme le décroché, avec les
mêmes sommets pour Three et Rapier. Les murs existants sont soustraits et les
bandes par propriétaire ne se chevauchent pas. Les puits, passages hérités,
atria et frontières entre datums gardent leur contrat propre.

Les monticules et terrasses modifient seulement leur pièce hôte. Métadonnées,
plafonds et luminaires y suivent la même hauteur ; les pièces voisines ne sont
plus modifiées par simple recouvrement de cellule. Les socles pleins, accès
uniques/opposés et terrasses restent présents.

## Conservation

Les atria classiques et en gradins gardent leurs phases, profondeurs et
escaliers facultatifs. `AtriumEnvelope` conserve leurs retraits, passages et
soubassements réels jusqu'au bas. Les anciens `grid-pit`, `PassageHole`, brèches,
passages accroupis, portes et monuments epic1–5 ne sont pas simplifiés.

Le rendu garde `FaceExposure`, les UV monde, les buffers transférés depuis le
worker, le cache CPU borné et la promotion des détails à l'approche. Le champ
régional conserve ses raccords entre chunks et son chemin à deux lectures pour
une seule couche. Les diffuseurs blancs HDR et le rig moderne sont réglés
séparément de la teinte des surfaces et des blackouts.

## Validation

Les tests vérifient les profils, meshes finaux, contacts Rapier, panneaux,
coutures et plusieurs propriétaires. Les audits multi-seeds conservent leurs
objectifs de diversité et de connectivité. Les mesures de montage CPU ne
mesurent ni les uploads GPU ni les FPS. Si l'aperçu WebGL est indisponible,
aucune validation visuelle n'est revendiquée.
