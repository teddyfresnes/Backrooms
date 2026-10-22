# Physique, joueur et assets

`AudioSystem` lit huit prises réelles locales par surface pour la marche et les
réceptions : moquette dans les Backrooms, bois dans l’appartement et béton dans
la cage d’escalier. Le sprint bascule sur une performance continue dédiée à la
surface, à cadence humaine native, avec fondu d’entrée/sortie au lieu d’accélérer
et de tronquer les sons de marche. Son niveau domine nettement la marche ; les
pas ordinaires sont assombris, légèrement ralentis et renforcés dans le bas du
spectre pour éviter les transitoires croustillants. Chaque prise courte est
analysée au premier usage afin de démarrer sur son attaque réelle, notamment à
l'atterrissage, sans rejouer son silence initial. `PlayerController` transmet la vitesse
verticale brute à l’impact ; les seuils audio distinguent petite, moyenne, forte
et très haute chute, cette dernière ajoutant seule le craquement. Le profil intérieur ne crée
pas le bourdonnement des Backrooms : il joue une pluie discrète dont le niveau
augmente progressivement près des fenêtres de l'appartement, du hall et de sa
porte extérieure. La distance se mesure à toute la surface de l'ouverture, sans
rayon de visée ni coupure de portée. Les ouvertures de l'appartement sont figées
avant de restaurer les stores : leur animation ne déplace jamais la source. Une
composante diffuse et un fondu doux gardent la pluie audible quand on se décale. Il fournit aussi les sons de porte,
verrou, stores et interrupteur. La fermeture d'un store atténue progressivement
puis presque entièrement la contribution de sa propre fenêtre, sans modifier les
ouvertures du hall. Tant qu'un store reste ouvert, un lit de pluie faible reste
audible dans tout l'appartement ; la proximité de la fenêtre ajoute son niveau
direct. La boucle utilise une couture tête/queue fondue. `SiteAudio` reste global entre les runtimes pour les
quatre ponctuations de l’intro, les retours discrets des boutons et la musique,
activée uniquement lorsque le menu principal a fini de charger (jamais au
chargement, en partie ou dans le menu pause).
Pour une session jouable, `AudioSystem.start(onProgress)` est lancé puis suspendu
pendant `initialize()` : les fichiers sont téléchargés et décodés derrière la
barre de chargement, et le second `start()` à l’entrée ne fait que reprendre le
contexte déjà prêt. Le fond non jouable du menu principal saute ce préchargement.

`RussianStairwellGame` utilise un plan Rapier statique séparé de `WorldStream`.
La coque de l’appartement entre dans `PhysicsWorld.addTrimeshChunk()` après mise
à jour de ses matrices monde ; les meubles gardent des AABB économiques. Les
deux familles sont indexées par clé et suivent le même nettoyage que les chunks
procéduraux. La porte d’entrée possède son propre collider cinématique,
synchronisé avec le vantail à chaque tick fixe. Le balayage transmet au joueur
un déplacement externe consommé par son prochain mouvement physique, afin que
la porte le pousse sans tick Rapier supplémentaire. Une nouvelle interaction
pendant l'ouverture ou la fermeture inverse immédiatement la cible. Son verrou
intérieur est raycasté sur le mur côté appartement. Engagé, il limite
l'ouverture à 5,5 % de la course, puis ramène automatiquement le vantail au bâti.

La double porte importée du rez-de-chaussée reste statique et collidable, mais
`HallExitInteraction` la raycast comme un portail. Un appui sur l’action
configurable **interagir** déclenche le routeur de `main.ts` : la sauvegarde du
stairwell n’est pas réécrite, tous ses systèmes sont détruits, puis le `Game`
procédural est chargé dynamiquement. La transition est différée à une microtâche
afin de ne pas détruire Rapier au milieu du tick d’entrée courant. Une fois le
niveau 0 réellement initialisé, le nouveau runtime écrit son checkpoint
automatique de destination.

`SaveHistory` conserve au plus douze entrées versionnées, manuelles ou
automatiques, communes aux deux expériences. Une seule autosave représente la
session courante et remplace la précédente. Elle est écrite à l’entrée d’un
niveau, toutes les 30 secondes jouées, au masquage ou à la fermeture de la page,
et avant un retour confirmé au menu principal. Les
snapshots Backrooms stockent le seed et une position locale à son chunk ; les
snapshots russes gardent aussi l’état de la porte, de son verrou et de
l’éclairage de l’appartement. Les anciens états de porte sans champ `locked`
sont relus déverrouillés. Ne jamais sauvegarder la
position brute d’une chute : chaque runtime écrit le dernier ancrage sûr transmis
par `PlayerController`.

`PhysicsWorld` possède un personnage cinématique Rapier et des lots de colliders
indexés par clé de chunk. Les mutations groupées passent par
`batchChunkChanges()` pour limiter les synchronisations.

Une porte interactive garde son collider fermé au début de l’animation.
`WorldDoorLayer` signale à `WorldStream` quand l’ouverture devient praticable,
puis `PhysicsWorld.setChunkColliderEnabled()` désactive uniquement ce collider.
La broad phase prend ce changement au tick fixe planifié suivant : ne pas forcer
un `world.step()` supplémentaire depuis la mise à jour d’interaction.
Un appui bref sur E ouvre vite ; un maintien d’une seconde ouvre en deux secondes.

`Game.frame()` :

1. quand le pointeur est verrouillé, borne le delta et exécute
   `CharacterRuntime.update()`, dont l’accumulateur choisit le joueur, le ragdoll
   ou le relevé à 60 Hz ;
2. laisse le personnage interpoler la caméra active puis met à jour streaming et
   interactions ; pendant une chute, le streaming suit le bassin physique ;
3. quand le jeu est en pause, fige simulation, streaming et caméra ; seul le
   menu principal peut remplacer cette caméra par son panoramique lent ;
4. adapte progressivement la résolution en mode qualité automatique ;
5. rend via `PostFX`.

Ne pas déplacer la physique dans la mise à jour de rendu variable. Les rampes,
marches, accroupissement et transitions verticales sont sensibles à cette
séparation.

Les commandes configurables sont stockées dans `GameSettings.controls` sous
forme de codes normalisés : les lettres suivent `KeyboardEvent.key` afin que les
presets AZERTY et QWERTY correspondent aux caractères imprimés, tandis que les
autres touches gardent leur `KeyboardEvent.code` physique. `ExperienceUI`
garantit une touche unique par action, puis `Game` transmet la configuration à
`PlayerController` et `InputManager`. Les variantes gauche/droite de Maj, Ctrl
et Alt sont traitées comme une même touche pour les conflits et à l’exécution.

## Props et assets

- `PropCatalog.ts` décrit chemins, tailles, catégories et transformations.
- `PropPlacement.ts` sélectionne des placements déterministes et sûrs.
- `WorldProps.ts` charge, normalise, clone et détruit les modèles.
- Dans une scène composée, un accessoire posé en hauteur référence son meuble
  support : sa hauteur suit l’échelle réelle du meuble et son emprise est
  réduite si nécessaire pour rester à l’intérieur du plateau.
- Le catalogue runtime est volontairement resserré : ancres PBR Poly Haven,
  petit désordre Kenney seulement. Les sources sont servies depuis
  `public/assets/textures/{polyhaven,kenney}`.
- `WorldProps` met en cache le modèle normalisé et partage ses géométries entre
  instances ; seules les matières teintées appartiennent au chunk et sont
  détruites au démontage.
- `WorldView.ready` permet au chargement initial d’attendre les assets visibles.
- Toute ressource ajoutée doit être locale et déclarée dans
  `public/assets/licenses.json`.

Retour au [routeur runtime](RUNTIME_RENDERING.md).
