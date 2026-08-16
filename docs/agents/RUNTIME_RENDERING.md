# Runtime, rendu et physique

## Streaming

`WorldStream` maintient les chunks actifs, les `WorldView` et les colliders
associés. Le voisinage normal est un 3×3 sur l’étage courant.

- Au démarrage, jusqu’à trois workers temporaires préparent les voisins.
- Ensuite, un worker persistant génère un chunk à la fois.
- Les destinations verticales sont préchargées près des puits et escaliers.
- Les volumes hauts de `epic2`, `epic3`, `epic4` et `epic5` épinglent leur
  story source au lieu de remonter tous les 5,4 m. Le runtime source est résolu
  depuis la position du joueur, y compris juste après une téléportation haute.
- `epic3` dépasse son chunk propriétaire sur l’axe longitudinal. Tant que le
  joueur est dans son volume, le streamer garde ce propriétaire comme centre et
  exclut ses voisins en x, dont les murs ordinaires couperaient la faille.
- `epic1` n’est jamais épinglé : seule la story immédiatement inférieure est
  préchargée en priorité à l’approche du gouffre. Chaque story montée prépare la
  suivante, sans rafale de trois générations, puis utilise le même hand-off à
  mi-hauteur que les pits.
  Au démontage, le dernier palier sûr conserve seulement son plan CPU ; le
  callback de chute le remonte immédiatement, sans régénération ni
  superposition des aperçus verticaux.
- Une transition d’étage est différée tant que le chunk cible n’est pas prêt.
- Sans `Worker`, un fallback synchrone reste disponible.

Le worker (`src/world/infinite.worker.ts`) calcule le `WorldPlan` sérialisable.
`WorldStream.mountChunk()` crée les matériaux zonaux puis applique l’offset monde
au groupe Three.js, au contexte shader et au lot de colliders. Le démontage doit
retirer les ressources visuelles et physiques.

`/locate epic1`, `/locate epic2`, `/locate epic3`, `/locate epic4` et
`/locate epic5` résout analytiquement l’occurrence la plus proche, même hors du
voisinage monté. Un worker auxiliaire prépare le plan hors du thread principal ;
le chunk central, sa vue et ses colliders sont ensuite montés
avant la téléportation. Pour `epic1`, le voisin nord visible depuis le point
d’arrivée est monté dans le même warmup ; les autres voisins rejoignent le flux
normal du streamer.
Pour `epic3`, seuls les voisins nord et sud restent montés pendant la visite.

## Construction visuelle

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
- Tout plafond au-dessus de la ligne des murs utilise un matériau texturé,
  double face et légèrement émissif, tout en gardant le même fog léger et le
  même décorateur zonal que les surfaces voisines.
  Les plafonds de preview verticale modulent aussi leur émission avec la texture
  de dalles afin que le plafond reste lisible en regardant depuis l’étage bas.
  À partir de 18 m, la variante distante renforce ce traitement et réduit aussi
  l’échelle UV des dalles en fonction de la hauteur.
- Les fragments de coque haute gardent leurs faces d’extrémité : leur retrait
  produit des fentes verticales noires aux raccords. Leur base rejoint exactement
  le sommet du mur bas pour ne laisser aucune fente horizontale ; le plafond bas
  voisin est soustrait sous l’empreinte réelle de la coque, dont la sous-face
  masque la jonction sans devenir coplanaire avec les dalles.
- Les parois des passages accroupis gardent leurs plinthes. Une
  `baseboardlessZone` ne retire que la portion de plinthe située sur la face du
  mur qui regarde réellement dans cette zone ; un simple contact d’extrémité ou
  la pièce située de l’autre côté du mur ne doivent jamais perdre leur plinthe.
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

## Lumière

`LightSlot` est une donnée de génération, pas une lumière Three.js. Les panneaux
non morts restent des émetteurs visuels ; le rendu des surfaces utilise un champ
fluorescent dans `ZonalLighting.ts`. Une clé directionnelle douce, sans shadow
map, révèle les normales et les coins sans réintroduire les bandes du bake.
Chaque chunk dérive aussi de ses panneaux et volumes une texture RG8 de 96² :
elle produit de larges nappes locales et une proximité structurelle très douce
aux contacts, sans rayon ni visibilité murale. Le shader effectue une seule
lecture par fragment et la texture doit être libérée avec le `WorldView`.

`WorldPlan.unlitZones` reste en coordonnées locales. Le shader évalue ces
rectangles depuis la position monde moins l’origine du chunk, avec un fondu aux
seuils, une portée réduite seulement dans le blackout et une garde verticale sur
la story active. Ne pas piloter une forte densité de fog depuis la seule position
du joueur : cela recréerait une bulle visible pendant les transitions.

En mode moderne, le post-traitement ne contient ni normal pass ni SSAO. Son
pipeline utilise bloom, tone mapping, grain, vignette et SMAA. Le mode classique
recrée le normal pass, le SSAO et les réglages de bloom historiques ; le composer
est reconstruit lors de la bascule.

`RussianStairwellGame` réutilise ce même `PostFX` et le même rig global jaune
(hémisphère, rebond ambiant et clé directionnelle) que le niveau Backrooms. Ses
néons, lampes d’appartement et éclairages extérieurs restent des sources locales.
Le réglage moderne/classique reconstruit aussi son composer et applique les
intensités globales correspondantes, sans recréer la scène statique.

`LightingMode` expose `modern` et `legacy` aux paramètres graphiques. Le mode
`legacy` restaure le pipeline antérieur à `e6d7e6a` : bake CPU de deux lightmaps
224² par chunk (surfaces générales et plafond), masque de surface dans le shader
et réglages de matériaux historiques. Les workers calculent le bake hors du
thread principal quand ils sont disponibles. `WorldStream.setLightingMode()`
reconstruit uniquement les `WorldView`, conserve plans, colliders et portes
ouvertes, garde les données du bake actif et publie une progression
`{ completed, total }` utilisable par le menu.

Les coordonnées de `LightSlot.ceilingY` sont absolues dans le plan local ;
`WorldBuilder` applique ses petits offsets visuels une seule fois.

## Physique et joueur

`RussianStairwellGame` utilise un plan Rapier statique séparé de `WorldStream`.
La coque de l’appartement entre dans `PhysicsWorld.addTrimeshChunk()` après mise
à jour de ses matrices monde ; les meubles gardent des AABB économiques. Les
deux familles sont indexées par clé et suivent le même nettoyage que les chunks
procéduraux. La porte d’entrée possède son propre collider activé uniquement
quand elle est complètement fermée.

La double porte importée du rez-de-chaussée reste statique et collidable, mais
`HallExitInteraction` la raycast comme un portail. Un appui sur l’action
configurable **interagir** déclenche le routeur de `main.ts` : la sauvegarde du
stairwell n’est pas réécrite, tous ses systèmes sont détruits, puis le `Game`
procédural est chargé dynamiquement. La transition est différée à une microtâche
afin de ne pas détruire Rapier au milieu du tick d’entrée courant. Une fois le
niveau 0 réellement initialisé, le nouveau runtime écrit son checkpoint
automatique de destination.

`SaveHistory` conserve au plus douze entrées versionnées, manuelles ou
automatiques, communes aux deux expériences. Une seule autosave représente la
session courante et remplace la précédente. Elle est écrite à l’entrée d’un
niveau, toutes les 30 secondes jouées, au masquage ou à la fermeture de la page,
et avant un retour confirmé au menu principal. Les
snapshots Backrooms stockent le seed et une position locale à son chunk ; les
snapshots russes gardent aussi l’état de la porte. Ne jamais sauvegarder la
position brute d’une chute : chaque runtime écrit le dernier ancrage sûr transmis
par `PlayerController`.

`PhysicsWorld` possède un personnage cinématique Rapier et des lots de colliders
indexés par clé de chunk. Les mutations groupées passent par
`batchChunkChanges()` pour limiter les synchronisations.

Une porte interactive garde son collider fermé au début de l’animation.
`WorldDoorLayer` signale à `WorldStream` quand l’ouverture devient praticable,
puis `PhysicsWorld.setChunkColliderEnabled()` désactive uniquement ce collider.
La broad phase prend ce changement au tick fixe planifié suivant : ne pas forcer
un `world.step()` supplémentaire depuis la mise à jour d’interaction.
Un appui bref sur E ouvre vite ; un maintien d’une seconde ouvre en deux secondes.

`Game.frame()` :

1. quand le pointeur est verrouillé, borne le delta et exécute
   `PlayerController.fixedUpdate()` à 60 Hz ;
2. interpole la caméra avec `renderUpdate()` puis met à jour streaming et
   interactions ;
3. quand le jeu est en pause, fige simulation, streaming et caméra ; seul le
   menu principal peut remplacer cette caméra par son panoramique lent ;
4. adapte progressivement la résolution en mode qualité automatique ;
5. rend via `PostFX`.

Ne pas déplacer la physique dans la mise à jour de rendu variable. Les rampes,
marches, accroupissement et transitions verticales sont sensibles à cette
séparation.

Les commandes configurables sont stockées dans `GameSettings.controls` sous
forme de codes normalisés : les lettres suivent `KeyboardEvent.key` afin que les
presets AZERTY et QWERTY correspondent aux caractères imprimés, tandis que les
autres touches gardent leur `KeyboardEvent.code` physique. `ExperienceUI`
garantit une touche unique par action, puis `Game` transmet la configuration à
`PlayerController` et `InputManager`. Les variantes gauche/droite de Maj, Ctrl
et Alt sont traitées comme une même touche pour les conflits et à l’exécution.

## Props et assets

- `PropCatalog.ts` décrit chemins, tailles, catégories et transformations.
- `PropPlacement.ts` sélectionne des placements déterministes et sûrs.
- `WorldProps.ts` charge, normalise, clone et détruit les modèles.
- Dans une scène composée, un accessoire posé en hauteur référence son meuble
  support : sa hauteur suit l’échelle réelle du meuble et son emprise est
  réduite si nécessaire pour rester à l’intérieur du plateau.
- Le catalogue runtime est volontairement resserré : ancres PBR Poly Haven,
  petit désordre Kenney seulement. Les sources sont servies depuis
  `public/assets/textures/{polyhaven,kenney}`.
- `WorldProps` met en cache le modèle normalisé et partage ses géométries entre
  instances ; seules les matières teintées appartiennent au chunk et sont
  détruites au démontage.
- `WorldView.ready` permet au chargement initial d’attendre les assets visibles.
- Toute ressource ajoutée doit être locale et déclarée dans
  `public/assets/licenses.json`.

## Diagnostic rapide

| Symptôme | Vérifier d’abord |
|---|---|
| Objet décalé dans les chunks voisins | offset appliqué deux fois ou coordonnées non locales |
| Collision fantôme après déplacement | `unmountChunk()` / propriété du collider |
| Trou noir ou face manquante vue d’en dessous | caps, normales et matériau du puits/plafond |
| Halo ou couture lumineuse | origine monde et rectangles dans `ZonalLighting.ts` |
| Stutter à l’approche d’un étage | file de préfetch et données worker sérialisées |
| Mémoire qui monte en explorant | `dispose()` du `WorldView`, des props et matériaux clonés |
| Prop dans un mur/trou | ordre de `populateRareProps()` et empreinte de placement |

## Tests associés

- rendu architectural : `src/render/WorldBuilder.test.ts`
- lumière zonale : `src/render/ZonalLighting.test.ts`
- lumière classique : `src/render/BakedLighting.test.ts`
- graffiti : `src/render/WallGraffiti.test.ts`
- streaming : `src/core/WorldStream.test.ts`
- physique : `src/physics/PhysicsWorld.test.ts`
- déplacement : `src/player/PlayerController.test.ts`

Voir `docs/agents/VERIFICATION.md` avant de lancer plusieurs suites lourdes.
