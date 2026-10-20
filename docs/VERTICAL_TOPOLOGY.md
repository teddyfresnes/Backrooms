# Topologie verticale

Le BSP conserve la version 10 et ses forks historiques. Les anciennes propositions
de raised-zone participent encore aux réservations des passes héritées, puis sont
retirées avant la résolution du sol. `topology.version = 1` versionne ce contrat
séparément, sans redériver toute la trame des pièces.

## Données communes

`WalkableTopology.ts` décrit profils plats et linéaires, couches, connexions,
volumes libres et solides. Les empreintes d’un coude sont des rectangles exacts.
Un balcon possède une dalle et une sous-face ; la circulation sous cette dalle
est une surface indépendante reliée au sol par deux accès.

`RoomRecord.floorY` est un datum local. `ceilingHeight` reste le plan absolu du
plafond local ; `structuralCeilingY` conserve le plafond avant résolution.
`level` garde son sens historique. L’altitude mondiale est
`story * 5.4 + altitudeLocale`. Le story est un propriétaire et une adresse.

`findSurface` exige une altitude aux pieds et accepte une couche. Sa fenêtre
est +0,38 / −1,20 m. Le streaming utilise +0,20 / −0,50 m et conserve aussi le
propriétaire du volume libre pendant un saut. Une chute dans un puits dépourvu
de surface peut toujours changer de story.

Les huit sommets du prisme sont communs à Three et Rapier. L’épaisseur d’une
dalle suit sa normale, y compris le décalage horizontal de la sous-face. Un
support plein descend à `supportBottom`. Il n’est jamais remplacé par une boîte
rectangulaire traversant l’entrée latérale d’une pente.

## Contraintes et pipeline

Un potentiel unique par pièce rend les boucles cohérentes. Un secteur contient
une à trois pièces ; le solveur accepte au plus huit secteurs après 48 propositions.
Il privilégie les voisins de secteurs déjà décalés, avec les datums −0,8, −0,45,
+0,4, +0,9 et +1,6 m. Un nouvel essai réduit localement l’amplitude. Une proposition
impossible reçoit un diagnostic. Une pièce sans connexion publique n’est pas élevée.

Les galeries en L et en demi-tour comportent de vrais paliers, un étage haut à
+1,8 m et un passage bas à −0,9 m. Les passerelles rejoignent l’architecture
opposée. La première pente conserve un dégagement de capsule devant elle.

Quantification : 0,05 m. Tolérance : 0,002 m. Circulation ordinaire : hauteur
minimale 2,50 m, largeur 1,60 m et pente maximale 0,42. Le solveur vise 0,30 et
des dégagements de 1,10 m. Les passages accroupis hérités restent identifiés ;
leur hauteur utile minimale est 1,28 m. Aucun réglage du contrôleur n’est augmenté.

Les réservations et frontières précèdent le solveur. Murs, plafonds, colonnes,
lumières et sols sont ensuite raccordés ensemble. Les découpes finales de puits
suivent la reconstruction des coques. Le graphe relie les bandes résiduelles
entre pièces après érosion par la capsule et découpe des obstacles. Il ne relie
pas deux couches qui partagent seulement leurs coordonnées X/Z.
Un premier graphe avec la capsule réelle sert aussi à choisir les secteurs ; le
flood-fill historique projeté ne peut plus déclarer seul un nouveau parcours.
`accessReason` distingue une restriction intentionnelle d’un composant sans accès.

## Région et interfaces

Les grandes hauteurs portent sur quatre stories au maximum. La région lit des
résumés bruts de huit stories inférieurs, sans génération récursive. Les
propriétaires inférieurs ont priorité ; puits, escaliers, entrées canoniques et
architecture protégée restent prioritaires. Une enveloppe incompatible revient
à un plafond confortable de 4,30 m avec un diagnostic. Les réservations gardent
leurs intervalles et propriétaire ; elles restent distinctes des ouvertures et aperçus.
La portée inclut le dessous possible des sols du story voisin, jusqu’à −1,06 m,
même quand le volume s’arrête avant son datum zéro. Une telle réservation peut
interdire un secteur encaissé sans retirer le sol ordinaire au-dessus. Les dalles
de sol font 0,16 m et les dalles de plafond suspendu 0,03 m ; ces deux épaisseurs
ne sont pas confondues dans le contrôle d’intersection entre stories.

Chaque `EdgeGate` sérialise altitude, couche, dégagement et épaisseur de dalle.
Les deux côtés possèdent un palier et une approche inclinée compatibles. Les
offsets incompatibles avec une gaine ou un accès protégé sont déplacés avec un
nombre borné d’essais. Les monuments conservent leurs propres contrats.

Caches bornés : 256 résumés structurels, 192 interfaces et enclos, 64 régions,
et 192 entrées pour les caches historiques d’ouvertures. `clearInfiniteWorldCaches`
les vide. Les interfaces transmises dans le plan worker évitent une nouvelle
résolution lors du montage sur le thread principal.

## Runtime et migration

Les surfaces alimentent rendu, collisions, spawn, récupération, localisations,
supports des props et propriétaire du streaming. Le personnage, les PNJ et les
ragdolls interrogent le même monde Rapier. Les éclairages moderne et classique
partagent l’occlusion des dalles, en distinguant leur dessus et leur dessous.

Les sauvegardes de schéma 2 restent lisibles et ajoutent éventuellement un
ancrage `{version, id, layer}`. La restauration reprojette la position sur ce
support et vérifie la capsule debout ; une position obstruée utilise le spawn sûr.

`?seed=RAW_LOCAL_VERTICAL-PROMPT-AUDIT-3` conserve le seed BSP brut du signalement
dans le chunk racine. Ses voisins restent coordonnés. Sans ce préfixe, le seed
est global et chaque chunk conserve sa dérivation habituelle.

Les commandes `/locate rampe`, `/locate balcon`, `/locate passerelle` et
`/locate secteur-encaisse` utilisent les surfaces montées.

Les tests `WalkableTopology`, `VerticalTopology`, `InfiniteVertical` et
`WorldStreamVertical` couvrent profils Three/Rapier, largeur utile, chaînes,
couches, coutures négatives, caches, démontages physiques et restauration.
