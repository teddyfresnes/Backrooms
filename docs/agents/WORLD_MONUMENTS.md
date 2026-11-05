# Monuments historiques

Contrats du pipeline historique dans `EpicStructures.ts`, conservé par les
propriétaires monumentaux du monde régional.

- Le pavage épique utilise des supercellules 32×32 dépendantes du seed. Chacune
  contient exactement `epic1`, `epic2`, `epic3`, `epic4` et `epic5`, soit
  5 chunks monumentaux sur 1024. Les huit slots candidats, leurs transformations
  et leur marge garantissent qu’aucun epic ne touche un autre, même en diagonale
  ou sur une couture de supercellule.
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
- `epic3` est une faille longue de 220 m : `passageFacadeBounds` place deux
  façades intérieures symétriques et `voidBounds` les rejoint, sans corniche
  longitudinale ni rebord aux extrémités. Derrière chaque façade,
  `getEpic3BackroomsGalleryLayout` construit une galerie commune de 8,5 m de
  profondeur. Toutes les entrées d’une rangée partagent son sol praticable ;
  les cloisons intermédiaires laissent une voie continue près de la façade.
  L’étage zéro et l’étage d’arrivée publient les mêmes sols et murs dans les
  colliders. Les luminaires de ces deux rangées sont obligatoirement hors de
  `voidBounds` et utilisent le plafond de galerie à 3,35 m.
- `epic4` dérive ses volées, paliers, ouverture sommitale et petit labyrinthe
  supérieur de `getEpicStairwellLayout`; le rendu et Rapier consomment ce même
  tracé. `applyEpicStructure` conserve le labyrinthe ordinaire hors de la zone
  d’approche et garde un sol de chunk continu autour de cette tour compacte.
- `epic5` construit ses longues cloisons et leurs linteaux avec
  `getEpicConcourseWalls`. Ces `WallSegment` standards alimentent directement le
  rendu zonal et les colliders ; ne pas recréer une seconde géométrie
  décorative indépendante.

Retour au [guide de génération](WORLD_GENERATION.md).
