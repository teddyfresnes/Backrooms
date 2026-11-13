# Transitions et volumes intégrés — version 20

Les salles ordinaires conservent le BSP historique, ses murs épais et ses
matériaux. Les coordonnées de story restent des adresses, pas un sol par défaut.

## Enveloppe des transitions

Les datums de district valent des multiples de 0,9 m sur cinq niveaux
(`DATUM_QUANTUM`, `RegionalPlan.regionalDatum`). Deux districts voisins sont de
plain-pied ou séparés d'au moins 0,9 m : aucun raccord n'existe pour quelques
centimètres, et aucune volée ne quitte la bande de son propre étage.

`TransitionLayout` fixe d'abord la pente puis en déduit l'emprise : giron de
30 cm, contremarches de 15 à 17,5 cm (30,3° au plus), rampe à 1:8 seulement
pour une demi-montée d'au plus 0,9 m. L'emprise est ancrée sur la couture :
palier facultatif de 1,6 m par moitié, volée, approche de 2,2 m. Largeurs
4 / 4,8 / 5,6 m. Les centres restent espacés d'au moins 49 m, avec au plus une
transition par cellule. Les deux moitiés partagent `linkId`, finition,
enceinte, toit et datum médian, tirés d'un même flux par paire de cellules.

Marches, rampe et palier sont une seule masse pleine (`support: 'solid'`) qui
porte sur le sol le plus bas de sa moitié : podium côté bas, fond de tranchée
côté haut. Aucun giron ne flotte, aucun flanc ne montre le vide.

- Enceinte `chamber` / `wall` : murs pleins hors de l'emprise, sur toute la
  bande d'étage de leur moitié. Côté ouvert d'une tranchée : parapet de 1,05 m
  pris sur 20 cm d'emprise. Un dénivelé total de plus de 1,8 m est toujours
  encloisonné.
- Toit `room` : un seul plafond plat à la hauteur du district haut.
- Toit `upper-slab` : un puits plat sous la dalle suivante du district bas
  (5,21 m). La dalle n'est pas percée et aucun autre étage n'est requis.
- Toit `flight` : toit parallèle à la volée, toujours encloisonné, extrémités
  plates au-dessus de l'approche et du palier.

`CeilingEnvelope` ferme les décrochements entre ces plafonds et ceux des pièces
voisines. Le dégagement minimum reste 2,74 m. Le luminaire d'un toit incliné
se place sous l'approche plate. Une transition ne publie plus de dépendance
verticale : métadonnées, éclairage, collisions et rendu viennent du seul plan
propriétaire.

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
