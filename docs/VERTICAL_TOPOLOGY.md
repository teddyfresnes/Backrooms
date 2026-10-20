# Architecture régionale à plusieurs couches

Le monde ordinaire utilise `WorldPlan.version = 11`, `topology.version = 2` et
`spatial.version = 2`. Le BSP v10 reste disponible explicitement dans
`generateLegacyWorld` / `generateLegacyInfiniteChunk` pour les monuments,
leurs résumés et les reproductions `RAW_LOCAL_`.

## Planification avant construction

`RegionalPlan` découpe le monde en cellules de 28 m. Un Voronoï mondial, avec
sites espacés de 168 m et influence bornée à neuf sites, attribue les districts.
Leur altitude est un tirage signé dans [−7,5 ; +7,5] m, quantifié à 5 cm.
Un district traverse plusieurs chunks et contient des dizaines de pièces.
Zéro n’a aucun statut particulier, sauf dans le collier de compatibilité des
entrées monumentales historiques. Ce collier ne concerne que leurs cellules
limitrophes ; les autres cellules gardent leur relief.

L’adresse `(x,z,story)` possède des données locales. Son offset monde est
`(112*x, 5.4*story, 112*z)`. Un datum local n’est pas cet offset. Les tranches
ordinaires répètent la même géographie horizontale à ce pas d’adresse ; les
atria remplacent trois tranches par un volume libre commun. Ce choix borné
n’est pas un partitionnement volumétrique arbitraire de tout l’espace 3D.

Le pipeline est : districts → cellules/couches/atria → circulations → sols et
plafonds → cloisons/façades/portes → graphe et volumes → lumières et props.
Un chunk est une matérialisation bornée du plan mondial, sans récursion ni
consultation de voisins déjà générés. Le cache de datums est limité à 2048
entrées et vidé par `clearInfiniteWorldCaches` avec les caches legacy bornés.

## Surfaces, volumes et propriétaire

`WalkableSurface` décrit un profil plat ou linéaire, une couche, un propriétaire,
une épaisseur et un plafond explicite, éventuellement profilé. `SpatialArchitecture`
contient les cellules, prismes, plafonds, interfaces, dépendances et landmarks.
Tout est sérialisable ; Three/Rapier ne figurent jamais dans un plan.

Les dalles font 16 cm, les plafonds suspendus 3 cm. La sous-face d’une pente est
extrudée suivant sa normale. Les huit sommets et indices des prismes sont
communs au rendu et aux colliders. Les murs cisaillés des raccords utilisent
exactement les mêmes triangles Rapier, sans approximation par enveloppe convexe.
Ils rejoignent le sol adjacent et le parcours ; aucun support ne descend à zéro.
Les grands sols utilisent aussi leurs faces triangulées orientées : un recalage
Rapier sur la sous-face d’une boîte mince était reproductible dans la boucle
longue aux coordonnées symétriques. Les marches conservent leurs solides exacts.

Les halls et ensembles à colonnes peuvent fusionner entre cellules d’un même
district. Les cloisons à portes décalées, les changements d’épaisseur, les
colonnes, les portes interactives et les circuits de blackout restent générés.
Les colonnes retirent leur emprise des sols de navigation ; leurs IDs n’altèrent
pas les autres surfaces. Les variantes BSP plus anciennes appartiennent au
chemin legacy, pas à la distribution des nouveaux chunks ordinaires.

## Circulations réelles

Deux districts raccordent leurs datums par un palier partagé à leur moyenne,
sans retour à zéro. Chaque demi-parcours a 9 m utiles et deux paliers de 1 m.
Une pente jusqu’à 0,30 utilise une rampe ; sinon le nombre de marches est déduit
du dénivelé avec une contremarche maximale de 17,5 cm. Les datums intermédiaires,
bifurcations et directions se poursuivent sur plusieurs cellules.

Une cellule intérieure de district peut devenir un atrium ordinaire. Une phase
canonique par bande de quatre adresses lui donne un propriétaire haut, une
adresse intermédiaire vide et un bas jouable deux adresses plus bas. Les trois
plans sont générables indépendamment. Le bas contient de vraies pièces,
cloisons, lumières et continuations vers le labyrinthe voisin.

Le haut possède une galerie de 3 m longeant les murs, et selon la variante une
passerelle ou un retour. Les escaliers droits, en L ou en U font 3,2 m de large ;
leurs volées et paliers partagent le même tracé avec les découpes du bas. Le
passage inférieur sous un escalier n’existe que si son dégagement atteint 2,5 m.
Les secteurs trop bas sont fermés par des solides visibles correspondants.
Les poutres des lumières inférieures sont réellement ancrées aux cloisons.

L’adresse intermédiaire contient des ouvertures hautes à seuil réel. Elles
permettent de descendre de 5,4 m dans le bas, sans rampe ni retour direct par
saut. Certaines passerelles ont une coupure de 1,4 m : le saut couru fonctionne
dans les deux sens, la marche seule tombe, et le tour par la galerie reste possible.
Les parapets restent entièrement sur leur dalle et s’interrompent aux passages.

Les limites d’amplitude régionales sont explicites. Les grands escaliers d’atrium
franchissent 10,8 m ; les escaliers interdistricts joignent des dénivelés variables.
Les anciens sockets acceptent aussi `rise` / `stepsPerFlight`, avec leurs valeurs
historiques par défaut pour les monuments existants.

## Graphe et interfaces

Les arêtes distinguent marche, rampe, escalier, accroupissement, saut, chute et
vue. `direction = forward` décrit les chutes ; les relations `view` ne participent
pas au flood-fill. Un croisement projeté en X/Z ne crée aucune connexion.
La largeur est dérivée des bords communs après retrait des murs et marge capsule.

`reachability` distingue local, régional, visible seulement et isolé. Une surface
régionale non atteinte dans le seul plan local n’est pas déclarée scellée : elle
peut dépendre d’un autre propriétaire. Les arrivées externes désignent soit une
surface réelle préfixée, soit un nœud canonique d’interface partagé.

Chaque `EdgeGate` porte hauteur, largeur, couche et dégagement. Les mêmes
cellules mondiales produisent les deux côtés. Les halls partagent de larges
ouvertures ; les autres entrées font 4 m. Une zone plate franchit une frontière
sans pente artificielle. Les portes monumentales conservent leurs mesures et un
vestibule de 5 m libère les cloisons perpendiculaires à leur entrée décalée.

Les IDs possédés et leurs références reçoivent `chunk-x:z:story/`. Les IDs
`interface/...` sont mondiaux et ne sont pas préfixés. `arrival` est exprimé dans
le repère du plan source ; convertir avec les offsets avant d’interroger la cible.

## Runtime, lumière et sauvegardes

`WorldStream` choisit d’abord le propriétaire du support physique, puis celui du
volume libre courant. `regionalOwnerAt` sert de repli sans support monté.
Le 3×3 de base est complété par au plus 12 propriétaires de dépendances, dans
une portée horizontale de 36 m et une enveloppe verticale élargie de 12 m.
Le démarrage, la localisation et la restauration préparent ces destinations.
Le personnage et les ragdolls conservent les réglages actuels et le même Rapier.

`buildSpatialArchitecture` rend uniquement les surfaces et prismes du nouveau
plan. Aucune reconstruction héritée ne rajoute un sol ou plafond à zéro. Les
UV restent à l’échelle monde sur les rampes, marches, chants et sous-faces.

Les deux rendus utilisent `RegionalLighting`, atlas 64×64 avec trois intervalles
verticaux par texel. Une lumière n’affecte que le volume libre qui la contient.
Ce champ module l’exposition et conserve les blackouts ; le mode classique le
combine avec son bake. C’est une approximation d’éclairage, sans preuve de
compilation GPU, d’ombres exactes ou de qualité visuelle dans les tests Node.
L’atlas est libéré avec chaque vue ; il ne crée pas un shader par seed.

Le schéma de sauvegarde 2 reste lisible. L’ancrage optionnel `{version,id,layer}`
et l’adresse enregistrée retrouvent le support. Un ancien ancrage est reprojeté
sur le plan du propriétaire sauvegardé (fenêtre de 20 m), puis la capsule est
vérifiée. Une position obstruée ou sans support utilise le spawn sûr de ce plan.
Les arrivées après chute sont acceptées même sans trajet local depuis le spawn.

`/locate` propose `grand-plateau`, `rampe-regionale`, `escalier-regional`,
`escalier-l`, `escalier-u`, `escalier-bridge`, `galerie-l`, `galerie-u`,
`galerie-bridge`, `ouverture-haute` et `saut-passerelle` dans les plans montés.
`/logs` expose notamment la version du plan et le propriétaire courant.

Les preuves, mesures comparables et parcours sont dans
[REGIONAL_VALIDATION.md](REGIONAL_VALIDATION.md).
