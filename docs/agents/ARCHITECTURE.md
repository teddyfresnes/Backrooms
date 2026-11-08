# Architecture utile aux modifications

Lire ce document uniquement pour une tâche transversale. Pour un problème
localisé, utiliser directement le guide de sous-système indiqué dans
`AGENTS.md`.

## Flux d’exécution

```text
src/main.ts
  ├─ joue l'introduction d'ouverture pendant le chargement du fond de menu
  ├─ monte un Game Level 0 neuf comme fond non jouable du menu principal
  ├─ Continuer choisit la sauvegarde locale la plus récente (désactivé sans sauvegarde)
  ├─ import dynamique de RussianStairwellGame
      ├─ StairwellEnvironment + ImportedApartmentEnvironment
      ├─ PhysicsWorld (plan statique + trimesh de l’appartement)
      ├─ PlayerController + porte, verrou, interrupteur et stores interactifs
      ├─ SaveHistory (niveau, pose, porte/verrou, lumière, stores et temps de jeu)
      └─ BacteriaEncounter -- chute après la fuite ───┐
                                                       ↓
  └─ import dynamique de Game (labyrinthe procédural précédent)
      └─ SaveHistory (seed, chunk, pose et temps de jeu)

Runtime procédural conservé :
  Game.create
      ├─ génère le chunk origine dans le worker existant puis valide son WorldPlan
      ├─ charge MaterialLibrary et crée PhysicsWorld
      ├─ initialise WorldStream
      │   ├─ génère/prépare les chunks avec infinite.worker.ts
      │   ├─ monte un WorldView par chunk
      │   └─ ajoute/retire les colliders du même chunk
      ├─ délègue le personnage à CharacterRuntime à pas fixe (60 Hz)
      └─ présente la scène via PostFX à chaque frame
```

Le runtime procédural Level 0 sert toujours de fond au lancement et au retour au
menu principal. Il ne devient pas jouable depuis ce menu : **Continuer** restaure
la dernière entrée et **Nouvelle partie** crée toujours un
hall neuf. Les deux runtimes utilisent le même `ExperienceUI`, toujours présenté
comme le menu Backrooms. La scène russe
reste finie et statique : ne pas la faire passer par `WorldStream`, dont les
coordonnées de chunks et d’étages appartiennent au monde procédural. `src/main.ts`
détruit ce runtime avant d’instancier `Game` après la chute du scénario de fuite.
La porte du RDC n’est jamais un portail interactif au début de la partie.

Au premier chargement de la page, `OpeningIntro` attend le fond Level 0, les
polices et le décodage audio au-dessus de `#app`. Le clic de lancement débloque
le son immédiatement ; une seule horloge par images affiche ensuite chaque
carte avec son son. Elle conserve le temps de lecture en cas d'image bloquée ou
d'onglet masqué. Les retours au menu principal ne rejouent pas l'introduction.
`public/assets/audio/music/playlist.json` référence les morceaux disponibles ;
un morceau est tiré au hasard par démarrage et conservé aux retours au menu.

`RussianStairwellGame` possède le prologue, le hall, l'appartement, le courrier et
les interactions avec les voisins. Les assets se téléchargent pendant les photos ;
la scène se construit après elles, puis
la cinématique entre dans la vue subjective avant de libérer les commandes.
La marche sans saut s'applique dans la cage ; le courrier bloque la première montée.
Voir [Parcours de l’immeuble](STAIRWELL_FLOW.md) pour le chargement, la lecture,
les voix, les sauvegardes et les responsabilités de ces modules.

Après la coupure, `LongCorridor` (couloir Level 0 avec néons à niveau par lampe,
sans lumière Three.js) remplace la cage. À 20 m, `CorridorStory` déclenche la
réaction ; la vague part toujours de la lampe 0, à la porte de l'appartement.
`BacteriaEncounter` enchaîne ensuite : révélation lointaine (de dos, tête puis
corps qui se retournent), charge accélérée, siège de la porte, cachette (armoire,
placard d'entrée ou salle de bain : `HIDE_SPOTS`, le monstre renifle devant celle
utilisée). TV allumée : le monstre la porte et se calme (sa voix seule ; le cri ne
joue qu'en poursuite), sortie discrète en maintenant E (`SNEAK_HOLD_SECONDS`) :
le maintien pilote l'animation, le relâcher fait jaillir le joueur et le monstre
charge. E reste libre en cachette (`requestHiddenExit`, écouté directement car les
entrées du joueur sont coupées) : avant l'intrusion on ressort, monstre dans
l'appartement avant l'invite on meurt. Repéré sur le
palier, un bref plan regarde la créature puis l'escalier ; dans la cage elle
suit en élastique (`followSpeed`, `ESCAPE_FOLLOW_GAP`), dehors en poursuite
directe ; la chute se déclenche à 14 m de la porte dans toute direction, bien
avant les limites invisibles (±40 m). Arrivé dans les Backrooms par la chute
(`arrivedByFall`), aucun PNJ n'apparaît (ni après un chargement). `collapseOnArrival` prépare une vraie
pose couchée et la caméra au sol avant la première image ; les yeux s'ouvrent
pendant 3,6 s de temps joué, puis l'invite E autorise le relevé habituel.
L'inventaire suit la chute ; `RiftEncounter` mène ensuite à la faille `epic3`
(voir [Après la chute](RIFT_JOURNEY.md)).
Puis fuite dans la cage restaurée (`restoreStairwell`) et par la porte du
hall : la porte entière disparaît (objet masqué, `HALL_DOOR_COLLIDER_ID` et
`HALL_DOOR_LEFT_COLLIDER_ID` désactivés). `createEscapeRunColliders` monte une
bande de rue invisible ; `EscapeStreet` dessine un bas-côté de 180 m (cartes
couleur/rugosité/normales d'un même champ de hauteur) et des touffes instanciées
au vent, au-delà du brouillard. `setExteriorDark` ne garde que la pluie et
l'immeuble hôte. Dehors (`ESCAPE_RUN`), pluie sur l'objectif, puis le joueur
trébuche et traverse le sol (phase `escaped`) : longue chute dans le noir vers
`BackroomsBelow` (labyrinthe non éclairé, hors brouillard, centré sous la chute),
vent de chute, teinte jaune dans les derniers instants, fondu au noir
(`StoryHud.setFade`) puis écran de chargement en fondu (`is-arriving`).
TV éteinte : le placard est arraché. Les timings sont couverts par
`BacteriaLayout.test.ts` et la machine à états par `BacteriaEncounter.test.ts`.
Aucune sauvegarde pendant la rencontre ; une mort avant la cachette ramène à
l'entrée du couloir (décor et collisions remontés ensemble, même si la cage était
déjà revenue pendant le leurre), après elle au placard. `bacteriaSurvived` (anciennes
sauvegardes) rouvre directement la porte du hall.

Dans le garde-robe, la géométrie et les poses inverses du squelette restent dans
les coordonnées locales de `CharacterRoot`. Après un morph ou une calibration,
`rebindMakeHumanSkeleton` retire la transformation monde de la racine des poses
inverses : la rotation de prévisualisation ne doit jamais entrer dans la liaison
du corps ou des vêtements. Les yeux se refitent dans cet espace avant de
restaurer la pose animée.

Les sélections du garde-robe réutilisent ce corps, ses buffers et son squelette.
Un nouvel epoch invalide le calcul précédent et ses callbacks de disponibilité ;
les boutons restent actifs. Les morphs préparent positions et normales par petits
lots, puis les appliquent ensemble après une dernière vérification. La pose est
capturée à cet instant. Les fichiers MHCLO/OBJ et targets se lisent aussi par lots ;
leurs poids de squelette immuables sont mis en cache, sans recalcul à chaque preset.

Une session jouable masque l’overlay avant de demander le verrouillage de souris :
la capture est demandée uniquement dans un clic utilisateur transmis au contrôleur.
Une entrée asynchrone ou un refus laisse l’icône de reprise ; aucune rotation de
caméra n’est alors permise. `PlayerController` vérifie aussi `pointerLockElement`
et ignore le premier delta après capture. Une perte de capture ouvre la pause,
même si le navigateur absorbe Échap. `ExperienceUI` intercepte Échap/P avant les
interfaces modales ; le runtime suspend l’unique horloge, la physique et les sons.
Le bureau conserve ses fenêtres sous la pause. `NewGameIntro`
libère ses touches et son verrou `inert` avant le transfert au runtime ; une
ancienne instance ne doit jamais restaurer le verrou d’une instance suivante.
L’appartement utilise un pack binaire généré depuis l’export original par `npm run assets:apartment` : géométries typées et bornes précalculées, métadonnées inchangées. Le worker conserve les téléchargements compressés pendant les photos et ne décompresse qu’après elles. Un seul Blob compressé est réutilisé entre nouvelles parties et sauvegardes dans le même onglet. Le build vérifie les hashes et omet uniquement l’ancien pack du déploiement.
Le routeur conserve l’écran de chargement jusqu’à la compilation, au warmup et
au décodage de tous les sons du runtime. `LoadProgress` suit les octets reçus et les tâches terminées pour le hall, réserve les derniers pourcents au rendu prêt et expose les durées écoulées (qui peuvent se chevaucher) dans `window.__BACKROOMS_LOAD__`. `initialize(onProgress)` transmet aussi la phase courante ; aucune progression ne dépend d’un minuteur. L’entrée directe masque le menu sans transition
avant que cet écran soit retiré, afin qu’aucune frame du menu ne fuite en jeu.
Le contrat central du labyrinthe reste `WorldPlan` dans `src/world/types.ts` ;
la génération ne crée que des données et le rendu et la physique les consomment
séparément. Le chemin ordinaire passe par `RegionalPlan` → `SpatialConnectors` →
`SpatialWorld`, avant les détails. L’adresse `story` ne donne pas l’altitude du sol.
Le pipeline historique complet reste explicite pour les monuments et les reproductions
brutes. Son BSP est également réutilisé sur 224 m dans les plateaux ordinaires ;
les réservations régionales précèdent la matérialisation aux altitudes finales.

## Responsabilités

| Zone | Responsabilité | Points d’entrée |
|---|---|---|
| `src/core` | lancement, historique de sauvegarde, boucles et streaming | `RussianStairwellGame`, `SaveHistory`, `Game`, `WorldStream` |
| `src/stairwell` | scène statique, matériaux et météo russe | `StairwellEnvironment`, `createStairwellPlan` |
| `src/apartment` | appartement importé et porte persistante | `ImportedApartmentEnvironment`, `ImportedApartmentDoorInteraction` |
| `src/world` | plan déterministe, topologie, chunks, props | `generateWorld`, `generateInfiniteChunk` |
| `src/render` | géométrie Three.js, matériaux, lumière, post-FX | `WorldView`, `MaterialLibrary`, `ZonalLighting`, `PostFX` |
| `src/physics` | personnage Rapier et colliders par chunk | `PhysicsWorld` |
| `src/player` | entrée FPS, déplacement, chute, noclip | `PlayerController` |
| `src/character` | rig, emotes, combat, interactions, ragdoll et relevés | `CharacterRuntime`, `CharacterEnvironment` |
| `src/ui` | démarrage, menus, réglages persistants, console et diagnostic | `ExperienceUI` |
| `src/audio` | ambiance et retours de déplacement | `AudioSystem` |

`CharacterRuntime` partage la scène et le monde Rapier du runtime hôte ; il ne
crée ni renderer ni boucle autonome. Il choisit le contrôleur cinématique, le
ragdoll ou le relevé pour chaque tick, puis copie la caméra choisie dans celle du
post-traitement. `beforePhysicsStep` conserve les poussées de la porte de
l’appartement avant le mouvement. `CharacterEnvironment` interroge les colliders
montés, y compris les trimeshes importés. Le streaming suit le bassin pendant une
chute. Le fond de menu ne charge pas le personnage. Le runtime hôte détruit le
personnage avant son joueur et sa physique.

`FirstPersonObstaclePose` corrige uniquement les bras du rig de présentation,
après la garde et la sécurité caméra. Ses balayages sphériques Rapier couvrent
les doigts, les avant-bras et les coudes contre les colliders réels, dont les
portes et trimeshes. Les articulations se replient sans étirer les membres ni
vriller les poignets ; le corps monde, les pieds et la caméra restent intacts.
La pose est restaurée avant le mixer suivant ; le relâchement du contact est amorti. Ne pas
appliquer cette correction au ragdoll ni au rig de troisième personne.

## Deux espaces de coordonnées

- Le contenu d’un `WorldPlan` est local à son chunk.
- `getChunkWorldOffset()` transforme `(x, z, story)` en position monde.
- `WorldStream.mountChunk()` applique cet offset au groupe Three.js et aux
  colliders Rapier.
- Les requêtes runtime (`findRoomAt`, interactions, lumières) reconvertissent la
  position du joueur en coordonnées locales du chunk.

Éviter d’inscrire des offsets globaux dans le plan : cela produit généralement
des collisions ou interactions décalées deux fois.

## Changements qui traversent plusieurs couches

Une nouvelle géométrie jouable implique généralement :

1. type et données dans `src/world/types.ts` ;
2. émission déterministe dans `generateWorld.ts` ou `InfiniteWorld.ts` ;
3. représentation visuelle dans `WorldBuilder.ts` ;
4. `floorRects`, ouvertures et/ou `colliders` cohérents ;
5. préfixage des IDs dans `prefixPlanIds()` si nécessaire ;
6. validation pure, test de rendu et test physique selon le cas.

Une nouvelle prop implique plutôt `PropCatalog.ts` → `PropPlacement.ts` →
`WorldProps.ts`, plus la licence dans `public/assets/licenses.json`.

Une modification de streaming implique souvent `InfiniteWorld.ts`,
`infinite.worker.ts`, `WorldStream.ts` et `PhysicsWorld.ts`. Le worker renvoie
uniquement le plan sérialisable ; le champ lumineux zonal est créé au montage.
`PrepareOriginPlan` réattache les métadonnées `InfiniteWorld` au plan origine
après le clonage structuré, comme `WorldStream` le fait pour les voisins :
la `WeakMap` du worker ne traverse pas ce transfert.

## Propriété et nettoyage

- `RussianStairwellGame` possède sa scène, le joueur, la physique, l’appartement,
  la porte, le post-traitement et l’UI ; il les détruit tous dans `dispose()` avant de recréer une
  session.
- `Game` possède les grands systèmes du runtime procédural et les détruit dans
  `dispose()`.
- `WorldStream` possède les `WorldView` montés et leurs entrées physiques.
- `WorldView` possède sa géométrie, ses matériaux zonaux clonés, textures
  générées et couche de props.
- Les matériaux partagés de `MaterialLibrary` restent la propriété de la
  bibliothèque ; ne pas les détruire depuis un chunk.

Lors d’un ajout runtime, identifier le propriétaire avant de coder. Un objet sans
propriétaire clair finit souvent dupliqué à chaque changement de chunk.

## Diagnostic rapide

- Monde invalide dès le démarrage : `generateWorld` / `validateWorldPlan`.
- Résultat différent entre worker et thread principal : donnée non sérialisable,
  métadonnée `WeakMap` non recopiée, ou hasard non déterministe.
- Visuel correct mais collision fausse : vérifier `WorldPlan.colliders` et
  l’offset passé à `PhysicsWorld.addChunk`.
- Correct dans le chunk origine mais faux chez un voisin : vérifier les
  transformations et préfixages d’`InfiniteWorld`.
- Correct après chargement mais fuite/stutter après déplacement : vérifier
  montage, démontage et `dispose()`.

