# Événements environnementaux

`world/EnvironmentEvents.ts` contient les données sérialisables, les probabilités
et le registre des contraintes. `generateInfiniteChunk` l’appelle après la géométrie
spatiale finale et avant `populateRareProps`. Les monuments historiques, dont
`epic3`, et les rangées réservées de `NorthernLayout` restent exclus. Tirages et
IDs sont en `v2` (`environment/v2/x/z/étage`) ; le plan spatial est en version 26.

## Tirages et géométrie

Une cellule régionale de 28 m représente une opportunité, indépendamment du
nombre de petites surfaces de sol. Réglage : `ENVIRONMENT_EVENT_CONFIG`.

| Événement | Probabilité moyenne par cellule |
|---|---:|
| Alarme incendie | 0,15 % |
| Néons clignotants | 0,5 % |
| Eau peu profonde | 0,6 % |
| Téléphone | 0,4 % |
| Chaise solitaire | 0,3 % (×4 sur les 4 cellules intérieures, 0 ailleurs) |
| Surveillance | 0,5 % |
| Gouttes | 10 % des zones inondées |

Un seul tirage catégoriel évite plusieurs événements par cellule. L’amincissement
de Matérn compare les propositions voisines sans générer leurs plans : **36 m
horizontaux entre centres de zones**, plus deux fois `MAX_ROOM_DRIFT` (14 m).
Deux zones séparées d’au moins `verticalSeparation` (9 m, deux étages) ne se
gênent pas : sinon les étages invisibles supprimaient la plupart des tirages.
Les altitudes viennent de `regionalDatum`. Une proposition incompatible n’est
jamais forcée ni remplacée par un autre type. Mesure sur 6 seeds × 1 600 cellules
d’un étage, zones narratives et monuments compris : ≈ 0,38 % des cellules portent
un événement construit, soit environ un pour 17 chunks d’un étage.

Une zone est la **pièce physique** : `eventZones` fusionne les fragments d’une même
pièce BSP source découpée par les cellules (même altitude, joint sans mur) et
écarte les unions non rectangulaires. Elle doit être complète dans son chunk, plate,
ouverte, assez haute, hors features (portes exceptées), symétries et circuits.
Alarme, néons, eau et chaise exigent en plus une pièce close (`zoneEnclosed` :
chaque côté muré à 50 % au moins, ouverture la plus longue ≤ 4,6 m) ; sinon leur
lumière ou leur eau traceraient une couture droite en pleine pièce. Les supports
muraux utilisent une face réelle avec dégagement accessible. Une zone d’alarme
d’au moins 16 m reçoit un second boîtier (`extraMounts`, ≥ 10 m du premier).
`InfiniteWorld` préfixe salles (`roomIds`), murs, néons et supports.

**Salle de la chaise.** `lonelyHallCell` est consulté par `SpatialWorld` avant le
partitionnement : une cellule intérieure acceptée pour la chaise, en district
`maze` homogène, sans atrium, sans feature héritée ni rangée narrative, devient
une salle vide unique de 28 × 28 m (`…/lonely-hall`). Elle est fermée comme une
façade de district, avec une porte de 4 m au centre de chaque côté. Ses voisines
construisent leur moitié de façade et gardent un vestibule dégagé. Plafond et
treillis de néons sont ceux du grain du district (`bspGrainProfile`) ; ni cloison,
masse, relief, mur liminal, socket, circuit nordique ni mobilier n’y entrent.
L’eau à 3,5 cm est découpée selon les sols, murs et ouvertures de la zone.

## Runtime et propriété

`environment/EnvironmentRuntime` observe montage, remplacement de vue et démontage
de `WorldStream`. Ses groupes restent séparés des `WorldView`, afin qu’une bascule
classique/moderne ne rejoue pas une découverte. Dispositifs et chaise possèdent
leurs colliders, avec le même offset monde ; déplacer la chaise remplace son
collider. Les rayons peuvent ignorer le corps de leur cible, mais jamais les murs.

`EnvironmentModels` construit les dispositifs définitifs : boîtier/grille/lentille
d’alarme, cadran/combiné/cordon, support/gimbal/objectif. La chaise réutilise le
modèle Poly Haven et le cache de `WorldProps`. `EnvironmentWater` partage un
matériau par zone, huit ondulations et au plus trois gouttes réutilisées. Les reflets
des panneaux sont analytiques, sans rendu miroir ni réflexion complète du décor.

`render/EnvironmentLighting` compose des uniforms locaux aux rectangles et aux
hauteurs réelles, en moderne comme en classique. Il ne remplace pas ceux du
chasseur et n’ajoute aucune lumière dynamique ni shadow map. Le rouge est ajouté
aux surfaces proches de chaque boîtier (un slot par boîtier, le niveau du circuit
sur le premier seulement) selon l'enveloppe du véritable enregistrement de sirène.
Tous les boîtiers d’une zone partagent la même phase audio et lumineuse. Le diffuseur
des néons de la bibliothèque est partagé entre chunks : une `WorldView` dont les
panneaux suivent un circuit (événement ou secteur nordique, `active`) en possède
une copie. `EnvironmentLighting` et `NorthernLighting` n’injectent leur code
qu’une fois par shader : décorer un matériau partagé depuis deux vues cassait sa
compilation.

`audio/EnvironmentAudio` utilise le contexte et le bus maître d’`AudioSystem`, des
`PannerNode` HRTF/inverse, un compresseur et un budget de 28 voix. Les échantillons
synthétiques sont conservés une fois par session. La voix française murmurée et
la sirène fournie sont des Vorbis locaux déclarés dans les licences. Sonnerie
avec hystérésis ; chaque boîtier d'alarme conserve une seule boucle (un peu plus
douce s'il y en a deux), démarre à gain nul et s'éteint progressivement entre
24 et 48 m, avant le déchargement du propriétaire.
Son volume dépend de l'écart au sol réel du joueur (nul à ±2,2 m), jamais du
numéro d'étage ni de la caméra. Cinq rayons et un lissage de 120 ms évitent les
basculements secs aux portes. Pause et volume restent communs.
Tous les nœuds audio, géométries, textures et matériaux possédés sont libérés au
démontage, y compris les chargements de modèle terminés trop tard.

## États et Bacteria

`EnvironmentBehavior` porte les transitions pures du téléphone et de la caméra.
Le téléphone consomme sa découverte au décroché : fuite, déchargement et reprise
ne relancent pas l’appel. Les dix secondes commencent après la phrase audible.
Un retournement exige 115° horizontaux pendant 120 ms. Sans retournement : souffle
croissant, un pas derrière et raccrochage. Le combiné utilise la cadence d’effort
du joueur ; aucune capture de microphone.

Durant l’appel, la navigation existante se prépare deux fois par seconde (et les
tentatives de poursuite quatre fois par seconde), jamais à chaque image. `RiftEncounter` prête le chasseur
uniquement en phase libre `north` ou `done`, créature cachée et chasseur dormant.
`BackroomsHunt` choisit un sol relié et libre à 8–24 m, derrière la caméra, hors
frustum. Il lance la poursuite existante sans créer ni remplacer une créature
active. L’étape narrative reste inchangée ; capture/reprise conservent son checkpoint.
Sans position valide ou si la créature est occupée, aucune apparition n’est forcée.

L’apparition des néons est un acteur distinct, sans physique ni IA, chargé à
l’approche. Il réutilise le modèle et la marche `stalk`. Sa fenêtre visible est
encadrée par deux coupures complètes. Une découverte consommée ne se rejoue pas.
La chaise suit six stations déterministes (centre, puis pas de 1,6 à 3,4 m et
rotations de 0,5 à 1,4 rad, à 6 m au moins des murs). Elle avance d’une station
par visite suivie d’un départ : à plus de 12 m de la salle, pendant 1,5 s sans que
sa place actuelle ni la suivante soient visibles (frustum et plusieurs rayons).
`chairIndex` persiste ; un ancien `chairMoved` vaut la deuxième station. La caméra gèle à
proximité ; elle ne repart qu’après éloignement, délai et absence de regard, avec
vitesses de rotation bornées.

`EnvironmentStateStore` écrit les petits deltas nécessaires dans le stockage local,
sous `BackroomsSavePayload.environmentSession`. Cache mémoire limité à 128 entrées,
sans balayage de l’historique par chunk. Les anciennes sauvegardes restent lisibles.
Si le stockage est désactivé ou plein, le jeu continue avec ce cache ; une persistance
illimitée n’est alors pas garantie. Les sauvegardes d’une session partagent l’état
des découvertes de ce monde.

## Validation

Les tests dédiés couvrent espacement anisotrope, fusion des fragments et pièces
closes, salle de la chaise réelle (vide, fermée, reliée, éclairée), plans infinis
et IDs, eau, alarmes multiples, deux issues du téléphone, servo, stations
successives de la chaise, persistance après éviction, offsets/collisions Rapier,
remplacements de vue, 50 cycles de streaming, sons 3D/nettoyage et shaders. Les
suites du chasseur, de la faille et des sauvegardes protègent leur intégration.
En jeu, `/locate alarme|neons|inondation|telephone|chaise|camera` (alias
`evenement`) mène à un événement du voisinage chargé. Les sondes CPU ne
remplacent pas une validation visuelle WebGL.
