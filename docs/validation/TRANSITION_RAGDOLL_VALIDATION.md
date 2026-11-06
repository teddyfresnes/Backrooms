# Volumes, chutes et caméra — validation

Référence avant correction : `d726e194f2310083a0b9999b6d6422ce9bc90639`.
Plan ordinaire version 18 ; topologie et spatial version 2.

## Diagnostic et correction

La capture `image(20261026-175044).png` est exploitable, sans seed ni position.
Le fichier `image(20261026-175149).png` est tronqué. Les fixtures ci-dessous
représentent les défauts décrits ; elles ne prétendent pas reproduire la capture.

Le générateur ajoutait un toit incliné à **toutes** les volées, même ouvertes,
puis découpait les plafonds voisins. Il produisait ainsi une plaque autonome
et exposait le plénum entre le petit plafond de pièce et la dalle supérieure.
L'absence de ce volume et d'une dépendance supérieure expliquait une partie des
parois apparemment transparentes. Aucun matériau global n'a été rendu double face.

`roofPolicy` distingue maintenant trois cas :

- `room` : plafond réel conservé si les deux pièces offrent le dégagement requis
  et une hauteur uniforme sur la réservation. Un raccord ferme les deux plafonds
  différents ; leurs dalles déjà jointives ne reçoivent pas de petit retour inversé.
- `upper-slab` : ouverture dans le plafond local, sous-face du vrai plancher du
  propriétaire supérieur, dépendance physique explicite. Le plénum de pièce est
  fermé par des volumes opaques ; le vide de circulation reste ouvert.
- `flight` : toit propre seulement pour une transition réellement encloisonnée,
  raccordé aux pièces et à la moitié canonique voisine.

Les marches utilisent la vraie sous-face de chaque marche supérieure. Leur
luminaire est posé sous l'approche plate ; les rampes gardent un panneau parallèle
à la dalle réelle. Géométrie, clearance, métadonnées et fixtures suivent la même
politique. Les deux moitiés d'un `linkId` restent une seule circulation.

Les reliefs ordinaires étaient tirés par cellule de 28 m, même dans une grande
salle continue. Une composition canonique par district ouvert propose désormais
un seul relief et au plus deux accès éloignés de 98 m. Une proposition incompatible
est rejetée avant matérialisation. Les salles vides, asymétries, grandes étendues
et circulations uniques restent possibles. Le BSP de 224 m n'est pas remplacé.

Les triangles bruts et les buffers Float32 après `FaceExposure` ont été comparés
depuis l'intérieur des volées et les niveaux inférieurs. Les rayons utilisent
`FrontSide`, les normales et caps réels. Les bornes des buffers restent celles du
worker ; au plus dix lots de matériaux sont montés. Les contrôles n'ont pas révélé
de suppression incorrecte nécessitant de désactiver `FaceExposure`, ni de changement
de transparence/depth writing dans les matériaux architecturaux.

## Physique et ressources

Le profil a confirmé que le solve physique dominait la chute. Le hand-off pendant
0,4 s et tout volume proche d'un obstacle gardent cinq sous-pas. Seul un volume
balayé englobant tous les membres, élargi de leur vitesse et de la gravité, autorise
deux sous-pas en vol libre. CCD, soft CCD et dix itérations additionnelles restent
actifs. Les articulations, réactions et critères de repos sont conservés.

Les événements d'impact doivent maintenant avoir un vrai manifold du décor. Son
point et sa normale remplacent les recherches de boîtes et rayons redondantes.
Une impulsion interne aux articulations ne devient plus un impact sur un mur voisin.
Les sondages de relevé sont espacés de 120 ms ; une demande d'aide explicite reste
immédiate. Les événements et effets gardent leurs limites existantes.

Le ragdoll actif conduit une seule simulation partagée ; les autres corps utilisent
`passiveUpdate`, y compris les anciens cadavres pendant une nouvelle chute. Si le
conducteur dort, les autres acteurs éveillés et cinématiques en mouvement continuent
à avancer. La collection d'îlots actifs de Rapier peut omettre un corps tout juste
créé : la décision vérifie donc les vrais corps et les mouvements cinématiques
en attente. Un monde entièrement endormi ne fait aucun solve inutile.

Les synchronisations de chunks utilisaient un pas de 1/60 s supplémentaire.
Elles rafraîchissent maintenant la broad phase à temps nul, puis restaurent le
timestep. L'accumulateur fixe, le delta borné et le rattrapage maximal sont conservés.

La quarantaine historique des rigs désactivés accumulait leurs allocations brutes.
Les articulations détenues sont maintenant détachées **avant** les corps, évitant
le callback de suppression Rapier défectueux. Vingt cycles avec le vrai FBX reviennent
aux mêmes nombres de corps, colliders et articulations ; un voisin partagé continue
sa chute. Le test natif Rapier vérifie aussi vingt démontages d'une chaîne articulée.
Quatre cadavres physiques sont conservés ; les plus anciens libèrent leur physique,
matériaux clonés et textures de squelette. La géométrie et les textures partagées
de l'avatar ne sont pas détruites. Neuf respawns vérifient le plateau de ressources.

## Caméra et streaming

La caméra était poussée devant le visage après lissage sans interrogation du décor.
Orienter la tête vers le sol pouvait donc faire entrer les yeux dans une dalle
alors que les colliders du corps restaient correctement au-dessus.

`EnvironmentCameraGuard` intervient après les offsets, le lissage et la projection.
Une sphère englobe le plan proche complet, y compris en écran large. Les balayages
partent du centre physique de la tête et de la précédente position sûre ; une
dépénétration bornée traite les contacts initiaux et portes mobiles. Le décor prime
sur la contrainte du visage. Un masque de tête uniquement visuel évite alors de
voir l'intérieur du visage, sans déplacer les os ou appliquer une force au corps.
Le shader correspondant est préparé pendant le chargement ; les rigs 1P/3P/NPC
participent à la compilation initiale. La protection continue pendant le relevé.

Le streaming utilisait déjà le bassin physique ; cet ancrage est conservé et testé
indépendamment de la caméra. Sa vitesse anticipe trois propriétaires réels au plus
sur 0,6 s. La file reste bornée à huit demandes, dans le budget existant de neuf
chunks de base et douze propriétaires supplémentaires, avec douze plans CPU en cache.
Une vue prête au plus est montée par frame. Le test de préchargement montre le
vrai sol d'arrivée monté alors que le bassin est encore à plus de huit mètres.
Aucune preview physique, dalle invisible ou augmentation globale du rayon n'est ajoutée.

## Mesures CPU reproductibles

Deux répétitions avant/après, mêmes trois plans sérialisés :
`ebd610180e643faa30b1971760b35bb0d693759b9639e1b071a040eb6d48613c`.
Ils contiennent respectivement 918, 919 et 1113 colliders. Seed `REGIONAL-AUDIT-2`,
départ monde `(14, 2.765, 9)`, propriétaires `0, -1, -2`, réception à `y=-8.9`.
Vrai FBX, Three et Rapier 0.19.3, renderer absent ; aucune résolution adaptative.

À 60 Hz, répétitions regroupées, millisecondes CPU par frame :

| Phase | Médiane avant | Médiane après | P95 avant | P95 après |
|---|---:|---:|---:|---:|
| Chute libre | 3,813 | 1,894 | 5,186 | 4,611 |
| Approche et impact | 3,585 | 3,661 | 5,439 | 4,738 |
| Stabilisation puis repos | 0,125 | 0,162 | 4,062 | 4,366 |

Le gain médian en chute libre est de 50 %. Le nombre de solves dans cette phase
passe de 780 à 462 et leur CPU cumulé de 488 à 293 ms. Les contacts gardent
420 solves avant comme après. La protection de caméra ajoute un petit coût au
repos ; le gain n'est pas présenté comme uniforme sur toutes les phases.
La phase « impact » est la bande bassin à 1,5 m de la réception et les 0,7 s suivantes ;
la phase suivante inclut encore la fin de stabilisation. Le repos natif ne dépend
pas de ces catégories de mesure.
L'activation du ragdoll reste entre 4,9–7,2 ms avant et 5,1–7,2 ms après dans les
six cas mesurés : aucun gain d'activation CPU n'est revendiqué.

Les fichiers `ragdoll-fall-before.json`, `ragdoll-fall-after.json` conservent les
frames compactes et les statistiques par phase à 30/60/120 Hz, les requêtes,
montages/synchronisations, contacts, corps éveillés, effets et synchronisations du
squelette. Le delta de heap dépend du GC ; ce n'est pas un compteur exhaustif
d'allocations. Le nombre de représentations de boîtes recréées par les recherches
d'impacts tombe à zéro. Les allocations brutes des rigs sont contrôlées séparément.

Le relevé utilise le même vrai clip dans les deux versions à 30/60/120 Hz.
Son animation reste inférieure à 0,45 ms CPU au P95 dans ce relevé ; sa préparation
reste un pic isolé d'environ 34–52 ms. Ce pic n'est pas présenté comme supprimé.
Les données détaillées sont dans `ragdoll-getup-comparison.json`.

## Couverture et conservation

L'audit `transition-volumes.json` couvre 64 mondes ordinaires et 32 de réserve,
205 demi-volées, 409 sondes Three/Rapier, 820 coins de luminaires et 1433 retours
de dalle. Il inspecte 2 339 302 triangles finaux : zéro erreur, dix lots au maximum,
83,5 % et 88,9 % de surface BSP praticable selon le corpus. Les prototypes séparés
couvrent aussi la transition encloisonnée, plus rare que les ouvertures ordinaires.

Le parcours physique `REGIONAL-AUDIT-0` franchit 3576 m entre trois datums dans les
deux sens. Sa sélection se fait sur le vrai réseau de surfaces : une cellule
grossière peut contenir plusieurs poches BSP et ne suffit pas à choisir le départ.
L'audit de conservation compare 512 propositions : 193 identiques, dont 149 passages
hérités et 25 grid-pits ; les 19 autres sont les fosses liminales déjà présentes.
Les datums/styles, phases d'atria et cinq monuments sont conservés, ces derniers
avec des hashes de plans complets identiques à la référence.

Les régressions couvrent sol, pente, marche, mur, plafond, porte mobile, chevauchement
initial, vrai trou, vues inférieures, hand-offs entre propriétaires, repos partagé,
pause/reprise, relevé et recyclage des ressources, avec de vrais rigs et meshes.
L'éclairage global, ses réglages, les règles de plinthes, arches, galeries et anciens
éléments ne sont pas réinitialisés.

La suite complète du personnage termine à **650/650**, avec les nouveaux tests
de ressources. La suite générale a terminé à **643/644** avant les deux derniers
ajouts ciblés ; les tests natifs de physique passent ensuite à **22/22**, et ceux
du montage vertical à **3/3**. L'unique échec général concerne l'asset décrit
ci-dessous. Le build TypeScript/Vite termine sans erreur et les références du
HTML produit existent, y compris le nouveau shader de tête dans le bundle.

## Commandes et limites

```sh
node scripts/audit-transition-volumes.mjs 64 rapport.json
node scripts/audit-liminal-preservation.mjs /chemin/vers/reference
node scripts/test-character.mjs
node scripts/profile-regional-fall.mjs chute.json
node scripts/profile-getup.mjs releve.json
npm test -- --maxWorkers=2
npm run build
```

Pour isoler la physique, `FALL_PROFILE_WORLD` pointe vers le module monde compilé
de la référence pour les deux mesures. Le hash des plans doit rester identique.

Fixtures supplémentaires : `VOLUME-ORDINARY-0`, propriétaire `(-1,-1,-2)`, position
`(-70,-10.4725,-143.918906)` pour une volée sous la vraie dalle ;
`VOLUME-HOLDOUT-7`, propriétaire `(0,1,0)`, position `(42,0.1025,109.135699)`
pour une volée conservant le plafond de pièce.

Le service d'aperçu géré est indisponible. Les contrôles de triangles et colliders
ne remplacent pas une observation WebGL des deux modes de lumière. Aucune mesure
GPU, shader-compile observée ou garantie de FPS n'est revendiquée. Le test de nom
racine de l'asset appartement est déjà en échec sur la référence : nom embarqué
`russian_cigarette_pack(1).glb` au lieu de `ImportedApartmentScene_v1.19.2`.
Cet asset et son contenu ne sont pas modifiés ici.
