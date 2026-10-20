# Validation de l’architecture régionale

Relevé du 20 octobre 2026, Node 24.19.0, Three 0.185.1, Rapier 0.19.3.
Référence conservée : `f5cf66e4367402e4cf5c482fa43f11ef2224fb39` (PR #2).
Code fonctionnel : `e7599f2b0887627e9de9a6cce1e599c2fd884c6e`.
Le [contrat](VERTICAL_TOPOLOGY.md) décrit les limites et les repères de coordonnées.

## Ce qui a changé

Le relief régional précède désormais les pièces, les circulations et les détails.
Les districts traversent les chunks ; leurs datums signés remplacent le plancher
zéro et la petite palette de décalages locaux. Les volumes d’atrium ont trois
propriétaires réels, avec galeries, bas jouable, escaliers et ouvertures hautes.
Les liens distinguent marche, pente, escalier, saut, chute orientée et vue seule.

Les murs cisaillés, les dalles, les sous-faces, les seuils et les découpes partagent
leurs données avec Rapier. Le builder ordinaire ne reconstruit plus les anciennes
coques à zéro. Les parapets restent sur leur dalle et s’ouvrent aux passages.
Les cinq entrées monumentales gardent leurs mesures ; leurs vestibules dégagent
les cloisons perpendiculaires à une porte décalée.

Le long parcours a détecté un autre défaut : à `(-182, 7.065, -182)`, un recalage
Rapier pouvait placer la capsule environ 18,8 cm trop bas sur une dalle mince.
Les grands sols emploient maintenant leurs faces triangulées orientées communes
au rendu. La boucle complète passe ensuite dans les deux sens, sans changement
des capacités de marche, de pente, de saut ou de hauteur de marche.

Les anciennes propositions locales restent explicitement dans le pipeline legacy
pour les monuments et `RAW_LOCAL_`. Les 194 tests BSP historiques valident ce
chemin conservé ; ils ne servent pas à déclarer la nouvelle distribution conforme.

## Contrôles exécutés

| Contrôle | Résultat |
| --- | --- |
| Suite générale finale | 539 réussis / 540 ; unique échec d’asset décrit ci-dessous |
| Personnage, véritables FBX et Rapier | 637 régressions + 2 nouveaux cas régionaux ; commande finale réussie |
| TypeScript et build Vite du dépôt | Réussis |
| Contrats régionaux | Datums, clonage worker, IDs, cibles externes et ordre/cache |
| Escaliers générés | L, U et droit : descente et remontée de 10,8 m |
| Rampe régionale | Marche, course, arrêt, inversion, deux datums non nuls |
| Boucle régionale | 392 m dans chaque sens, quatre chunks, trois datums, amplitude 10,05 m |
| Ouverture haute | Réception 5,4 m plus bas ; remontée directe par saut impossible |
| Coupure de passerelle | Saut couru dans les deux sens ; marcher seul provoque la chute |
| Superposition | Marche sous le pont ; rayons Three/Rapier sur sa sous-face ; aucun sol intermédiaire |
| Géométrie des raccords | Rayons sur 24 prismes cisaillés et tests de capsule sur toute la largeur des portes |
| Monuments conservés | Approches des cinq types, quatre côtés, plusieurs profondeurs et positions latérales |
| Sauvegarde et streaming | Propriétaire réel, migration v1, réception irréversible et trois cycles de montage/démontage |
| Deux rendus | Construction CPU des vues et séparation des volumes lumineux ; textures libérées |
| Ragdoll régional | Corps joueur et partagé : chute à travers trois propriétaires, contact avec le vrai bas |

L’unique échec général est `ImportedApartmentIntegration`, qui attend le nom
racine `ImportedApartmentScene_v1.19.2` et reçoit `russian_cigarette_pack(1).glb`.
Le même test échoue sur la référence f5cf, avec 14 autres tests de ce fichier
réussis. Aucun asset de l’appartement n’est remplacé pour contourner ce contrôle.

Les corps articulés conservent leur politique historique : les objets Rapier
invalidés sont désactivés puis libérés à `world.free()`, afin d’éviter le problème
WASM de suppression des articulations actives. Les nouveaux plans statiques et
textures sont retirés à chaque démontage ; ce changement ne refond pas cette
politique des ragdolls.

## Distribution normale, objectifs et relevés

Les seuils sont déclarés dans le script avant le relevé : amplitude régionale
≥12 m, part de zéro <10 %, plateau ≥20 cellules et ≥3 propriétaires horizontaux,
chaque famille dans ≥3 seeds, aucun dégagement ordinaire <2,498 m, aucune
isolation accidentelle ni interface incohérente.

L’échantillon comprend 128 seeds `VERTICAL-PROMPT-AUDIT-0…127` à `(-1,1,0)` et
huit seeds `REGIONAL-AUDIT-0…7`, chacun sur un voisinage 5×5 de chunks :
328 plans ordinaires, sans monument ni feature forcée dans cet échantillon.

| Mesure | Relevé |
| --- | --- |
| Datums régionaux observés | −7,50 à +7,35 m ; amplitude 14,85 m |
| Part de surface à zéro | 0,198 % ; distribution pondérée par emprise praticable |
| Plus grand plateau observé | 53 cellules, six chunks, emprise 41 552 m², étendue 196×224 m |
| Interfaces contrôlées | 1 280 passages ; 99,92 % à une hauteur non nulle ; aucun désaccord |
| Atria avec haut et véritable bas superposés | 113 |
| Liens de descente orientés / vue seule / saut | 440 / 113 / 48 |
| Dégagements invalides / isolations accidentelles / erreurs de topologie | 0 / 0 / 0 |
| Retours à plat de secours du planificateur ordinaire | 0 ; construction déterministe bornée |

Sur les 128 seeds de distribution : rampes régionales dans 115, escaliers
régionaux dans 92, ouvertures hautes dans 37, escaliers L/U/droits dans 14/8/15,
galeries L/U/pont dans 15/9/20 et coupures de passerelle dans 15.
Les [résultats bruts](validation/regional-distribution.json) contiennent
l’histogramme pondéré, les régions, les familles, les liens et les exemples.
La longueur des arêtes entre centres est un indicateur de graphe, pas la longueur
physiquement parcourue ; la boucle de 392 m est vérifiée séparément par Rapier.

## Coûts comparables

Même environnement et mêmes 24 seeds `VERTICAL-PROMPT-AUDIT-0…23`, même adresse
`(-1,1,0)`, sans autre build/test pendant les mesures. Les caches infinis sont
vidés avant chaque mesure froide et amorcés hors chronométrage pour le chaud.
Les fonctions de mesure architecturale sont identiques sur f5cf et sur le code livré.

| Mesure | Référence : médiane / P95 | Livré : médiane / P95 |
| --- | --- | --- |
| Génération finie (ms) | 60.75 / 139.17 | 17.72 / 69.11 |
| Génération infinie froide (ms) | 458.46 / 543.82 | 14.82 / 40.77 |
| Génération infinie chaude (ms) | 84.11 / 129.13 | 11.57 / 27.60 |
| Clonage du plan froid (ms) | 3.68 / 7.10 | 9.22 / 15.69 |
| Préparation architecture Three (ms) | 58.22 / 108.68 | 25.76 / 51.56 |
| Montage Rapier (ms) | 4.19 / 6.60 | 11.84 / 21.45 |
| JSON du plan (Mo décimaux) | 0.54 / 0.81 | 1.31 / 2.58 |
| Colliders | 698.00 / 1173.00 | 1186.00 / 2013.00 |
| Triangles rendus | 22520.00 / 40664.00 | 14312.00 / 24270.00 |
| Lots de matériaux | 25.00 / 36.00 | 8.00 / 9.00 |
| Pic du tas JS échantillonné (Mo) | 140.09 | 180.55 |
| Delta retenu après nettoyage/GC (Mo) | 5.52 | 3.43 |

La génération et la préparation Three baissent ; le plan sérialisé, le clonage
et le montage physique augmentent. Le P95 de montage Rapier dépasse le budget
de 16,7 ms d’une frame à 60 Hz ; aucune fluidité navigateur n’est déduite de ces mesures.

Les lots de matériaux ne sont pas des draw calls. Le montage CPU Three omet les
meshes de props, les graffiti et les textures. Rapier monte les colliders produits.
Le tas JS exclut les allocations WASM/GPU ; son delta retenu inclut les caches.
Les détails avant/après sont conservés dans
[before](validation/regional-before.json) et [after](validation/regional-after.json).

| Mesure worker CPU | Référence : médiane / P95 | Livré : médiane / P95 |
| --- | --- | --- |
| Worker moderne froid, aller-retour (ms) | 492.83 / 635.52 | 34.30 / 69.34 |
| Worker moderne chaud, aller-retour (ms) | 88.75 / 138.92 | 21.38 / 43.44 |
| Transfert + dispatch froid (ms) | 4.45 / 8.32 | 9.97 / 20.95 |
| Bake classique froid (ms) | 692.03 / 1093.07 | 427.51 / 705.61 |
| Worker classique froid, aller-retour (ms) | 1186.81 / 1567.61 | 444.10 / 722.95 |

Le proxy worker Node appelle les mêmes fonctions de génération/bake et effectue
un vrai transfert par clonage structuré. Il ne mesure pas l’ordonnancement du
Worker navigateur, ses frames ou ses saccades. Voir les données
[avant](validation/regional-worker-before.json) et [après](validation/regional-worker-after.json).
Le budget de streaming reste le 3×3 de base plus au maximum 12 propriétaires
visibles/proches. Le coût d’une scène complète à ce maximum n’a pas été mesuré au GPU.

## Parcours reproductibles

Ces seeds sont globaux, sans préfixe `RAW_LOCAL_`. Le plan courant doit afficher
la version 11 dans `/logs`. Rejoindre le Level 0 par la porte du hall comme avant.
Les positions ci-dessous sont les centres de capsule, pas les altitudes de caméra.
Utiliser `/locate` pour les cibles montées ; pour un point distant, `/noclip on`
et `/logs` permettent de rejoindre ses coordonnées avant de rétablir la marche.

| Cas | Seed et positions mondiales `(x,y,z)` | Parcours / sens |
| --- | --- | --- |
| Grande zone basse et couture | `REGIONAL-AUDIT-0` : `(-169,-2.335,-98)` → `(-167,-2.335,-98)` | Datum −3,20 m commun aux chunks `(-2,-1,0)` et `(-1,-1,0)` ; marche réciproque sans rampe de compensation |
| Plusieurs montées/descentes | `REGIONAL-AUDIT-0` : départ `(-182,7.065,-210)` | Suivre les 14 centres de [la boucle](validation/regional-loop.json), puis le trajet inverse ; sols +6,20 / −1,05 / −3,85 m |
| Escaliers paramétrés | `REGIONAL-AUDIT-6` : L `(23.4,6.565,2.5)` → `(2.5,-4.235,23.4)` ; U `(-32.6,6.565,2.5)` → `(-36.2,-4.235,2.5)` | Descendre les volées puis remonter ; `/locate escalier-l` et `/locate escalier-u`. Le même seed contient les deux dispositifs ordinaires |
| Ouverture haute | `REGIONAL-AUDIT-0` : `(28.75,2.515,42)` → `(32,-2.885,42)` | Avancer vers l’est pour descendre ; depuis le bas, l’ouverture reste 5,4 m au-dessus, sans rampe directe ni saut de retour |
| Galerie et bas jouable | `REGIONAL-AUDIT-6`, haut autour de `(14,6.565,1.5)` ; bas par l’escalier L ci-dessus | Longer le mur, voir les pièces inférieures, descendre puis parcourir leurs cloisons et sorties ; remonter par le même escalier |
| Croisement sans connexion | `REGIONAL-AUDIT-7` : pont `(42,1.815,42)`, dessous `(42,-8.985,42)` | Les parcours partagent X/Z, avec 10,8 m d’écart ; le test marche sous le pont et contrôle sa sous-face réelle |
| Boucle et détour | `REGIONAL-AUDIT-6` : coupure `(7.7,6.565,17.6)` → `(10.3,6.565,17.6)` | Saut couru bidirectionnel ; le tour par la galerie contourne le vide. La boucle régionale fournit un autre parcours long fermé |
| Volume sur trois adresses | `REGIONAL-AUDIT-20` : `(51.4,4.665,30.5)` → `(51.4,-6.135,53.5)` | Escalier droit entre propriétaires 0 et −2, avec adresse −1 traversée sans dalle parasite ; vues possibles du haut et du bas |
| Raccords signalés | `REGIONAL-AUDIT-0` : `/locate rampe-regionale` près de `(-50.5,1.3025,-42)` | Examiner chants, murs latéraux, plafond et dessous dans les deux rendus. Les rayons et capsules valident la géométrie ; la capture initiale n’est pas une preuve visuelle du nouveau rendu |

Les [exemples physiques](validation/regional-physical-examples.json) utilisent les
mêmes seeds ordinaires que les tests, sans forcer de famille. Le cas historique
`RAW_LOCAL_VERTICAL-PROMPT-AUDIT-3` reste une reproduction legacy distincte du
seed global ; il ne démontre pas la nouvelle géographie.

## Livraison et limites de vérification

La branche de la [PR #2](https://github.com/teddyfresnes/Backrooms/pull/2) conserve
la précédente livraison puis les commits de refonte, d’intégration et de correction.
Le Site existant reste [Backrooms — version intégrée](https://backrooms-integre.teddykoeh.chatgpt.site),
avec ses accès actuels et ses chargeurs spécifiques d’appartement et de garde-robe.
Version **11 publiée**, source hébergée
`3292edf2f2f2823e5c4e53b9026bedcbc66248d6`. La compilation hébergée réussit,
les 50 tests verticaux passent et 148 éléments de garde-robe sont vérifiés sans
perte de données. Les [identifiants de livraison](validation/regional-delivery.json)
relient le code du dépôt, la source du Site, la version et le déploiement confirmé.

Aucun contrôle visuel WebGL, aucune capture dans les deux rendus, aucun draw call,
FPS, temps de frame ou ombre GPU n’est attesté. Le [skill Sites](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md) prescrit :
« If `$control-browser` is unavailable, skip browser QA ». Ce navigateur n’est
pas disponible dans cette session ; aucun autre navigateur n’est substitué.
Les défauts visuels de la capture ne sont donc pas déclarés corrigés sur la seule
base des tests physiques. Les chemins de reconstruction fautifs ont été remplacés
et leurs nouveaux raccords sont vérifiés géométriquement, sous cette limite visuelle.

La géographie horizontale est répétée entre les adresses ordinaires à pas de
5,4 m, puis ouverte par les atria de trois propriétaires. Les grandes zones ont
bien leurs datums propres ; ce système n’est pas un monde voxel 3D sans contraintes.
L’éclairage par atlas vertical reste une approximation d’exposition ; il ne
remplace pas un calcul physique d’ombres et sa résolution horizontale est de 1,75 m.
