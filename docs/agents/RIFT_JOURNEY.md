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
  planche lâchée, fuite et capture).

## Déroulé

1. Relevé après l'arrivée couchée : répliques (« C'est quoi ce bordel ? »…),
   puis objectif « Suivre la boussole vers le nord ».
2. Dans le hall d'approche (≤ 24 m de la galerie), la planche est posée deux
   voies plus loin, derrière le mur de galerie, avec son collider `rift-plank`.
3. Au bord d'un portail : plan 1P (regard en face puis vers le fond, à gauche, à
   droite, zoom sur la planche). Si la planche est trop loin et hors champ, elle
   est reposée à ±2 voies avant le plan.
4. Sur la planche : vitesse réduite et axée par `setMovementConstraint`, regard
   forcé vers le bas, roulis selon l'inclinaison, Q/D (gauche/droite) contre le
   déséquilibre, jauge `BalanceMeter`, craquements et cœur (`RiftAudio`).
5. Chute dans le vide (quelle qu'en soit la cause) : caméra scriptée qui tombe en
   regardant la lumière s'éloigner, fondu, carte « Tu es tombé. », reprise au bord.
6. 2,6 m après l'autre bord : plan 3P (`sampleCorridorPresentation`), il se
   retourne, la créature sort de la galerie d'en face (stinger, voix, cri).
7. Retour en 1P : elle attend puis traverse lentement. E près du bout de la
   planche (sur le sol) la pousse : la créature repart en criant, ou tombe avec
   elle si elle était dessus. Sans cela elle traverse et suit la trace du joueur ;
   distancée de 30 m (ou 20 s) elle abandonne, sinon capture et reprise côté nord.

Le brouillard et le fond virent au sombre près de la faille (`atmosphereAt`).
