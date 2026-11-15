# Après la chute : la boussole, la faille, la planche

Le runtime `Game` joue cette suite pour toute partie jouable (jamais pour le fond
du menu). La géométrie de la faille est décrite dans
[Monuments historiques](WORLD_MONUMENTS.md).

## Inventaire porté

`RussianStairwellGame.escapeToBackrooms` passe `inventory.snapshot()` à
`onEnterBackrooms` ; `main.ts` le transmet à `Game` (`launch.inventory`). Les
sauvegardes Backrooms ajoutent les clés optionnelles `inventory` et `rift`
(`SaveHistory`, `RiftProgress`). Sans inventaire (anciennes sauvegardes), la
lampe et la boussole sont rendues. `Game` reprend le rail (`InventoryHUD`), la
molette, la touche lampe (`EquipmentInput`), `Flashlight` et `Compass` tenus par
`CharacterRuntime.setHeldItem`, comme dans l'immeuble. Le nord de la boussole est
le −Z monde : la direction de la faille.

## Modules

- `story/RiftProgress.ts` : progression sérialisable, sans import du monde
  (chargée par le lanceur). Étapes `arrival` → `north` → `plank` → `crossed` → `done` ;
  planche posée (`lane` global, `story`, `bank`),
  délai avant la révélation (`crossedSeconds`), résolution `dropped`/`fled`,
  répliques déjà dites.
- `story/RiftJourney.ts` : géométrie des voies (`riftLaneX(k) = 7 + 14k`),
  répliques (`RIFT_LINES`) et `BalanceModel` (pendule inversé amorti, rafales,
  calme à l'arrêt, limite 0,68 rad). Tests : `RiftJourney.test.ts`.
- `core/RiftEncounter.ts` : toute la séquence ; `Game` appelle `update` avant le
  rig et `applyCamera` après. `ownsCharacter` suspend le rig (plan 3P, chute,
  capture) ; `locksInput` empêche pause/console de rendre les commandes ;
  `blocksSaving` interdit les actions en cours mais autorise les deux rives avant
  la révélation. Une reprise `crossed` restaure la planche, la rive de départ et
  le délai déjà écoulé. Tests : `RiftEncounter.test.ts`
  (hôte simulé : arrivée, planche hors champ, bord, chute, traversée, demi-tour,
  planche lâchée avant ou pendant sa traversée, fuite et capture, traque de
  l'autre rive dans un labyrinthe de rues). Le modèle de la créature est chargé
  pour toute partie jouable. Le cœur n'est plus joué ici : `heartFear` et
  `threat` sont lus par `Game` (endurance, voir plus bas).

## Déroulé

1. Relevé après l'arrivée couchée : répliques (« C'est quoi ce bordel ? »…),
   puis objectif « Suivre la boussole vers le nord ».
2. Dans le hall d'approche (≤ 24 m de la galerie), la planche est posée sur la
   paire de portails voisine (±1 voie), derrière le mur de galerie, avec son
   collider `rift-plank`.
3. Au bord d'un portail : en 1P il se penche au-dessus du vide et regarde en bas,
   puis plan extérieur 3P depuis le vide (le mur entre les portails cacherait la
   planche en 1P) : il regarde d'un côté, de l'autre, et l'objectif glisse et
   zoome sur la planche. Retour en 1P tourné vers elle. Si la planche n'est pas
   à ±1 voie et reste hors champ, elle est reposée avant le plan.
4. Sur la planche : marche normale sans sprint, axée par
   `setMovementConstraint` ; regard forcé vers le bas,
   roulis selon l'inclinaison, Q/D (gauche/droite) contre le déséquilibre (calculé
   au-dessus du vide uniquement), jauge `BalanceMeter`, craquements et cœur.
5. Chute dans le vide (quelle qu'en soit la cause) : caméra scriptée qui tombe en
   regardant la lumière s'éloigner, fondu, carte « Tu es tombé. », reprise au bord.
6. 2,6 m après l'autre bord : plan 3P, il se retourne ; contrechamp dans l'axe de
   la voie, au long foyer, à travers les deux portails et la porte d'en face : la
   créature, déjà placée pendant le regard forcé sur la planche, reste au fond
   du couloir d'approche (21 m), se cabre et hurle
   (`rear`) ; elle charge dès la fin du bref plan (~1,8 s).
7. Retour en 1P : elle remonte son couloir puis court sur la planche à la même
   vitesse (8,8 m/s, cadence adaptée), sans pause au bord. Après la traversée,
   elle rejoint progressivement l'allure de poursuite de 6,4 m/s.
   E près du bout de la planche (sur le sol) la pousse : avant qu'elle monte, elle
   repart en courant et en hurlant dans son couloir jusqu'à disparaître au loin ;
   dessus, elle tombe avec la planche. Sans cela elle traverse et suit la trace du
   joueur ; distancée de 30 m (ou 20 s), elle disparaît si elle est hors de vue,
   sinon la traque la reprend en retraite (jamais de fondu à l'écran) ; capture.
8. Sur l'autre rive (après résolution, à plus de 26 m de la faille) : la traque.

Le brouillard et le fond virent au sombre près de la faille (`atmosphereAt`).

## Traque de l'autre rive

`RiftEncounter.updateHunt` délègue à `monster/BackroomsHunt` (runtime : Rapier,
acteur, sons, lampes, parasites), qui assemble des modules purs testés sans
Three : `BackroomsNav`, `BackroomsHunter`, `BackroomsDirector`. La phase vaut
`stalk` pendant `notice`/`chase` (consigne « Sème-la ! »), sinon `done` ;
`blocksSaving` couvre aussi la fouille. Capture : `startCaught` puis reprise au
point où elle l'a remarqué, créature retirée, répit garanti.

- **Navigation** : fenêtre runtime de 256 × 256 cellules de 0,5 m, jusqu'à six
  surfaces par colonne, centrée entre joueur et créature en gardant celle-ci
  dans la fenêtre même à grande distance. Un changement d'altitude conserve les
  surfaces reliées ; le décalage horizontal garde leur recouvrement. Le champ
  est oublié au changement de chunk (`worldRevision`). Chaque surface est sondée par
  `PhysicsWorld.probeWalkableCell` (boîte de corps libre, sol à ±0,42 m), sous
  budget (48 par champ, ~40 par image), depuis la hauteur réelle du support
  voisin ; les deux extrémités du trajet sont amorcées séparément. Dijkstra depuis la cible
  toutes les 0,25 s ; elle descend le champ et tire la ligne droite la plus
  longue (marge 0,18 m), donc coupe les angles sans traverser un mur. Bloquée,
  elle re-sonde autour d'elle et suit les pas du joueur en secours. Les charges
  sont sous-échantillonnées contre les murs fins ; la sonde de 1,46 m couvre le
  torse de 0,96 m et les 0,25 m de déplacement permis dans chaque cellule.
  Le mouvement consomme aussi le reste du pas après chaque point de passage.
  Les bras se replient par `FirstPersonObstaclePose` avec
  les balayages sphériques de `CharacterEnvironment` après chaque pose.
- **États** : `dormant` → `lurk` (`still` attend 1,5–3,5 s avant de repartir,
  `prowl` explore de nouveaux points, `cross` passe au loin,
  `ambush` annoncée par le toc toc puis patrouille sans connaissance du joueur) → `notice` → `chase`
  → `search` (élan conservé dans la dernière direction observée, puis pièces
  voisines en ralentissant, reniflements,
  réagit au sprint à 13 m) → `shadow` (suit hors de vue à 15–30 m) →
  `withdraw` → `dormant`. Elle ne disparaît que hors ligne de vue et à ≥ 25 m ;
  une cinématique la fait toujours se retirer. Vision jusqu'à 160 m, cône large
  et plusieurs rayons depuis sa tête vers les yeux et le torse du joueur ; un regard prolongé de 1,4 s provoque
  son retournement puis une poursuite, même si elle présentait son dos. Au-delà
  de 46 m, une silhouette nettement visible réagit après 0,3 s d'observation,
  même au-delà du rayon normal de perception. Les rayons de vue restent obligatoires. Les
  brèves pertes de visée ne remettent pas ce délai à zéro. Hors contact visuel
  et auditif, la poursuite prolonge le dernier cap observé ; elle ne lit plus
  les déplacements cachés du joueur.
- **Poursuite** : voir `HUNTER_TUNING` (croisière 6,1, pointe 7,25 après 2,4 s
  de ligne droite, élastique au-delà de 12 m, aucun freinage au contact,
  virages freinés à 3,5–5,1 m/s, lunge à 2,7 m). En poursuite elle n'entend le
  sprint qu'à 7 m : perdue après 2,5 s sans le voir ni l'entendre à ≥ 9,5 m.
  Tests d'équité (`BackroomsHunter.test.ts`, trois labyrinthes) : sprint et
  virages = semée, marche = capturé, longue ligne droite = rattrapé.
- **Directeur** : premier contact après 25 s et 35 m sur la rive, tension par
  temps et pas, fausses alertes, répit de 55–85 s après chaque rencontre.
  `chooseLurkSpot` note les cellules à 28–52 m, vers le déplacement réel ; les
  positions proches ou latérales nécessitent un détour praticable entre pièces,
  obscurité (`WorldStream.darknessAt`), couloirs longs, halls, encadrements,
  angles ; jamais à l'écran, toujours derrière un mur, avec une marge pour les bras. 35 % d'approches
  silencieuses (nappe coupée jusqu'au cri). Les passages en mouvement dominent ;
  le cap suit le couloir et chaque tentative possède son fork de placement.
- **Présence** : `BacteriaAudio.loadPresence` (nappe fournie, mono 32 kHz,
  boucle 1,13–67,78 s, départ seedé), passe-bas derrière les murs ; toc toc
  (`knock-wood.ogg` + coups sourds) 2–5 s avant une embuscade ou pour rien ;
  souffle et cliquetis en `lurk`/`search` ; cri réservé à la poursuite. Lampes :
  `LightFlicker` → uniforms partagés (`render/LightDisturbance`), événements
  intermittents, parfois silencieux : un tube réel (`WorldStream.nearestWorkingLight`)
  ou une zone de 12–52 m, parfois aucune perturbation. Durée, intensité et
  distance au monstre varient indépendamment. Le directeur varie aussi
  les faux bruits et clignotements sans créature. Parasites :
  `cameraDisturbance` → `PostFX.setVhs`.
- **Endurance** (`player/Stamina`, jamais sauvegardée) : ~66 s de sprint au
  calme, sprint coupé jusqu'à 35 %, adrénaline (`threat`) et contrecoup ;
  `Game` pilote `setSprintExhausted`, `setExertion`, cœur, vignette et
  `StaminaCue` (visible sous 100 %, jusqu'à récupération complète). Le son
  d'essoufflement est supprimé. Le cœur ne démarre qu'à ≤ 6 %, s'arrête à ≥ 10 %
  et garde son délai entre doubles battements ; la peur seule ne le déclenche pas.
