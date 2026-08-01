# Historique reconstitué des mouvements Backrooms

Ces 144 commits ont été créés le 15 octobre 2026 à la demande du propriétaire.
Leurs dates d’auteur et de committer ont été réparties sur ses journées indiquées :
1–8 août, 11–14 août, 20 août et 23 août–22 septembre 2026, fuseau Europe/Paris.
Les heures sont reconstituées ; elles ne proviennent pas de journaux d’activité.

31 snapshots Git du prototype sont réellement disponibles, depuis un état v123
jusqu’à v144. Les versions antérieures ne sont pas récupérables individuellement.
Le premier snapshot est donc décomposé par modules ; les mises à jour suivantes
sont décomposées en changements de code, essais et documentation. Les commits
intermédiaires sont reconstitués et ne représentent pas 144 snapshots d’origine.
Aucun commit vide n’est utilisé. Le code final correspond exactement aux sources
récupérables de v144. Chaque message conserve le SHA et la version source.

Cette branche archive le code et les essais du prototype. Ses interfaces de labo
sont historiques. Le jeu intégré reste sur `main`, avec les interfaces du labo
retirées ; l’import de cet historique ne change aucun fichier du jeu actuel.
Les binaires et builds du prototype ne sont pas dupliqués dans cette archive de
code. Les 97 assets de personnage sont conservés par le projet intégré dans
`assets/character/` sur `main` et restaurés par son script de préparation.

## Chronologie reconstituée

| N° | Date Europe/Paris | Changement | Snapshot d’origine |
|---:|---|---|---|
| 1 | 2026-08-01T11:02:18+02:00 | Préparer la base TypeScript, Three.js et Rapier | `cbc3659156b5` |
| 2 | 2026-08-02T16:49:09+02:00 | Définir les données de collision et de monde | `cbc3659156b5` |
| 3 | 2026-08-02T16:54:26+02:00 | Préparer les commandes AZERTY et QWERTY | `cbc3659156b5` |
| 4 | 2026-08-03T14:00:22+02:00 | Gérer les appuis, relâchements et axes de déplacement | `cbc3659156b5` |
| 5 | 2026-08-03T14:51:31+02:00 | Conserver les réglages de caméra et de commandes | `cbc3659156b5` |
| 6 | 2026-08-03T16:17:21+02:00 | Sélectionner le mode d’éclairage du décor | `cbc3659156b5` |
| 7 | 2026-08-03T17:37:55+02:00 | Reprendre les paramètres visuels des Backrooms | `cbc3659156b5` |
| 8 | 2026-08-03T17:54:06+02:00 | Exposer l’état de déplacement et de regard | `cbc3659156b5` |
| 9 | 2026-08-04T13:11:36+02:00 | Centraliser les paramètres de marche, sprint, saut et glissade | `cbc3659156b5` |
| 10 | 2026-08-04T14:12:38+02:00 | Calculer l’inertie et les changements de direction | `cbc3659156b5` |
| 11 | 2026-08-04T14:49:54+02:00 | Déplacer la capsule dans le monde Rapier | `cbc3659156b5` |
| 12 | 2026-08-04T18:24:05+02:00 | Relier les commandes, la caméra et les états de locomotion | `cbc3659156b5` |
| 13 | 2026-08-05T13:10:21+02:00 | Accompagner le regard par la rotation du corps | `cbc3659156b5` |
| 14 | 2026-08-05T13:17:14+02:00 | Régler le suivi du corps en vue subjective | `cbc3659156b5` |
| 15 | 2026-08-05T13:29:27+02:00 | Choisir les animations de déplacement directionnel | `cbc3659156b5` |
| 16 | 2026-08-05T13:57:33+02:00 | Préparer les marches et puits du parcours de mouvement | `cbc3659156b5` |
| 17 | 2026-08-05T14:27:27+02:00 | Habiller les outils de réglage du déplacement | `cbc3659156b5` |
| 18 | 2026-08-06T11:47:11+02:00 | Visualiser les réglages du contrôleur en situation | `cbc3659156b5` |
| 19 | 2026-08-06T13:09:06+02:00 | Donner une réaction active aux chutes physiques | `cbc3659156b5` |
| 20 | 2026-08-06T13:58:49+02:00 | Dissiper le mouvement final du corps au sol | `cbc3659156b5` |
| 21 | 2026-08-06T14:01:55+02:00 | Articuler le squelette avec les corps et contraintes Rapier | `cbc3659156b5` |
| 22 | 2026-08-06T16:07:17+02:00 | Distinguer une approche contrôlée d’une perte d’équilibre | `cbc3659156b5` |
| 23 | 2026-08-07T15:45:33+02:00 | Vérifier le support et l’espace avant le relevé | `cbc3659156b5` |
| 24 | 2026-08-07T17:02:06+02:00 | Transférer la pose physique vers les animations de relevé | `cbc3659156b5` |
| 25 | 2026-08-08T13:03:50+02:00 | Calculer les dégâts des impacts et des chutes | `cbc3659156b5` |
| 26 | 2026-08-08T13:55:31+02:00 | Limiter les traces aux contacts physiques distincts | `cbc3659156b5` |
| 27 | 2026-08-11T10:22:30+02:00 | Placer les traces d’impact sur les surfaces | `cbc3659156b5` |
| 28 | 2026-08-12T11:21:19+02:00 | Résoudre les appuis et contacts sur le squelette | `cbc3659156b5` |
| 29 | 2026-08-12T11:27:20+02:00 | Détecter le balayage des membres et la perte d’équilibre | `cbc3659156b5` |
| 30 | 2026-08-12T11:59:48+02:00 | Encadrer les transitions de garde et de locomotion | `cbc3659156b5` |
| 31 | 2026-08-12T12:15:52+02:00 | Régler les distances et fenêtres des frappes | `cbc3659156b5` |
| 32 | 2026-08-13T11:22:04+02:00 | Combiner les animations de combat du haut et du bas du corps | `cbc3659156b5` |
| 33 | 2026-08-13T12:14:37+02:00 | Choisir les frappes au sol selon la cible | `cbc3659156b5` |
| 34 | 2026-08-13T15:01:47+02:00 | Présenter les commandes d’essai des animations | `cbc3659156b5` |
| 35 | 2026-08-13T15:13:43+02:00 | Relier les clips, le squelette, le combat et la récupération | `cbc3659156b5` |
| 36 | 2026-08-13T16:34:03+02:00 | Ouvrir les scènes de préparation des mouvements | `cbc3659156b5` |
| 37 | 2026-08-13T16:35:20+02:00 | Rassembler les contrats nécessaires à l’intégration dans Backrooms | `cbc3659156b5` |
| 38 | 2026-08-14T16:01:21+02:00 | Préparer la livraison du prototype de mouvements | `cbc3659156b5` |
| 39 | 2026-08-14T18:06:46+02:00 | Documenter les essais d’animation et de caméra | `cbc3659156b5` |
| 40 | 2026-08-20T14:07:54+02:00 | Documenter les commandes et le réglage des mouvements | `cbc3659156b5` |
| 41 | 2026-08-20T15:39:52+02:00 | Préparer le point de montage de l’application | `cbc3659156b5` |
| 42 | 2026-08-20T16:14:54+02:00 | Récupérer les textures utilisées par le décor d’essai | `cbc3659156b5` |
| 43 | 2026-08-20T18:36:06+02:00 | Préparer les textures locales des impacts | `cbc3659156b5` |
| 44 | 2026-08-20T18:39:48+02:00 | Servir la livraison du prototype en local | `cbc3659156b5` |
| 45 | 2026-08-23T14:21:27+02:00 | Restaurer et vérifier les assets de la livraison | `cbc3659156b5` |
| 46 | 2026-08-23T18:02:25+02:00 | Contrôler l’intégrité de la livraison | `cbc3659156b5` |
| 47 | 2026-08-24T11:43:54+02:00 | Tester les contacts, la résistance et les transitions de pose | `cbc3659156b5` |
| 48 | 2026-08-24T12:47:54+02:00 | Vérifier les frappes sur le personnage animé | `cbc3659156b5` |
| 49 | 2026-08-24T13:09:52+02:00 | Vérifier les états de déplacement et les risques de chute | `cbc3659156b5` |
| 50 | 2026-08-24T13:27:17+02:00 | Charger les vrais FBX dans les essais hors écran | `cbc3659156b5` |
| 51 | 2026-08-24T14:04:40+02:00 | Initialiser Rapier pour les essais physiques | `cbc3659156b5` |
| 52 | 2026-08-25T11:17:51+02:00 | Remplacer uniquement la surface WebGL dans les essais | `cbc3659156b5` |
| 53 | 2026-08-25T11:29:33+02:00 | Compiler les modules couverts par les essais physiques | `cbc3659156b5` |
| 54 | 2026-08-26T10:51:56+02:00 | Configurer le build et le serveur de développement | `cbc3659156b5` |
| 55 | 2026-08-26T13:09:48+02:00 | Stabiliser la reprise du contrôle et la garde : AnimationLab, AnimationLab | `1ee11d8dc860` |
| 56 | 2026-08-27T11:41:54+02:00 | Stabiliser la reprise du contrôle et la garde : PlayerController | `1ee11d8dc860` |
| 57 | 2026-08-27T12:03:49+02:00 | Documenter la reprise du contrôle et les transitions de garde | `1ee11d8dc860` |
| 58 | 2026-08-27T12:07:07+02:00 | Interrompre les combos et restaurer les poses procédurales : AnimationLab, CombatAnimationLayers | `27de5dab1145` |
| 59 | 2026-08-27T12:11:07+02:00 | Interrompre les combos et restaurer les poses procédurales : CombatFeel, CombatRig | `27de5dab1145` |
| 60 | 2026-08-28T11:29:39+02:00 | Tester les interruptions de combo et les poses procédurales | `27de5dab1145` |
| 61 | 2026-08-28T12:20:54+02:00 | Rendre les corps au sol franchissables par la capsule : AnimationLab, CombatAnimationLayers, CombatRig, GroundKickRules | `7a7c9642f196` |
| 62 | 2026-08-28T12:40:39+02:00 | Rendre les corps au sol franchissables par la capsule : LocomotionBlend, PhysicsWorld, RagdollSystem, PlayerController | `7a7c9642f196` |
| 63 | 2026-08-28T15:10:21+02:00 | Tester le franchissement des corps au sol | `7a7c9642f196` |
| 64 | 2026-08-29T15:00:26+02:00 | Conserver l’élan et les orbites pendant les coups | `8c5b23317e88` |
| 65 | 2026-08-29T15:08:48+02:00 | Tester la conservation de l’élan pendant les coups | `8c5b23317e88` |
| 66 | 2026-08-29T15:35:34+02:00 | Tester la conservation de l’élan pendant les coups | `8c5b23317e88` |
| 67 | 2026-08-29T15:53:50+02:00 | Assouplir les hanches et les appuis de combat : AnimationLab | `7f12d643a8d0` |
| 68 | 2026-08-30T11:51:45+02:00 | Assouplir les hanches et les appuis de combat : CombatRig | `7f12d643a8d0` |
| 69 | 2026-08-30T13:23:13+02:00 | Tester les hanches et les appuis de combat | `7f12d643a8d0` |
| 70 | 2026-08-31T12:04:33+02:00 | Reprendre le sprint après une glissade complète : AnimationLab, LocomotionBlend | `bd1db1058cca` |
| 71 | 2026-08-31T15:21:55+02:00 | Reprendre le sprint après une glissade complète : MovementLab, PlayerController | `bd1db1058cca` |
| 72 | 2026-08-31T17:16:10+02:00 | Tester la reprise du sprint après une glissade | `bd1db1058cca` |
| 73 | 2026-09-01T15:09:34+02:00 | Préparer les frappes au sol et valider les impacts physiques | `083adb2a3c3b` |
| 74 | 2026-09-01T17:02:45+02:00 | Tester les frappes et les impacts au sol | `083adb2a3c3b` |
| 75 | 2026-09-01T18:09:16+02:00 | Tester les frappes et les impacts au sol | `083adb2a3c3b` |
| 76 | 2026-09-01T18:20:50+02:00 | Régler le rythme et le son des contacts au sol : AnimationLab, CombatFeel | `528c68329c32` |
| 77 | 2026-09-02T11:58:13+02:00 | Régler le rythme et le son des contacts au sol : GroundKickRules | `528c68329c32` |
| 78 | 2026-09-02T13:01:57+02:00 | Tester le rythme et le son des contacts au sol | `528c68329c32` |
| 79 | 2026-09-02T13:29:36+02:00 | Fluidifier les démarrages et les virages accroupis | `c5f893f272e7` |
| 80 | 2026-09-02T13:37:57+02:00 | Tester les démarrages et les virages accroupis | `c5f893f272e7` |
| 81 | 2026-09-03T13:50:46+02:00 | Documenter les démarrages et les virages accroupis | `c5f893f272e7` |
| 82 | 2026-09-03T14:08:44+02:00 | Redresser les pieds et stabiliser les genoux accroupis | `799ac05f8e49` |
| 83 | 2026-09-03T14:29:37+02:00 | Tester les pieds et les genoux accroupis | `799ac05f8e49` |
| 84 | 2026-09-03T15:15:04+02:00 | Documenter les pieds et les genoux accroupis | `799ac05f8e49` |
| 85 | 2026-09-03T16:40:30+02:00 | Transférer le poids entre les appuis accroupis | `aa9cd074709f` |
| 86 | 2026-09-04T10:35:17+02:00 | Tester les transferts de poids entre les appuis | `aa9cd074709f` |
| 87 | 2026-09-04T12:43:27+02:00 | Documenter les transferts de poids entre les appuis | `aa9cd074709f` |
| 88 | 2026-09-04T14:30:44+02:00 | Conserver les clips fournis et corriger les pas latéraux | `3a332105c93c` |
| 89 | 2026-09-05T12:19:24+02:00 | Tester les clips fournis et les pas latéraux | `3a332105c93c` |
| 90 | 2026-09-05T13:41:06+02:00 | Documenter les clips fournis et les pas latéraux | `3a332105c93c` |
| 91 | 2026-09-05T14:26:56+02:00 | Débloquer les relevés et exiger une garde avant de frapper | `7011ee64eceb` |
| 92 | 2026-09-05T14:39:04+02:00 | Tester les relevés et les conditions de garde | `7011ee64eceb` |
| 93 | 2026-09-05T16:18:07+02:00 | Documenter les relevés et les conditions de garde | `7011ee64eceb` |
| 94 | 2026-09-05T17:16:20+02:00 | Améliorer les frappes diagonales sans rotation brusque | `bf03a10cbb4e` |
| 95 | 2026-09-06T13:04:22+02:00 | Tester les frappes diagonales et la rotation du corps | `bf03a10cbb4e` |
| 96 | 2026-09-06T13:40:17+02:00 | Tester les frappes diagonales et la rotation du corps | `bf03a10cbb4e` |
| 97 | 2026-09-07T14:46:50+02:00 | Varier les relevés dos et ventre sans répétition | `270bdf9ca4e4` |
| 98 | 2026-09-07T18:20:36+02:00 | Tester les variantes de relevé dos et ventre | `270bdf9ca4e4` |
| 99 | 2026-09-08T11:43:14+02:00 | Documenter les variantes de relevé dos et ventre | `270bdf9ca4e4` |
| 100 | 2026-09-09T10:35:35+02:00 | Donner du poids aux poussées et valider les contacts des pieds | `c798dc54c339` |
| 101 | 2026-09-09T11:10:04+02:00 | Tester les poussées et les contacts des pieds | `c798dc54c339` |
| 102 | 2026-09-09T11:34:03+02:00 | Documenter les poussées et les contacts des pieds | `c798dc54c339` |
| 103 | 2026-09-09T12:34:57+02:00 | Caler le corps et les bras en vue subjective | `9b957030f933` |
| 104 | 2026-09-09T14:19:35+02:00 | Tester le corps et les bras en vue subjective | `9b957030f933` |
| 105 | 2026-09-09T15:53:37+02:00 | Documenter le corps et les bras en vue subjective | `9b957030f933` |
| 106 | 2026-09-10T12:26:25+02:00 | Ajouter le coup de tête au corps à corps et ses knockouts | `d0b53c667d1f` |
| 107 | 2026-09-10T15:03:46+02:00 | Tester les coups de tête et les knockouts | `d0b53c667d1f` |
| 108 | 2026-09-10T15:15:32+02:00 | Documenter les coups de tête et les knockouts | `d0b53c667d1f` |
| 109 | 2026-09-10T16:08:49+02:00 | Ouvrir les mains et transférer le poids lors des poussées | `545e15f23bd8` |
| 110 | 2026-09-11T12:22:56+02:00 | Tester les paumes et les transferts de poids des poussées | `545e15f23bd8` |
| 111 | 2026-09-11T13:02:46+02:00 | Documenter les paumes et les transferts de poids des poussées | `545e15f23bd8` |
| 112 | 2026-09-11T13:09:06+02:00 | Adoucir le retour du regard après une frappe latérale | `5d7e2f0b7919` |
| 113 | 2026-09-11T14:20:54+02:00 | Tester le retour du regard après une frappe | `5d7e2f0b7919` |
| 114 | 2026-09-11T14:31:36+02:00 | Documenter le retour du regard après une frappe | `5d7e2f0b7919` |
| 115 | 2026-09-11T15:08:44+02:00 | Ajouter la roue d’emotes et le choix des favoris | `02b0bf23fa4f` |
| 116 | 2026-09-12T12:55:51+02:00 | Tester la roue d’emotes et les favoris | `02b0bf23fa4f` |
| 117 | 2026-09-12T15:29:52+02:00 | Documenter la roue d’emotes et les favoris | `02b0bf23fa4f` |
| 118 | 2026-09-13T13:29:15+02:00 | Laisser le déplacement et le regard libres dans les emotes | `9ecc90137c21` |
| 119 | 2026-09-13T13:35:33+02:00 | Tester le déplacement et le regard pendant les emotes | `9ecc90137c21` |
| 120 | 2026-09-14T14:52:40+02:00 | Documenter le déplacement et le regard pendant les emotes | `9ecc90137c21` |
| 121 | 2026-09-14T15:14:41+02:00 | Ouvrir les emotes avec Tab et appliquer leur trajectoire | `164d9d56bbd3` |
| 122 | 2026-09-14T15:37:38+02:00 | Tester la commande Tab et les trajectoires des emotes | `164d9d56bbd3` |
| 123 | 2026-09-15T13:55:09+02:00 | Documenter la commande Tab et les trajectoires des emotes | `164d9d56bbd3` |
| 124 | 2026-09-15T14:34:50+02:00 | Séparer les emotes debout et au sol | `53071cb5c9c2` |
| 125 | 2026-09-16T10:46:21+02:00 | Tester les emotes debout et au sol | `53071cb5c9c2` |
| 126 | 2026-09-16T11:12:51+02:00 | Documenter les emotes debout et au sol | `53071cb5c9c2` |
| 127 | 2026-09-16T12:44:32+02:00 | Améliorer le curseur et la durée d’affichage de la roue | `f5e9bd6fd799` |
| 128 | 2026-09-16T13:25:53+02:00 | Tester le curseur et la durée d’affichage de la roue | `f5e9bd6fd799` |
| 129 | 2026-09-16T13:40:06+02:00 | Documenter le curseur et la durée d’affichage de la roue | `f5e9bd6fd799` |
| 130 | 2026-09-17T12:08:53+02:00 | Corriger la fermeture de la roue sur les commandes | `fcaa667982d4` |
| 131 | 2026-09-17T12:09:31+02:00 | Tester la fermeture de la roue sur les commandes | `fcaa667982d4` |
| 132 | 2026-09-17T12:28:35+02:00 | Ajouter les gestes libres et préserver les commandes de combat | `4e8eb5604be4` |
| 133 | 2026-09-17T13:42:50+02:00 | Tester les gestes libres et les commandes de combat | `4e8eb5604be4` |
| 134 | 2026-09-17T13:51:21+02:00 | Documenter les gestes libres et les commandes de combat | `4e8eb5604be4` |
| 135 | 2026-09-18T15:09:04+02:00 | Stabiliser les ragdolls au repos sur le sol et les marches | `f19dcbac4706` |
| 136 | 2026-09-18T18:08:09+02:00 | Tester le repos des ragdolls sur le sol et les marches | `f19dcbac4706` |
| 137 | 2026-09-19T11:25:03+02:00 | Documenter le repos des ragdolls sur le sol et les marches | `f19dcbac4706` |
| 138 | 2026-09-20T10:43:23+02:00 | Synchroniser les invitations et les gestes entre deux personnages : AnimationLab, EmoteMenu, EmoteMenu, GetUpRecovery | `c71367ce3bea` |
| 139 | 2026-09-20T14:09:12+02:00 | Synchroniser les invitations et les gestes entre deux personnages : PairInteractionHud, PairInteractionHud, PairInteractionMotion, PairInteractionRules | `c71367ce3bea` |
| 140 | 2026-09-21T14:25:31+02:00 | Tester les invitations et les gestes entre personnages | `c71367ce3bea` |
| 141 | 2026-09-21T16:47:06+02:00 | Documenter les invitations et les gestes entre personnages | `c71367ce3bea` |
| 142 | 2026-09-22T11:45:10+02:00 | Alléger Tout et corriger les bras de pierre-feuille-ciseaux | `328524a3d29e` |
| 143 | 2026-09-22T13:14:06+02:00 | Tester le menu Tout et les bras de pierre-feuille-ciseaux | `328524a3d29e` |
| 144 | 2026-09-22T13:19:28+02:00 | Documenter le menu Tout et les bras de pierre-feuille-ciseaux | `328524a3d29e` |
