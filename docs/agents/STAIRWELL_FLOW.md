# Parcours de l’immeuble

`OpeningIntro` conserve les durées historiques courtes des labels :
1300/1900/1500/1200 ms. Les temps de lecture plus longs appartiennent uniquement
aux photographies de `NewGameIntro`.

`NewGameIntro` accompagne uniquement les nouvelles parties (y compris Continuer
sans sauvegarde). Les zooms/fondus des six WebP suivent une horloge visible.
`CinematicCaption` réserve les mots complets et révèle les lettres par animations
natives, sans réécrire les lignes pendant le chargement. Le plan suivant attend
la phrase complète et trois secondes de lecture. Le mode réduit et le fallback
gardent une horloge explicite ; l’onglet masqué suspend les animations. Un nouvel
essai recharge uniquement les images manquantes, sans couper la phrase en cours.
La dernière phrase reste visible pendant le fondu vers une scène prête. Pendant les photos, le worker
télécharge uniquement les parties compressées de l'appartement et conserve leurs
Blobs ; `EntryAssetPreload` télécharge les ressources du personnage et de l'entrée.
La boucle de l'ancien runtime et son préfetch sont suspendus avant le film, sans
détruire ses ressources. Aucun import du runtime, décodage JSON, conversion de
géométrie, montage Three/Rapier, texture ou warmup GPU ne commence sous les photos.
Deux images au maximum se chargent ensemble ; la première lance le film sans attendre les cinq autres.
Après `intro.finished` (fin naturelle ou Passer), le routeur attend deux images
navigateur pour peindre le chargement, puis détruit l'ancien runtime, importe le
nouveau et crée son renderer. `ApartmentPreload.take` autorise alors le décodage et
la conversion dans le worker. Matériaux, appartement, décor du hall et physique se préparent concurremment ;
les buffers transférés sont réutilisés sans copie ; bornes calculées dans le worker,
simplification restante, petits batches et montage physique cèdent la main par tâches de 3 ms.
La préparation existante des petits objets (écart maximal 1,4 mm) est intégrée
au pack à sa fabrication. Sources originales, hiérarchie, identités et matériaux
restent conservés ; livres et pot gardent leurs triangles pour la séparation en îlots.
Les grands meshes gardent leur appel de rendu sans grosse fusion. Le warmup GPU dessine à
320×180 avant de restaurer la résolution choisie. Il n'y a pas de boucle 3D cachée
pendant les photos. Le routeur prépare la scène après le film. Passer annule toute la présentation
(photo et entrée 3D), son audio et ses animations ; seul le chargement restant subsiste.
Un token de transition ignore les anciens callbacks, et un lancement déjà engagé
ne crée pas un second runtime. Une remise en jeu attend aussi un onglet visible.
Les tableaux sont transférés à `LoadApartmentScene` ; toute annulation termine le worker.
`NewGameRouting` et `apartment.worker` vérifient ces deux phases, y compris Passer
avant la fin du téléchargement et une transition annulée pendant les photos.
Après le warmup, `ArrivalCinematic` anime un clone du personnage choisi avec les
deux clips fournis et le vrai vantail de porte. Les corrections de tête et de bras sont restaurées avant chaque échantillon du
mixer : un temps identique ne doit jamais accumuler de rotations. La main droite
suit position et orientation de la poignée pendant la poussée ; la gauche suit
le bord intérieur au début de la fermeture (5–5,85 s du clip de porte). Le trajet
avance et se décale avant la fermeture ; la caméra montre le vrai vantail derrière
le personnage. `EntranceFacade` ferme les vides latéraux sans boucher les fenêtres. `ArrivalExpression` applique la tristesse à une
géométrie privée du clone ; le visage sauvegardé et le corps jouable restent réutilisables.
Le raccord final cache le changement de caméra sous un bref fondu, puis révèle
le vrai corps en première personne avant de libérer les commandes. Aucun masque
de tête ne s'active sur le personnage de la cinématique. Les pièces CAD du cadre
et du vantail sont fusionnées séparément pour le rendu et restaurées au démontage.
`SiteAudio` conserve le morceau pendant photos et attente ; une transition de huit
secondes vers la pluie commence au plan de porte et se poursuit après le raccord,
sur le temps visible du runtime. Une sauvegarde chargée contourne ce prologue. Voir
`docs/validation/ENTRY_CINEMATIC_VALIDATION_20261031.md` pour les contrats et limites.

`HallArrivalStory` possède l'objectif courrier, le portillon `Door_3`, sa surbrillance
et l'enveloppe ; il utilise le vrai pivot du modèle et le prompt d'interaction commun.
Les colliders temporaires autorisent la première volée, puis bloquent son palier et la seconde montée.
Le rappel/recul utilise les datums et limites de `layout`, avec un appui sur le haut
réel de la première volée. Un réarmement spatial, distinct du cooldown et de
`mailGaspPlayed`, évite les boucles à la frontière. Le gasp est consommé et
sauvegardé dès le premier rappel dans cette zone ; la récupération n'en rejoue pas.
L'enveloppe sort avant que `LetterReader` ouvre le texte (`MAILBOX_NOTE` : un mot
de Chloé). `GiftParcel`, à côté du paillasson du dernier palier (collider
`chloe-gift`, retiré avec la cage), doit être ouvert avant d'entrer : il donne
`COMPASS_ID` (emplacement ordinaire, jamais déposé) et `GIFT_LETTER`. Le flag
`giftOpened` est optionnel ; les anciennes sauvegardes déjà rentrées le valent. `arrivalState` et le flag
sonore sont indépendants. Les anciens snapshots mail/home/done sans flag sont
considérés comme déjà avertis ; les anciennes sauvegardes sans objectif le contournent.

`ApartmentQuest` et `QuestTracker` affichent un seul objectif global en haut à
gauche, y compris au-dessus du bureau. Le parcours est courrier → entrée réelle →
lumière → gaz → TV et radio → mails récents (le premier, URGENT, annonce une
réparation à payer) → solde bancaire → première partie terminée de Démineur
(victoire ou défaite). L'horloge du PC affiche 01 h et les minutes réelles. Le compte locataire reste une application libre.
Les actions déjà effectuées sont monotones, distinctes de l'état courant des
appareils. `SaveHistory.computer.apartment` conserve ces états, les pensées
consommées, la bouteille cassée et la panne. Un ancien `stage: done` prouvait
seulement l'ouverture du jeu : sa migration ne déclenche jamais la panne.
`RussianStairwellGame.updateApartmentStory` avance aussi avec le bureau ouvert,
mais pas pendant la pause. La phrase entière sur le gaz précède le lever rapide,
encore sous tension, puis la reprise du contrôle. `PostComputerJourney` conserve
la narration consommée, le lever demandé et l'origine réelle du trajet vers la
poêle importée. La panne exige des pas continus et le franchissement de la moitié
de ce trajet ; attendre, être assis ou se téléporter ne suffit pas. Elle ne coupe
pas le gaz. Les voix françaises de `StorySpeech` partagent une file, sont suspendues
avec le jeu et utilisent le volume maître ; sans synthèse française disponible,
les sous-titres conservent le temps de lecture. Aucun dialogue consommé ne repart
au chargement, y compris les anciennes interruptions.

`ApartmentDevices` utilise les vrais appareils importés hors batching, une
CanvasTexture 256×192 à 12 Hz pour la TV et des lumières locales sans ombre.
Le PC reste allumé après sa première utilisation. La radio garde un corps
dynamique ; sa source sonore et sa lumière suivent le boîtier. La touche
d’interaction la commande ; le clic la prend avant la panne. Après la panne,
un clic ne fait que parasiter et Maj + clic conserve la prise en main. La poêle et sa nourriture restent statiques ;
flamme et cuisson discrète suivent l'état réel du brûleur. L'alimentation des plafonniers
est indépendante de la position de l'interrupteur et des lumières des appareils.
`ApartmentDeviceAudio` réutilise le contexte/master spatial et les fallbacks
Firefox/Chrome. Deux éléments média sans préchargement diffusent un morceau radio
à la fois, puis Pressure exclusivement depuis la TV après la panne. Aucune des
cinq pistes n'est décodée à l'entrée en jeu. La pause arrête leur temps de lecture ;
le démontage libère sources, connexions et écouteurs. La radio reste allumée mais
ne produit plus qu'un bref parasite après la panne ; éteindre la TV coupe Pressure
immédiatement. Les clics du bureau utilisent le même bus, à la position du PC.

`ApartmentComputerInteraction` cible les vrais meshes avec portée et occlusion.
`ComputerUseSequence` anime le personnage habillé, la vraie chaise et le raccord
caméra avant le bureau ; voir [Cycle du PC](COMPUTER_USE.md). Après la panne,
le moniteur bleu reste lumineux et la cible ne peut plus rouvrir le bureau.
`ComputerDesktop` reste un bureau HTML local : mails et recherche, faux site,
documents, fenêtres, horloge et Démineur déterministe. Son ouverture libère la
souris sans ouvrir la pause ; Échap revient au runtime. Une capture tardive est
relâchée. Le personnage s'arrête au bureau ; un conducteur passif à 60 Hz
continue le même monde physique et les appareils. La pause réelle fige tous les ticks. Une grille commencée avant les mails,
son ouverture et sa réinitialisation ne terminent pas la quête. Le démontage
retire les écouteurs et fenêtres. Tests : `ApartmentQuest`, `ComputerDesktop`,
`ComputerInputLifecycle`, `ApartmentDevices`, `ApartmentDeviceAudio`, `SaveHistory`.

`NeighborProfiles` fixe silences, refus, réactions non verbales et identités.
Les appuis sont toujours comptés ; seuls les sons sont cadencés (coups 200 ms, sonnette 420 ms).
Une porte conserve une seule réponse en attente, dont le délai varie et n'est pas
repoussé par le spam. L'agacement suit la cadence puis décroît au calme. Les timers
suivent le temps joué et disparaissent au démontage ; acteurs, agacement et dernier
index de réplique persistent dans `SaveHistory.neighbors` (champs optionnels).
`DoorIdentity` exclut toujours la vraie porte du joueur de l'attribution des voisins.
`NeighborVoice` lit de vrais clips du pack de Dillon Becker : refus 1–10,
raclement de gorge 13, toux 15 et hésitation `hmm`. Deux voix au maximum ;
un marmonnement atténue et filtre le même acteur, sans changer sa hauteur. Les courtes phrases françaises sont des
adaptations des intentions anglaises. Le moteur de synthèse du navigateur est absent.
La voix sélectionnée du joueur est exclue de l'attribution initiale des voisins.
Les acteurs persistés gardent leur identité après Continuer.

`SampledDoorAudio` et `NeighborVoice` utilisent le contexte et le master du runtime,
avec panners à la porte et filtrage léger. Le budget partagé d'`AudioAssetQueue`
limite à trois les chargements/décodages, met les octets en cache et réutilise les
buffers d'un même contexte. Les sous-titres voisins ont leur propre légende,
sans narration, masquée hors portée ; les indications non verbales sont optionnelles.
La porte spéciale est le vantail est du RDC. Son vrai pivot transformé et une
petite alcôve construite (sol, côtés, plafond et mur à 1,25 m) encadrent l'entrebâillement ; le collider du mur reste fermé.
L'événement est consommé et sauvegardé dès engagement, même si l'on quitte pendant
le délai ou l'animation. Le démontage restaure le vantail fermé.

La cage impose la marche sans saut via les capacités du contrôleur ; l'appartement
et le Level 0 conservent leurs capacités. A/E ne déclenchent plus de penchement.
`DashcamLook` amortit seulement la caméra rendue, avec un léger dépassement ; la
visée et les sauvegardes restent exactes. Le réglage de mouvement caméra le désactive.
Les autosauvegardes réutilisent une miniature préparée au chargement ; une sauvegarde
manuelle l'actualise, pour éviter lecture GPU et compression d'image en pleine marche.

`ApartmentPickables` conserve les petits objets avant le batching. Les placards,
le plan `plank`, l'évier, la gazinière et le buffet `stoleshnica` utilisent leurs
triangles réels : une boîte englobant les placards bas et hauts boucherait à
nouveau tout le vide au-dessus du plan de travail. `ApartmentBookGeometry` sépare
les îlots des deux meshes de livres en gardant UV et triangles. Tous les livres
ont des corps convexes dynamiques, initialement endormis ; toute la pile se
réveille lorsqu'on retire un support. Tous les autres objets mobiles ont également leurs corps dès le montage,
avec sommeil et masses propres. Le portage utilise des vitesses bornées, CCD et un balayage de
la forme réelle, sans tick Rapier supplémentaire. `PhysicsWorld.onAfterStep`
permet la casse sur l'impulsion d'un vrai contact, jamais dans la main ou d'après
l'altitude mondiale. Les fragments limités disparaissent après neuf secondes.
Clic/touche d'interaction prend, touche d'interaction pose, clic lance, molette
règle la distance et clic droit + souris tourne. Ces gestes n'atteignent pas le
combat. Voir [Interactions de l’appartement](APARTMENT_INTERACTIONS.md) pour les
contacts, dépôts, appareils et cachette persistants. Le démontage restaure les parents avant de libérer l'appartement.
Les essais `ApartmentPhysical` utilisent la géométrie exportée et le vrai moteur
Rapier ; les essais de lumière et textures CPU ne remplacent pas un contrôle WebGL.

`LoadingScreen` partage les écrans du routeur et du prologue. `LoadProgress`
combine les octets reçus et les tâches terminées, avec les sous-phases GPU,
sans interpolation temporelle. `menu-tokens.css`, `ModernUI.css` et le garde-robe en shadow DOM
utilisent la même palette et les mêmes états de focus/sélection.
Le pack d'animations se décompresse et se convertit en tableaux typés dans un
worker temporaire ; seuls deux clips/emotes sont montés à la fois. Le worker est
terminé après transfert, et les données immuables sont réutilisées aux relances.

Le judas (`DoorPeephole`) déplace uniquement la caméra de rendu au-delà de la
peau du vantail, dans le sens opposé au côté du joueur. Il réutilise la scène et
le rendu existants ; la physique et la caméra normale restent figées puis sont
restaurées. Le portail de visibilité de l'appartement est forcé uniquement pendant
cette vue. Pause, perte de focus et démontage quittent la vue. L'extinction coupe
les lampes et émissions, sans noircir l'albédo des murs éclairés depuis le palier.
Les six clics du digicode suivent les contacts mesurés de l'index sur l'animation
source ; aucun timeout ni son futur n'est programmé. Passer et démonter coupent
le transitoire actif et consomment les contacts restants.
