# Géométrie et matériaux

`WorldView` dans `src/render/WorldBuilder.ts` consomme un plan local :

- géométries statiques fusionnées par matériau ;
- gaines profondes doublées de moquette à l’intérieur, mais enclos des étages
  traversés rendus avec le papier peint ordinaire pour rester architecturaux ;
- volumes monumentaux dérivés de `EpicStructureFeature`; leurs rangées de
  passages sérialisées construisent de vraies ouvertures, plateformes et
  previews de couloir, tandis que toute partie accessible partage ses mesures
  avec les colliders ;
- `epic1` rend quatre stories au-dessus et une profondeur finie de stories sous
  le joueur. Un plafond ferme la rangée supérieure ; une brume spatiale apparaît
  après quelques rangées puis devient opaque bien avant la terminaison finie du
  décor, sans collision ni bulle centrée sur le joueur. L’étage actif ouvre ses
  couloirs à hauteur de bureau (2,66 m) jusqu’aux chunks
  voisins. Dans une fenêtre verticale de trois stories, seules quatre entrées
  latérales proches du point d’arrivée reçoivent une petite pièce, son plafond
  et un luminaire ; les autres sont des panneaux en retrait. Une sous-face en
  papier peint ferme le haut de chaque portail, légèrement sous le plafond de
  dalles afin que les deux matériaux ne soient jamais coplanaires. Les caps
  horizontaux des murs sont supprimés pour ne jamais se superposer à
  la corniche, au sol ou au plafond d’un couloir. Les corniches et façades se
  resserrent vers le bas ; quatre murs sans caps soutiennent chaque décroché et
  la dernière rangée garde son ouverture. Seul un aperçu détaillé ajoute du sol
  derrière son portail. La brume utilise des nappes fusionnées, un bruit FBM à
  deux octaves et une dérive lente ancrée dans le monde. Les plafonds génériques
  de pit et de salle haute sont désactivés
  dans ce chunk : les rangées propres à `epic1` restent visibles vers le haut ;
- `epic3` relie toutes les ouvertures inspectables d’une même façade à une
  galerie Backrooms continue. Des cloisons partent du mur extérieur mais
  conservent une voie longitudinale libre près des portails : aucune entrée
  accessible ne se termine en cul-de-sac. À l’étage zéro, seul le sol principal
  rend la moquette ; le builder ne le duplique jamais dans la preview. Les caps
  horizontaux des façades et cloisons sont retirés pour éviter le blinking aux
  seuils. Les luminaires restent hors du volume du gouffre et sont ancrés sous
  le plafond réel de la galerie. Hors de la fenêtre verticale inspectable, un
  panneau en retrait ferme les ouvertures lointaines. Deux nappes de brume
  procédurales séparées masquent le haut et le fond du gouffre. Chaque nappe
  reste un mesh fusionné et le shader se limite à deux octaves de bruit ;
- `epic5` reste sur le chemin de rendu ordinaire des murs et du plafond. Ses
  luminaires ont tous `ceilingY` sur le plafond réel, sans panneau lumineux
  décoratif ou hauteur aléatoire supplémentaire ;
- les escaliers inter-étages rendent des contremarches minces et une sous-face
  inclinée texturée, jamais des marches remplies jusqu’au sol. Les marches d’une
  volée droite touchent les deux parois latérales de la cage, sans vide décoratif.
  Les murs d’une
  preview s’arrêtent à son vrai plafond ; la cage réelle habille seule le
  plénum. Ses extrémités ferment la bande entre le plafond bas et la dalle haute
  sans obstruer les baies praticables des deux stories. Les luminaires de preview
  doivent rester entièrement hors de l’ouverture. Un plancher percé conserve
  une sous-face visible depuis la story inférieure et les ouvertures d’escalier
  ferment les quatre chants de dalle. Pour une preview d’étage, le sol, sa
  sous-face et ses chants s’arrêtent tous sur les limites exactes de la cage :
  aucun liseré de plafond ne doit dépasser à l’intérieur de l’escalier. Le
  plafond de preview supérieur garde la même ouverture et ses luminaires restent
  horizontaux, orientés vers la pièce : leur dos est invisible depuis le haut ;
- plafonds bas des `squeeze-view` construits sur `passageRects` quand ce champ
  existe, afin qu’un passage en L ou en T ne couvre pas son rectangle englobant ;
- éléments répétitifs en `InstancedMesh` ;
- éclairage fluorescent et blackouts spatiaux produits par `ZonalLighting.ts` ;
- graffitis procéduraux via `WallGraffiti.ts` ;
- portes de bureau articulées via `WorldDoors.ts` ;
- props asynchrones via `WorldProps.ts`.

Chercher la méthode `build…` correspondant à la feature. Ne pas lire tout
`WorldBuilder.ts`. Les helpers du début du fichier gèrent notamment les caps et
la soustraction de rectangles.

Les plafonds BSP bas gardent leurs vraies hauteurs. `CeilingEnvelope` ferme
leurs chants exposés jusqu'au toit haut voisin, avec un solide en plâtre et son
collider. Les retours s'arrêtent sur les murs existants ; ils ne remplissent ni
les puits ni les passages hérités. Leurs bandes verticales ne se recouvrent pas.
Les coins colinéaires des polygones découpés et les extrémités de wedges à
hauteur nulle n'émettent pas de triangles GPU dégénérés.

### Diagnostic visuel

Dans les retours du projet, **blinking** signifie **z-fighting** : deux faces
coplanaires (par exemple un cap de mur et un sol) alternent à l’écran lorsque la
caméra bouge. La correction attendue est de retirer ou soustraire la face
redondante, pas de lui appliquer un décalage arbitraire.

### Règles de rendu

- Préférer une géométrie fusionnée ou instanciée à un `Mesh` par module.
- Réutiliser les `MaterialSet`; cloner seulement pour une variation réellement
  propre au chunk ou à la feature.
- En mode moderne, tout matériau cloné pour une porte, un prop, un graffiti ou
  une preview doit conserver ou recevoir le décorateur zonal du chunk. Le mode
  classique laisse portes, props et graffitis au pipeline PBR historique.
- Les plafonds et sols troués doivent être construits par soustraction de
  rectangles, sans faces coplanaires de réparation qui se chevauchent.
- Pour un puits, la face intérieure texturée de chaque paroi tombe exactement
  sur la limite du rectangle d'ouverture : le centre de la paroi est donc
  décalé vers l'extérieur d'une demi-épaisseur. La sous-face du plafond s'arrête
  sur cette même limite et aucun cap horizontal ne recouvre la couture.
- Les jupes latérales des rampes suivent la pente avec des rideaux verticaux,
  sans cap supérieur : le tapis déborde déjà sur la couture et deux surfaces à
  cet endroit provoquent du z-fighting.
- Les volées hautes d’`epic4` ajoutent une sous-face en papier peint,
  décalée de 18 cm sous la pente. Leurs côtés sont de minces fascias suivant la
  pente, jamais des rideaux triangulaires descendant à la base de la volée. Un
  palier sépare obligatoirement sa moquette supérieure, sa tranche en papier
  peint et sa dalle de plafond inférieure ; un luminaire de palier s’attache à
  cette dalle et ne doit jamais apparaître sous une face en moquette.
- Tout plafond au-dessus de la ligne des murs utilise le même albédo, la même
  émission et le même fog que les plafonds ordinaires. Seul son rendu double
  face diffère afin qu’il reste visible depuis les passages verticaux.
  Les plafonds de preview verticale modulent aussi leur émission avec la texture
  de dalles afin que le plafond reste lisible en regardant depuis l’étage bas.
  À partir de 18 m, la variante distante réduit uniquement l’échelle UV des
  dalles en fonction de la hauteur, sans renforcer leur luminosité.
- Les fragments de coque haute gardent leurs faces d’extrémité : leur retrait
  produit des fentes verticales noires aux raccords. Leur base rejoint exactement
  le sommet du mur bas pour ne laisser aucune fente horizontale ; le plafond bas
  voisin est soustrait sous l’empreinte réelle de la coque, dont la sous-face
  masque la jonction sans devenir coplanaire avec les dalles.
- Les parois des passages accroupis gardent leurs plinthes. Une
  `baseboardlessZone` ne retire que la portion de plinthe située sur la face du
  mur qui regarde réellement dans cette zone ; un simple contact d’extrémité ou
  la pièce située de l’autre côté du mur ne doivent jamais perdre leur plinthe.
- `SpatialBaseboards` construit les bandes sur les faces verticales exposées des
  solides finaux, au profil du vrai sol et de l’union de ses fragments. Les rampes
  utilisent leur plan affine, même loin de l’origine. La finition vient de la pièce canonique,
  avec exclusions partielles par face via `BaseboardZones`, partagé avec le rendu
  historique. Les angles compatibles ont une coupe d'onglet ; aucune rallonge
  arbitraire n'est ajoutée aux extrémités historiques. Les plinthes restent sans
  collision et regroupées dans le même lot de matériau.
- `SpatialPrism.openFaces` omet les contacts mur/sol et les onglets internes des
  plinthes, ainsi que leurs caps de coupe sur les coutures de propriétaire.
  `FaceExposure` et le builder respectent ces faces omises : aucune soustraction
  ni émission de triangles pour ces contacts déjà connus. Les extrémités visibles
  restent fermées ; les vrais chants de dalle et autres volumes sont inchangés.
- La sous-face rendue d’un `upper-portal-lintel` rejoint exactement le plafond
  bas. Elle prolonge le matériau et les UV du plafond lorsqu’une pièce adjacente
  reste basse ; entre deux pièces hautes, elle conserve le papier peint du mur.
  Un groupe de linteaux contigus traversant un angle de district emploie le
  plafond sur toute sa portée dès qu’un de ses fragments borde une pièce basse,
  afin de ne pas créer un double renfoncement. Les surfaces restent disjointes
  et coplanaires, sans marche ni clignotement.
- Une géométrie visible depuis un étage voisin doit avoir les faces/caps
  nécessaires ; ne pas compter uniquement sur le back-face culling.
- Toute nouvelle ressource détenue par `WorldView` doit être libérée dans
  `dispose()`.

Retour au [routeur runtime](RUNTIME_RENDERING.md).
