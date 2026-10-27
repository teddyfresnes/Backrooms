# Vocabulaire liminal ordinaire

Les familles enrichissent `generateInfiniteChunk`. Le BSP de 224 m, ses tirages,
datums et murs épais restent la base. Plan version 17 ; topologie et spatial
version 2. Les sauvegardes gardent leur format de pose et d'ancrage de surface ;
le repli de `restoreSurfacePosition` retrouve un sol si un ancien ID disparaît.

## Parois percées

`ArchitecturalOpenings` fournit les données sérialisables et le profil partagé.
Une semi-ellipse échantillonnée dérive les intrados visibles et les colliders,
avec au plus 12 segments. Les volumes ferment avant, arrière, jambages et chants
sur toute l'épaisseur. Les UV utilisent les constructeurs spatiaux existants.

`passageRow` propose neuf compositions : arche unique, rangée, groupe à une
extrémité, deux groupes, alternance rectangulaire/arrondie, fenêtres hautes,
rangée rectangulaire, grande baie accompagnée de petites et niveaux mélangés.
Au plus six baies ; supports d'au moins 65 cm ; courbe praticable à au moins
2,15 m au bord. Les dimensions dépendent de la portée et du vrai plafond.

`installOrdinaryArchitecture` intervient après `BspConnectivity` et la première
réconciliation des appuis/plafonds. La réparation BSP ne peut donc pas aplatir
une arche. Les sols sont redécoupés si une paroi a été ajoutée. Les finitions
restent celles de `SpatialBaseboards` sur les solides finaux et la pièce canonique.

22 % des districts reçoivent une probabilité candidate de 50 %, les autres 3,5 %.
Il faut encore un plateau d'au moins 9 × 6,4 m, sans réservation ni transition
incompatible. Budget de deux parois par propriétaire, classées par un fork
indépendant. Les fenêtres hautes seules gardent un détour latéral de 2,2 m.

## Galeries partielles

`RegionalPlan` conserve existence, phase, propriétaire et profondeur historiques.
Un fork transforme 48 % des atria à galerie sans escalier ni passerelle L avec
saut. Compositions : un côté, deux côtés opposés de longueurs différentes,
L partiel ou mezzanine d'extrémité. Les anciens gradins restent sur leur chemin.

`LiminalAtrium` construit une circulation de service derrière quatre façades
intérieures. Les raccords extérieurs rejoignent ces vrais couloirs ; ils
n'imposent pas quatre portes centrales visibles dans la grande salle.
Seuls les côtés choisis portent des galeries extérieures. Un niveau peut être
absent et son tunnel déboucher sur une chute. Les soubassements pleins rejoignent
le sol par bandes de propriétaire ; retraits de 2,4 m vers les niveaux bas.

Une terrasse pleine de 0,8–2,2 m peut occuper la salle basse, avec une seule volée
si elle tient hors des arrivées et appuis. Aucun accès automatique aux vues.
Les fenêtres hautes gardent leur rôle `view` vers le vrai plancher inférieur.

`connectSpatialSurfaces` joint les morceaux adjacents à leur frontière commune.
Ne pas ajouter un raccourci de marche entre les deux côtés éloignés d'un mur :
il sauterait le seuil. `connectArchitecturalOpenings` publie les vues, sauts et
chutes explicites. Les références sont préfixées selon le propriétaire cible.
Une vue n'est jamais réparée comme une marche réciproque.

Les dépendances couvrent les propriétaires verticaux et voisins réellement
visibles. Rayon global, caches bornés, lots et préparation worker sont conservés.
Les fixtures et réglages lumineux existants restent utilisés, sans source par arche.

## Fosses

`LiminalPits` propose puits décentré, faille, deux puits et cour encaissée.
`SpatialFeatures` l'essaie seulement si le chemin historique n'a rien proposé :
aucun motif de grille ni tirage ancien n'est remplacé.
Les phases source/traversée/arrivée sont canoniques et indépendantes de l'ordre.
Profondeurs de 1, 2, 3 ou 5 adresses ; vides de 10 adresses, au-delà de la
récupération existante de 48 m. Toute la portée refuse les conflits d'atrium.
Chaque propriétaire traversé est percé et fermé autour du vide. L'arrivée
explorable possède un vrai plancher ; aucun faux fond dans un vide mortel.
Les rectangles de géométrie ne doivent contenir que quatre coordonnées, sans
les champs textuels de `PitHole`.

## Vérification

`ArchitecturalOpenings.test.ts` confronte les triangles et Rapier dans les deux
axes, les jambages, fenêtres et traversées. `LiminalGeneration.test.ts` teste
les quatre compositions ordinaires, leurs tranches, seuils, chutes, fosses,
volée fractionnaire et coutures négatives indépendantes de l'ordre.
`node scripts/run-liminal-audit.mjs rapport.json` mesure 320 seeds ordinaires,
160 seeds distincts et les piles complètes rencontrées. `LIMINAL_SAMPLE` ajuste
le corpus. L'audit contrôle triangles Float32, normales et vraies destinations.
`node scripts/audit-liminal-preservation.mjs ancien-checkout` compare les
propositions historiques, datums et cinq monuments et mesure la surface BSP.
Ces sondes CPU ne prouvent ni l'apparence WebGL ni les FPS.
