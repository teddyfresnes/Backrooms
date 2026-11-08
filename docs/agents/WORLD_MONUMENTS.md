# Monuments historiques

Contrats du pipeline historique dans `EpicStructures.ts`, conservé par les
propriétaires monumentaux du monde régional.

- Le pavage épique utilise des supercellules 32×32 dépendantes du seed. Chacune
  tire encore cinq slots, mais seuls `epic1`, `epic2`, `epic4` et `epic5` y sont
  construits : le slot `epic3` est retiré. Les huit slots candidats, leurs
  transformations et leur marge garantissent qu’aucun epic ne touche un autre,
  même en diagonale ou sur une couture de supercellule.
- `epic3` est la faille : toute la rangée `EPIC3_RIFT_CHUNK_Z` (−4, ≈ 450 m au
  nord de l'origine, là où pointe la boussole) sur tous les x et tous les étages.
  `epicStructureIndexForCoord` la classe avant le pavage ; les rangées voisines
  (±1) restent ordinaires (halo), et `getNearestEpicStructureCoord(…, 3, o)`
  rend `{ x: o.x, z: −4, story: o.story }`.
- Le slot horizontal ne dépend pas de l’étage : les grands volumes restent
  cohérents verticalement. Dans `epic1`, chaque story absolue dérive toutefois
  sa propre rangée de passages. Le plan sérialise quatre rangées au-dessus et
  dix-sept en dessous ; chaque rangée à ±5,4 m doit être identique au plan
  réellement monté lors du hand-off vers cette story.
- `epic1.voidBounds` couvre un peu plus de 90 % du chunk. Sa
  `passageFacadeBounds`, légèrement plus grande, porte les ouvertures ; l’espace
  entre les deux forme la corniche continue sur laquelle une chute peut
  atterrir. `funnelStoryOffset` ancre le profil sur la story logique absolue :
  l'aperçu à ±5,4 m et le chunk monté après hand-off gardent donc exactement la
  même section. `getEpic1FunnelStoryBounds` réduit progressivement la façade,
  la corniche et le vide des rangées inférieures. La corniche suivante dépasse
  encore légèrement le mur de soutien de la rangée précédente ; la dernière
  rangée ne reçoit aucun cap et conserve donc le trou. Sur l’étage inférieur
  préchargé, corniche, façade, couloirs et premier mur de soutien publient des
  colliders cohérents avec ce profil.
- Sur l’étage actif d’`epic1`, `getEpicAbyssThroughPassageLayout` prolonge chaque
  entrée jusqu’à une porte canonique identique dans le chunk voisin. Ces
  passages utilisent la hauteur de bureau partagée `EPIC1_PORTAL_HEIGHT`
  (2,66 m), y compris pour les murs et plafonds physiques. Les rares
  entrées proches prévisualisées utilisent `getEpicAbyssRoomPreviewLayout` pour
  montrer une petite pièce fermée ; les entrées lointaines restent de simples
  panneaux en retrait. La couronne s’arrête à `passageFacadeBounds` ; au niveau
  actif, seuls les vrais couloirs la prolongent jusqu’aux bords du chunk, et sur
  les niveaux prévisualisés seuls les aperçus détaillés reçoivent un sol.
- Chaque segment `epic3` mesure exactement 112 m : vide, façades et galeries
  vont de couture à couture (aucun mur de bout, ni rendu ni collider, ni puits
  latéral) et `WorldStream` monte normalement les segments voisins. Les paires
  de portails face à face suivent `EPIC3_LANES` (tous les 14 m, donc continues
  d'un segment à l'autre). Derrière chaque façade, `getEpic3BackroomsGalleryLayout`
  construit une galerie de 8,5 m ; sur l'étage marché seulement, son mur du fond
  est percé d'une porte face à chaque portail (`EPIC3_DOORWAY_LANES`, linteaux
  compris dans le rendu et les colliders) vers `getEpic3ApproachLayout` : deux
  halls bas qui remplissent le chunk jusqu'à ses bords. Cloisons et piliers sont
  isolés dans des cellules entre les voies : ils ne coupent jamais une porte ni
  une entrée de chunk, et un couloir droit de ±`EPIC3_LANE_CORRIDOR_HALF_WIDTH`
  reste libre dans l'axe de chaque voie jusqu'au fond du hall (ligne de vue à
  travers les deux portails, utilisée par la créature). Il n'y a pas de rangée
  d'arrivée surélevée (`entryLevel` 0). Lumières de galerie hors de `voidBounds`
  sous le plafond à 3,35 m, celles des halls à `wallHeight`. Les bandes de façade
  sont empilées sans faces horizontales : chaque portail reçoit un seuil et une
  sous-face fines sur l'épaisseur du mur (sinon le vide se voit par une fente au
  bord, sous l'appui de la planche). `isInsideEpicStoryVolume` est semi-ouvert en
  x pour qu'un seul segment épingle le streaming sur une couture. Des panneaux
  sombres et brumeux ferment le haut et le bas : la faille paraît sans fin (le
  runtime assombrit aussi le brouillard près d'elle). `RiftWorld.test.ts` vérifie
  classement, continuité, couloirs d'axe et accès par flood-fill jusqu'à chaque portail.
- `epic4` dérive ses volées, paliers, ouverture sommitale et petit labyrinthe
  supérieur de `getEpicStairwellLayout`; le rendu et Rapier consomment ce même
  tracé. `applyEpicStructure` conserve le labyrinthe ordinaire hors de la zone
  d’approche et garde un sol de chunk continu autour de cette tour compacte.
- `epic5` construit ses longues cloisons et leurs linteaux avec
  `getEpicConcourseWalls`. Ces `WallSegment` standards alimentent directement le
  rendu zonal et les colliders ; ne pas recréer une seconde géométrie
  décorative indépendante.

Retour au [guide de génération](WORLD_GENERATION.md).
