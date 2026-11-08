# Après la chute : la boussole, la faille, la planche

Le runtime `Game` joue cette suite pour toute partie jouable (jamais pour le fond
du menu). La géométrie de la faille est décrite dans
[Monuments historiques](WORLD_MONUMENTS.md).

## Inventaire porté

`RussianStairwellGame.escapeToBackrooms` passe `inventory.snapshot()` à
`onEnterBackrooms` ; `main.ts` le transmet à `Game` (`launch.inventory`). Les
sauvegardes Backrooms ajoutent les clés optionnelles `inventory` et `rift`
(`SaveHistory`, `RiftProgress`). Sans inventaire (anciennes sauvegardes), la
lampe et la boussole sont rendues. `Game` reprend le rail (`InventoryHUD`), la
molette, la touche lampe (`EquipmentInput`), `Flashlight` et `Compass` tenus par
`CharacterRuntime.setHeldItem`, comme dans l'immeuble. Le nord de la boussole est
le −Z monde : la direction de la faille.

## Modules

- `story/RiftProgress.ts` : progression sérialisable, sans import du monde
  (chargée par le lanceur). Étapes `arrival` → `north` → `plank` → `done`,
  planche posée (`lane` global, `story`, `bank`), résolution `dropped`/`fled`,
  répliques déjà dites.
- `story/RiftJourney.ts` : géométrie des voies (`riftLaneX(k) = 7 + 14k`),
  répliques (`RIFT_LINES`) et `BalanceModel` (pendule inversé amorti, rafales,
  calme à l'arrêt, limite 0,68 rad). Tests : `RiftJourney.test.ts`.
- `core/RiftEncounter.ts` : toute la séquence ; `Game` appelle `update` avant le
  rig et `applyCamera` après. `ownsCharacter` suspend le rig (plan 3P, chute,
  capture) ; `locksInput` empêche pause/console de rendre les commandes ;
  `blocksSaving` interdit toute sauvegarde au milieu. Tests : `RiftEncounter.test.ts`
  (hôte simulé : arrivée, planche hors champ, bord, chute, traversée, demi-tour,
  planche lâchée avant ou pendant sa traversée, fuite et capture, traque de
  l'autre rive). Le modèle de la créature est chargé pour toute partie jouable.

## Déroulé

1. Relevé après l'arrivée couchée : répliques (« C'est quoi ce bordel ? »…),
   puis objectif « Suivre la boussole vers le nord ».
2. Dans le hall d'approche (≤ 24 m de la galerie), la planche est posée sur la
   paire de portails voisine (±1 voie), derrière le mur de galerie, avec son
   collider `rift-plank`.
3. Au bord d'un portail : en 1P il se penche au-dessus du vide et regarde en bas,
   puis plan extérieur 3P depuis le vide (le mur entre les portails cacherait la
   planche en 1P) : il regarde d'un côté, de l'autre, et l'objectif glisse et
   zoome sur la planche. Retour en 1P tourné vers elle. Si la planche n'est pas
   à ±1 voie et reste hors champ, elle est reposée avant le plan.
4. Sur la planche : vitesse normale sur les appuis, réduite (×0,62) et axée par
   `setMovementConstraint` seulement au-dessus du vide ; regard forcé vers le bas,
   roulis selon l'inclinaison, Q/D (gauche/droite) contre le déséquilibre (calculé
   au-dessus du vide uniquement), jauge `BalanceMeter`, craquements et cœur.
5. Chute dans le vide (quelle qu'en soit la cause) : caméra scriptée qui tombe en
   regardant la lumière s'éloigner, fondu, carte « Tu es tombé. », reprise au bord.
6. 2,6 m après l'autre bord : plan 3P, il se retourne ; contrechamp dans l'axe de
   la voie, au long foyer, à travers les deux portails et la porte d'en face : la
   créature attend au fond du couloir d'approche (21 m), hurle et charge.
7. Retour en 1P pendant sa course : elle s'arrête au bord, hurle, puis traverse.
   E près du bout de la planche (sur le sol) la pousse : avant qu'elle monte, elle
   repart en courant et en hurlant dans son couloir jusqu'à disparaître au loin ;
   dessus, elle tombe avec la planche. Sans cela elle traverse et suit la trace du
   joueur ; distancée de 30 m (ou 20 s) elle repart hors de vue, sinon capture.
8. Sur l'autre rive (après résolution, à plus de 26 m de la faille), après un
   délai et de la marche, il arrive qu'elle surgisse au fond du couloir regardé
   (ligne de vue de 13 à 44 m, sol continu au même niveau) : cri, choc caméra,
   puis poursuite sur la trace du joueur, rapide en ligne droite mais freinée à
   chaque virage. Hors de vue 2,4 s, elle abandonne (« Je l'ai semée ») ; capture
   = reprise à l'endroit de l'apparition. Pas de sauvegarde pendant la poursuite.

Le brouillard et le fond virent au sombre près de la faille (`atmosphereAt`).
