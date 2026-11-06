# Cycle du PC

`ComputerUseSequence` appartient à `RussianStairwellGame`. Son horloge avance
uniquement avec le temps joué du runtime ; elle ne crée ni renderer, ni scène,
ni personnage, ni minuterie indépendante.

| Module | Responsabilité |
| --- | --- |
| `ComputerChair` | Ancre monde de la vraie chaise, dix formes convexes, déplacement et nettoyage |
| `ComputerUseSequence` | Chemins latéraux, phases, caméra, curseur et reprise stable |
| `SeatedCharacterPose` | FBX de transfert de poids adapté et précalculé en clip assis sur le vrai rig habillé |
| `PostComputerJourney` / `StorySpeech` | Phrase complète, lever, trajet spatial sauvegardé et file de voix françaises |
| `ComputerUseState` | Snapshot sérialisable du cycle et validation |

La chaise regarde vers −Z. Son assise est à Y=9,138981, sur le sol Y=8,6713203.
Son origine importée est décalée : utiliser une ancre monde. Elle recule de
35 cm, puis revient près du bureau une fois le personnage assis. Les chemins
sont choisis par balayages de capsule contre les vrais colliders. Le bureau
utilise ses triangles ; son ancienne AABB pleine boucherait l’espace des jambes.

Phases : approche → traction de chaise → alignement → assise → rapprochement →
raccord caméra → utilisation. Une sortie normale recule la chaise, redresse le
corps, passe sur le côté et replace la chaise avec un mouvement visible. À la
lever urgent après la phrase sur le gaz, le bureau HTML est retiré sans callback de sortie normale ; la réaction
reste en première personne et laisse la chaise reculée. Le masque de tête du
rig monde est activé seulement en POV ; le rig de présentation 1P reste caché.

`SeatedCharacterPose` évalue les clips déjà chargés sur le personnage courant,
sans clone. Le FBX `standing-to-crouched` fournit le mouvement principal, adapté
une fois au chargement : bassin au siège, appuis plantés et torse redressé au
contact. Le mixer échantillonne ce clip, y compris à rebours pour le lever ;
les contraintes restantes ajustent le recul du siège et les mains. Les pieds
restent fixes pendant le rapprochement. Une pose procédurale est restaurée avant chaque évaluation pour
éviter que l’IK ne s’accumule. Les pieds sont plantés, les articulations gardent
leurs longueurs et les doigts ouverts proviennent des matrices de liaison.
Le collider du personnage suit le torse pendant l’assise, au-dessus de l’assise ;
un cylindre debout passant dans les jambes chevaucherait forcément la chaise.
Le collider normal revient avant de rendre le contrôle.

Le conducteur passif unique continue les objets et appareils à 60 Hz pendant
ces phases et le bureau. Quand le bureau couvre la scène, le rig et le rendu
3D ne sont pas recalculés inutilement. Une pause réelle arrête les horloges et
les ticks. Échap/P ouvrent la pause sans quitter le PC ni réinitialiser sa phase
ou ses fenêtres ; les champs gardent la lettre P. Un refus de capture laisse
l’icône de reprise et une caméra immobile jusqu’au clic et à la capture effective.

La phrase sur le gaz est entière, parlée si une voix française système est
présente, puis le personnage se relève rapidement avec l'électricité encore
active. Le trajet spatial vers la poêle, après restitution du contrôle, déclenche
la panne à mi-distance. `outageLeadSeconds` conserve seulement l'avancement de
lecture, jamais une échéance de panne. `journey` garde narration/lever consommés,
origine et distance marchée. Au chargement, la phrase consommée ne repart pas.
Le flag `outageTriggered` reste l'autorité unique du PC et de la radio ; les
anciens chocs consommés sont acceptés sans nouveau choc ni dialogue.

`SaveHistory.pcUse` contient phase, ancrage extérieur sûr et déplacement de la
chaise. Un snapshot de transition recharge debout à cet ancrage, avec la chaise
stable. Une chaise reculée après la panne reste reculée dans un snapshot stable.
`apartmentStoryState` expose phase, blocage, partie terminée, temps de narration
et panne consommée pour le scénario suivant.

Le démontage arrête et libère le mixer modal, restaure la visibilité du rig,
retire les corps de chaise et rend le modèle à son parent avant son nettoyage.
Les sons, textures et écouteurs du PC restent sous leurs propriétaires existants.

Validation : `computer-use-integration.test.mjs` charge le personnage du
garde-robe avec ses vêtements et la géométrie réelle. Il vérifie deux approches,
obstruction d’un côté, cadrage tête/pieds, pauses, contacts, relevé POV, entrée
unique et reprise stable. Les projections CPU optionnelles via
`PC_VISUAL_AUDIT=1` contrôlent les poses ; elles ne valident pas les matériaux
WebGL, le son au casque ou les commandes d’un véritable navigateur.
