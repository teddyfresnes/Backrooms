# Backrooms intégré — correctifs préparés, validation à terminer

Projet existant : `appgprj_6ad38cbd518c81918ef345d5a1eb55fc`. Base : version 31,
commit `c884245af382fef8b68e0a042fea035561bdeb2a`. Aucun nouveau jeu ni changement de moteur.

## Changements réalisés

- Réponse visuelle avant import, destruction de l'ancien runtime et création du renderer.
  La préparation attend deux frames navigateur puis une tâche. Le générateur du décor
  de menu utilise maintenant le worker existant. Le pack d'animations est décompressé,
  parsé et converti en tableaux typés dans un worker temporaire ; montage par deux clips.
  Construction du hall et atlas de murs découpés, un téléversement de texture par frame,
  calcul des bornes skinnées par lots. Ces modifications ciblent des travaux synchrones
  repérés dans le code ; leur rôle exact dans le blocage intermittent n'a pas été établi
  par un profil navigateur.
- Une horloge visible commune pilote photos, fondus et texte. La première photo démarre
  sans attendre les cinq suivantes ; deux images se préparent à la fois. Le zoom sortant
  reste figé pendant le fondu suivant. Passer stoppe textes, animations et musique, puis
  contourne également la présentation 3D. Les états de film et de scène restent séparés.
  Garde contre les lancements répétés, invalidation des anciennes sessions, attente d'un
  onglet visible, délai d'échec borné et boutons Réessayer/Retour au menu.
- Chargement indéterminé : un seul libellé, une ligne fine, aucun pourcentage de phases
  pondérées. Palette et états communs aux menus, confirmations, paramètres, ouverture et
  garde-robe. Suppression du fond spécial de Continuer et des cadres de sélection.
  Continuer désactivé sans sauvegarde. Confirmation évitée au premier départ ; focus
  conservé dans la fenêtre puis rendu à son origine à l'annulation.
- Le courrier peut être récupéré directement. Le premier rappel avec gasp et recul se
  déclenche au palier de la première volée, défini depuis `layout`. Les deux barrières
  temporaires autorisent la première montée et empêchent la seconde. Réarmement spatial,
  cooldown et flag sonore sont distincts. Gasp persisté immédiatement ; aucun second gasp
  à la lecture de la lettre. Migration des anciens états mail/home/done comme déjà avertis.
- Dix profils fixes de portes, dont trois silencieux, refus, réactions non verbales et
  porte spéciale est du RDC. 26 adaptations françaises courtes, dont 24 compatibles avec
  les coups ; curseurs et acteurs sauvegardés. Un événement en attente par porte, coups et
  sonnette partagent le verrou, délai de cinq secondes après le clip accepté, pause sur
  le temps joué et destruction des événements en quittant. Sous-titres séparés et limités
  par distance ; indications non verbales optionnelles.
- Porte spéciale : pivot dérivé de la vraie charnière de l'export, ouverture faible,
  maintien puis claquement synchronisé. Fond opaque derrière la porte ; collision du mur
  maintenue. Événement sauvegardé dès engagement ; interruption/restauration porte fermée.
- Remplacement de la synthèse vocale et des oscillateurs par des enregistrements. Voix et
  effets réutilisent le contexte et le master existants, avec localisation à la porte et
  filtrage. Budget partagé de trois chargements/décodages et cache des octets/buffers.
  La voix sélectionnée du joueur est exclue de l'attribution initiale des voisins.
- Conditionnement : conservation de la provenance originale des fichiers compressés à
  plusieurs passes et exclusion des copies temporaires connues dans la sortie. Aucun
  asset de scène ou vêtement n'a été retiré. Sonde de diagnostic rendue portable ; test
  d'appartement adapté à la hiérarchie imbriquée de l'export actuel.

## Ressources audio intégrées

- [Super Dialogue Audio Pack V1 — Dillon Becker](https://dillonbecker.itch.io/sdap),
  CC BY 4.0 : Alex Brodie, Ian Lampert, Sean Lenhart, Karen Cenon, Meghan Christian.
  Refus 1–10, raclement de gorge 13 et toux 15, selon la fiche originale.
  60 clips complets mono Opus, normalisés à -22 LUFS / -4 dBTP.
  Les textes français sont des adaptations d'intention, pas la transcription d'une tirade française.
- [Knock on door — jankooiker](https://freesound.org/people/jankooiker/sounds/237937/),
  CC0 : prise publique de trois coups sur une porte en bois, 0,77 s.
- [Mechanical entrance doorbell #2 — Joseph SARDIN](https://bigsoundbank.com/mechanical-entrance-doorbell-2-s3045.html),
  CC0 : sonnette mécanique d'appartement, 4 s.
- Claquement : enregistrement `door-close.mp3` déjà présent dans le projet.

Provenances et empreintes : `neighbor-audio-assets.json`. Vérifications de décodage :
`neighbor-audio-checks.json`. Les 62 nouveaux fichiers (303 937 octets) se décodent,
mono Opus. Cette vérification technique ne constitue pas une écoute.

## Vérifications effectuées

- Passe générale Vitest : **751/755**, 102 suites passantes sur 106. Deux audits ayant
  dépassé leur délai dans cette passe ont réussi isolément : boucle régionale physique
  (84,97 s de test) et propriétaires régionaux (27,26 s). La sonde d'entrée utilisant un
  chemin d'ancien workspace a été corrigée et réussit ensuite. Reste l'audit legacy
  « generates deep voids deterministically but only rarely across a seed sample » :
  environ 35 s, au-delà de son délai de 20 s, même isolé. Son corpus et son délai n'ont
  pas été modifiés ; les générateurs concernés n'ont pas été changés.
- Dernière sélection des cycles de vie : **28/28**, sept fichiers. Dernière sélection
  après le déplacement du premier rappel : **20/20**, quatre fichiers. Cela couvre
  film complet, passages à 0/7/21/38 s, dix relances simulées, demandes répétées,
  annulation de préparation, focus modal, échec borné et nettoyage.
- Essais Rapier du palier : neuf combinaisons de 30/60/120 Hz et 2,8/5,8/7,5 m/s,
  appui à la fin de la première volée, recul court puis retour au RDC, réussis.
- Tests des voisins : délais après fin du son, anti-spam, silence stable, pause,
  distance des légendes, non-verbal, variété, identités et porte unique, réussis.
- Personnage complet : **654/655** dans la passe générale ; l'intégration garde-robe
  avait obtenu un 404 dans le harnais de fichiers. Relancée seule, elle réussit (**1/1**)
  avec le profil sélectionné dans les deux vues et sa conservation après chute physique.
- TypeScript et build Vite réussis. Vérifications de conditionnement réussies :
  3 165 fichiers, 264 324 903 octets, fichier maximal 16 Mio ; appartement de
  349 270 200 octets conservé sans perte ; 148 topologies et 148 fichiers de vêtements
  vérifiés ; assets référencés présents. `git diff --check` réussi.

## Vérifications non effectuées et blocages

La page publiée demande une connexion dans le navigateur de test. La demande de
connexion sécurisée n'a pas abouti. L'aperçu géré échoue avec :
`sites-previewd mailbox is unavailable ... No such file or directory`.
Il n'a pas été remplacé par un serveur ou une autre voie de contrôle navigateur.

**Aucun parcours réel du jeu ni comparaison de captures après refonte n'a donc été
validé dans ce navigateur.** Restent à faire : visite froide/chaude, film complet et
passages réels, CPU/réseau ralentis, comparaison de tous les menus et petits écrans,
observation du palier et de la charnière, interactions réelles avec plusieurs portes,
persistance au fil du jeu et écoute au casque/haut-parleurs, bas volume et muet.

**Aucune mesure navigateur avant/après, aucune valeur de FPS ou de latence de Passer
n'est disponible.** Les simulations et mesures de durée de tests Node ne sont pas des
mesures de fluidité WebGL. Les étiquettes des clips ont été vérifiées dans la fiche
originale, mais leur contenu et le mix n'ont pas été validés à l'écoute.

Le travail reste une version révisable, non une livraison déclarée terminée.
La publication de cette révision attend la reprise des vérifications demandées.
