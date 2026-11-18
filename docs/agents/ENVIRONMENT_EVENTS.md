# Événements environnementaux

`world/EnvironmentEvents.ts` contient les données sérialisables, les probabilités
et le registre des contraintes. `generateInfiniteChunk` l’appelle après la géométrie
spatiale finale et avant `populateRareProps`. Les monuments historiques, dont
`epic3`, restent exclus. Le plan spatial passe en version 21 ; les sols et leurs
ancres de sauvegarde restent identiques.

## Tirages et géométrie

Une cellule régionale de 28 m représente une opportunité, indépendamment du
nombre de petites surfaces de sol. Réglage : `ENVIRONMENT_EVENT_CONFIG`.

| Événement | Probabilité de proposition |
|---|---:|
| Alarme incendie | 0,15 % |
| Néons clignotants | 0,5 % |
| Eau peu profonde | 0,6 % |
| Téléphone | 0,4 % |
| Chaise solitaire | 0,3 % |
| Surveillance | 0,5 % |
| Gouttes | 10 % des zones inondées |

Un seul tirage catégoriel évite plusieurs événements par cellule. L’amincissement
par priorité compare les propositions voisines sans générer leurs plans : il
réserve **36 m entre centres de salles en 3D**, plus la marge du déplacement des
centres. Les altitudes viennent de `regionalDatum`, même sur les autres étages.
Cette exclusion et la compatibilité géométrique diminuent les fréquences finales.
Une proposition incompatible n’est jamais forcée ni remplacée par un autre type.

Seules les salles ouvertes, complètes dans leur propriétaire, plates, assez hautes
et éloignées des réservations architecturales sont retenues. Les supports muraux
utilisent une face réelle avec dégagement accessible. Les références de murs,
salles et néons sont préfixées par `InfiniteWorld`.

La chaise réserve une grande pièce BSP existante (au moins 12 m de côté et 190 m²),
vide d’obstacles intérieurs ; mobilier générique et scènes y sont exclus. L’eau à
3,5 cm est découpée selon les sols, murs et ouvertures. Les surfaces adjacentes ne
créent pas de coutures sèches artificielles.

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
aux surfaces proches du boîtier selon les trois impulsions de la sirène.

`audio/EnvironmentAudio` utilise le contexte et le bus maître d’`AudioSystem`, des
`PannerNode` HRTF/inverse, un compresseur et un budget de 28 voix. Les échantillons
synthétiques sont conservés une fois par session. La voix française murmurée est
un petit Vorbis local déclaré dans les licences. Sonnerie avec hystérésis ; alarme
atténuée avant de perdre son propriétaire. Pause et volume restent communs.
Tous les nœuds audio, géométries, textures et matériaux possédés sont libérés au
démontage, y compris les chargements de modèle terminés trop tard.

## États et Bacteria

`EnvironmentBehavior` porte les transitions pures du téléphone et de la caméra.
Le téléphone consomme sa découverte au décroché : fuite, déchargement et reprise
ne relancent pas l’appel. Les dix secondes commencent après la phrase audible.
Un retournement exige 115° horizontaux pendant 120 ms. Sans retournement : souffle
croissant, un pas derrière et raccrochage. Le combiné utilise la cadence d’effort
du joueur ; aucune capture de microphone.

Durant l’appel, la navigation existante se prépare. `RiftEncounter` prête le chasseur
uniquement en phase libre `north` ou `done`, créature cachée et chasseur dormant.
`BackroomsHunt` choisit un sol relié et libre à 8–24 m, derrière la caméra, hors
frustum. Il lance la poursuite existante sans créer ni remplacer une créature
active. L’étape narrative reste inchangée ; capture/reprise conservent son checkpoint.
Sans position valide ou si la créature est occupée, aucune apparition n’est forcée.

L’apparition des néons est un acteur distinct, sans physique ni IA, chargé à
l’approche. Il réutilise le modèle et la marche `stalk`. Sa fenêtre visible est
encadrée par deux coupures complètes. Une découverte consommée ne se rejoue pas.
La chaise ne change qu’une fois, après une visite, à plus de 12 m de la pièce,
pendant 1,5 s sans visibilité (frustum et plusieurs rayons). La caméra gèle à
proximité ; elle ne repart qu’après éloignement, délai et absence de regard, avec
vitesses de rotation bornées.

`EnvironmentStateStore` écrit les petits deltas nécessaires dans le stockage local,
sous `BackroomsSavePayload.environmentSession`. Cache mémoire limité à 128 entrées,
sans balayage de l’historique par chunk. Les anciennes sauvegardes restent lisibles.
Si le stockage est désactivé ou plein, le jeu continue avec ce cache ; une persistance
illimitée n’est alors pas garantie. Les sauvegardes d’une session partagent l’état
des découvertes de ce monde.

## Validation

Les tests dédiés couvrent espacement, plans infinis réels et IDs, eau, deux issues
du téléphone, servo, persistance après éviction, offsets/collisions Rapier, retours,
remplacements de vue, 50 cycles de streaming, sons 3D/nettoyage et composition des
shaders. Les suites du chasseur, de la faille et des sauvegardes protègent leur
intégration. Les sondes CPU ne remplacent pas une validation visuelle WebGL.
