# Objets et appareils de l’appartement

`InventoryState` conserve cinq identités, dont un emplacement réservé à la lampe.
Les quatre autres acceptent les petits props non cassables. `ApartmentObjectInteraction`
désactive le corps rangé et réutilise son unique mesh pour l’équipement ; G le
reprend physiquement ou le range. La molette choisit un emplacement hors portage,
et conserve la distance pendant le portage. `EquipmentInput` attend le relâchement
bref et isolé de F ; les gestes de combat, champs et touches remappées gardent
leur priorité (L/I servent de repli si F/G sont occupées).
Les emplacements utilisent des vues CPU mises en cache des vrais objets et du
modèle de lampe, sans renderer supplémentaire. Ils n’ont pas de légende permanente.

Après la reprise du PC, `CorridorStory` remplace une seule fois la cage par
`LongCorridor`, au seuil réel importé. Une contrainte d’intention de mouvement
fait hésiter devant la sortie sans lampe, sans collider invisible ni déplacement
du vantail ouvert. Les 168 m reprennent `MaterialLibrary` jaune, les UV et les diffuseurs HDR
partagés avec `WorldView`. Sol et Rapier suivent le support réel sous le seuil ;
les retours commencent à l'extérieur du cadre importé, sans couvrir verrou et
interrupteur. Les luminaires sont instanciés, leur champ analytique persiste
indépendamment de la caméra.
Leurs colliders sont préparés désactivés ; la transition active les mêmes corps
et retire les anciens chunks dans une mutation groupée. Météo et audio restent
indépendants de la panne.
À 20 m réellement parcourus, le gros bruit est consommé avant sauvegarde.
`CorridorReaction` anime le rig habillé courant puis revient à ses yeux quand
la vague atteint le joueur. Celle-ci commence au luminaire voisin du personnage
et accélère vers le fond selon `corridorLampTime`, sur l'horloge jouée et
sauvegardée. Le premier déplacement continu consomme séparément la réaction
parlée et l'indication de course, respectant le remappage et Maj droite. Le temps joué, le décor, l’objectif et l’inventaire
sont des extensions optionnelles de l’historique v2. L’événement historique de
panne reste l’autorité du PC et de la radio, même après le rallumage des lampes.

`RussianStairwellGame` possède les systèmes ci-dessous et les détruit avant
`ImportedApartmentEnvironment` et `PhysicsWorld`. Les portes, voisins, judas,
courrier et progression restent dans leurs modules précédents.

| Module | Responsabilité |
| --- | --- |
| `ApartmentPickables` | Identités par chemin stable, sélection des vrais objets, exclusion de la poêle |
| `GeometryIslands` | Connexité des triangles soudés aux coutures, séparation vase/plante et composants du tabouret |
| `ApartmentObjectInteraction` | Corps, portage, contacts, perte de prise, casse, plante détachée et poses sauvegardées |
| `ContactDeposits` | Trajectoires courtes et dépôts sur les vrais points/normales du décor |
| `ApartmentFixtures` | Robinet, bassin, flottabilité, pales et lampe indépendante |
| `ClosetHide` | Deux portes physiques du meuble près du lit, caméra intérieure et sortie |
| `ApartmentInteractionState` | Données optionnelles et validation des anciennes/nouvelles sauvegardes |

Tous les objets mobiles ont des corps au montage, initialement endormis.
Le rebord `window_edge` garde ses vrais triangles pour soutenir le pot ; sans
lui une pose douce à son emplacement visible deviendrait une chute d’un mètre. Les
32 pièces d’échecs sont indépendantes du plateau `Cube001`. Les tabourets ont
huit formes convexes (assise, pieds et traverses), sans grosse boîte pleine.
Le vase céramique seul porte la collision du pot ; sa plante reste visible et
physique après un impact cassant. Ne pas séparer le vase par une simple hauteur :
les feuilles et la céramique se chevauchent verticalement.

Le portage impose une vitesse bornée à un corps dynamique, avec CCD et balayage
du décor depuis sa position actuelle. Un contact tangent à la table ou avec une
petite pièce ne perd pas la prise. Les balayages projettent la cible sur les plans
de contact pour conserver la glisse. Seul un blocage durable sans progression
accumule une résistance puis relâche le corps avec gravité et vitesse nulle.
Assiettes, verres, bouteilles et pot cassent selon une impulsion et une vitesse
de contact réelles, jamais par la sélection, le lancer seul ou pendant le portage.
Les balayages utilisent `Collider.castCollider` sur les formes déjà calculées,
après sélection AABB des obstacles. `world.castShape(collider.shape)` reconstruisait
le hull depuis les sommets originaux à chaque tick. La bouteille utilise aussi
son collider ajusté pour le ciblage, sans parcourir ses triangles visuels.

Les gouttes et la terre suivent des segments balistiques testés contre les
colliders existants. Les patches utilisent la normale de contact et contrôlent
leur empreinte sur le support. Limites : 36 particules, 48 dépôts, 24 fragments ;
les fragments durent neuf secondes, les dépôts quatre minutes jouées. La terre
forme une petite accumulation en relief. Le snapshot conserve casse, résidu
en cours, dépôts et pose de la plante, pour éviter le retour d’un pot intact.
La même extension de sauvegarde v1 accepte les états `glass` et `ceramic` ; aucune
casse restaurée ne recrée de fragments ou de son. Les cassures rapprochées partagent
un délai sonore de 120 ms, sans perdre leur état ni déclencher la quête du whisky.
Le gaz vise les quatre commandes déjà présentes dans le mesh de l’appareil ;
aucun bouton supplémentaire n’est ajouté.

L’évier exporté possède déjà une vraie cavité dans le plan de travail. Garder ses
triangles ; une AABB remplirait le bassin. L’eau plafonne à Y=9,62, sous le rebord
à Y=9,664. Le trop-plein permet au robinet de continuer. La poussée dépend de
l’immersion et de la densité ; amortir les vitesses dans l’eau sans téléporter
les objets ni appliquer un couple trop fort aux minuscules pions.

`PhysicsWorld.onBeforeStep` pilote les appareils au pas du monde partagé.
Le personnage conduit les ticks ordinaires. Un seul accumulateur passif prend
le relais au PC, dans le judas ou la cachette ; il ne s’ajoute jamais au conducteur
du personnage. Pause et onglet masqué suspendent tous les ticks.

Les pales sont `Bone003_03` du ventilateur à la racine, pas l’extracteur de cuisine.
La cage reste fixe. La lampe utilise son ampoule et son interrupteur propres,
avec un état indépendant et une extinction imposée pendant la panne.

Le meuble près du lit a une coque `Closet` et deux feuilles **sœurs** `LeftDoor`
et `RightDoor`. Il diffère de `closet_door`, qui est une porte de pièce statique.
L’ouverture de 1,62 rad laisse passer la capsule resserrée pendant la transition.
La capsule normale est rétablie à l’extérieur. Aucun voile ne masque la coque ;
la caméra est réellement à l’intérieur. Les sauvegardes gardent l’ancrage sûr
extérieur, pour ne jamais recharger une capsule normale enfermée dans le meuble.

La TV garde son CanvasTexture à 12 Hz. L’image originale locale est prête avant
l’entrée en jeu et apparaît avec Pressure. Le son reste sur la TV ; son enveloppe
de distance est continue, sans test de seuil de porte. La radio conserve sa
playlist, ses parasites après la panne et sa source mobile. Chaque boucle
utilise le bus spatial/master existant et possède un nettoyage explicite.

Vérifier avec `ApartmentInteractive`, `ApartmentPhysical`, `ApartmentDevices`,
`TelevisionPicture`, `ApartmentDeviceAudio`, `ComputerInputLifecycle` et
`SaveHistory`, puis les régressions du hall et du personnage. `PostComputerJourney`, `CorridorProgress`, `StorySpeech`, `LongCorridorRendering`
et `PostOutagePhysical` protègent aussi la séquence et ses ressources. Ces essais CPU sur
le modèle réel ne remplacent pas un contrôle visuel et auditif WebGL.
