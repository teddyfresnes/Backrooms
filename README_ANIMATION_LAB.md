## v123 — Combat synchronisé et animations contextuelles

Voir [COMBAT_V123.md](COMBAT_V123.md) pour la refonte, les commandes et ses limites de validation. Les notes des anciennes versions ci-dessous sont historiques ; le contact continu, les interruptions et le transfert d’inertie de v123 les remplacent pour le combat.

## v108 — Clean first-person guard / punches

In first person, combat now uses a dedicated **arms-only presentation mask**. The moment guard or a strike becomes active, the lower body and torso/back are removed from the 1P combat viewmodel; shoulder/clavicle skin influences are intentionally excluded so the camera cannot see the avatar's back or the inside of the chest mesh. Hands and forearms remain fully visible, with only strongly upper-arm-owned geometry allowed around the elbow.

The near-camera safety solver now reacts only to visible hands/forearms, so invisible shoulders can no longer shove the entire combat rig forward. Outside combat, the existing legs/body first-person presentation remains available. Gameplay camera position and physical combat behavior are unchanged.

- `npm test` equivalent regression run: **188 / 188 passing**.
- Full Vite build is not claimed in the extracted archive because local dependencies are absent.

## v101 — Target-driven punches

Punches are now driven by the opponent's live skeleton position. Straights/jabs/crosses/step-ins bias toward the head/jaw, compact close shots toward upper chest, and both player/NPC use a bounded two-bone shoulder+elbow solve so the fist visibly travels to that point. Torso pitch and source-spine motion are heavily reduced, the old downward strike head-dip is removed, and hit volumes are tightened so damage lands when the solved fist actually reaches the opponent rather than when an oversized invisible sphere overlaps. Base strike timing is slightly longer/readable (`0.72 s` light, `0.84 s` power, `0.78 s` counter).

## v98 — GTA-style contextual melee / real fist contact

Combat now resolves player hits from the evaluated left/right fist sweep rather than a fixed animation timer. A hit must physically cross the NPC head/upper-body/body contact volumes on the outgoing phase with clear line of sight. Locked strikes receive only a bounded upper-arm aim assist so the fist reaches the opponent without forcing wrists into spaghetti poses.

Medium-range combinations vary by spacing (compact/body-hook inside, long straight/cross outside), far attacks retain collision-safe step-in movement, and even a distant whiff carries a small forward commitment without target magnetization. Holding `F` remains defensive; a valid `F + LMB` now performs a visibly deeper duck/side-back evade before the retaliatory hook.


## v85 — Stable first-person guard framing

- First-person combat body is pulled slightly back toward the eye compared with v84 (`+0.055 m` combat-forward presentation, nearest-fist target `0.49 m`) while staying low on screen.
- Combat arm/hand presentation scale is `0.95 / 0.95`; the 1P arm visibility mask now includes shoulder/clavicle/collar influences to avoid the missing wedge/hole near one upper arm.
- The 1P hand framing solver now calibrates once for ~0.26 s when Fight Idle becomes active, then locks its lateral/depth/vertical offsets for the rest of that guard. Walk/strafe/stop transitions cannot reframe the entire viewmodel anymore.
- Releasing RMB in first person keeps guard for `0.75 s` before lowering it. Re-pressing RMB during that grace keeps the same guard, GTA-style. Sprint/ineligible states still override the grace.
- Gameplay camera position remains untouched.
- `npm test`: **146 / 146 passing**.
- Compiler-API structural scan: **30 source TypeScript files**, **0 syntactic errors**, **0 critical local-name/redeclaration errors**.
- Full dependency-backed Vite/browser validation was not run in this environment.

## v77 — Combat aiming / recovery hotfix

Fight Idle remains the full-body combat base. Strike FBXs are still arm-only additive deltas, but their upper-arm pivots now receive a smooth counter-yaw equal to the live Fight Idle chest yaw relative to the look-facing root. This keeps the torso bladed while sending the fists forward toward the reticle. The 1P combat rig is also lowered. Get-up playback is normalized and finalization has a reserved-position fallback to avoid a frozen recovery state.

## v76 — Combat reaction / get-up reliability

- 1P Fight Idle presentation is lowered without moving the gameplay camera.
- NPC first-hit knockdowns are less frequent so the full supplied Hit animation pool is visible more often; Big Punch stays much more likely to floor the NPC.
- Hit clips are duration-normalized, while the requested second-hit-during-reaction rule remains a guaranteed ragdoll.
- Knockdown handoff now carries clearer directional velocity and body yaw/tip motion.
- Living ragdolls always expose the production-style `E · Se relever` interaction; after 1.25 s they cannot be stranded by a perpetually-awake limb, and the safe standing search has more nearby candidates.

## v75 — Reliable living get-up

- Any living ragdoll (`HP > 0`) can recover with the interaction key (`E` by default); dead ragdolls (`0 HP`) remain unrecoverable.
- The production-style `E · Se relever` prompt no longer waits indefinitely for every limb rigid body to enter Rapier sleep. Core calmness enables it early, with a 2.5 s safety fallback; standing floor/capsule clearance is still mandatory.
- Recovery works even if pointer lock was lost during the fall.
- Uses the supplied `stand-up-back.fbx` and `stand-up-belly.fbx`, selected from the physical back/belly orientation.

# Movement + Animation Lab

## v57 — death FX first-person only

Le voile sombre/tunnel de mort est maintenant réservé à la vue première personne. En troisième personne, les faibles HP peuvent toujours désaturer légèrement la scène, mais `deathVeil` est désactivé afin que la mort reste lisible sans assombrissement global.


Le lab est unifié : `ANIMS / 1ST PERSON / 3RD PERSON` utilisent tous le même `PlayerController` et le même `PhysicsWorld`.

## Ragdoll — final naturel v55

La phase réactive du ragdoll reste inchangée pendant la chute. Après ~1,55 s, seulement si le corps devient presque immobile, la passe v54 continue de casser les équilibres absurdes où un bras/jambe sert de béquille ou où les jambes restent accrochées au-dessus d'un torse suspendu.

La v55 ajoute une relaxation finale courte et passive : quand le corps est réellement calme, la tête reçoit brièvement davantage de poids et moins d'amortissement angulaire afin que le cou laisse le crâne s'affaisser naturellement vers le sol. Un grand écart extrême avant/arrière des cuisses reçoit aussi un très léger biais de hanches et un peu moins de friction ; il se referme seulement jusqu'à une séparation encore asymétrique (~30 cm), sans chercher une pose symétrique. Un nouvel impact annule immédiatement cette relaxation. Aucun os n'est téléporté ou motorisé.

## Décor de test Backrooms — v53

Le décor reste volontairement compact et « sale », mais utilise maintenant le **même socle visuel que le repo principal** : `backrooms-wallpaper-seamless`, carpet color/normal/ARM, plaster color/normal/ARM et ceiling color/normal/ARM. Les couleurs, roughness, emissive, normal scales, fog et éclairages reprennent les valeurs de `MaterialLibrary.ts`, `BackroomsAtmosphere.ts` et `Game.ts`.

La zone reste ouverte pour tester le gameplay, avec un petit escalier, deux blocs d’impact et cinq trous de profondeurs différentes jusqu’à **-12,6 m**. Chaque trou possède son propre fond et son propre escalier de remontée. La surface reçoit en plus un faux-plafond à dalles, quelques panneaux manquants, des diffuseurs fluorescents purement visuels, des plinthes jaunies, quatre cloisons et quatre piliers physiques façon Level 0. Il n’y a toujours **aucun PointLight ni shadow map**.

Avant `dev/build`, `scripts/fetch-backrooms-assets.mjs` tente de mettre en cache localement les textures exactes du `main` de `teddyfresnes/Backrooms`. Le fallback procédural reste disponible hors-ligne.



## Ombre du joueur / éclairage Backrooms

Le lab suit la politique d'éclairage du projet `teddyfresnes/Backrooms` : `NoToneMapping`, `FogExp2`, le même `HemisphereLight`, le même `AmbientLight` et le même `DirectionalLight`, avec les valeurs **modern et legacy** du jeu principal et **les shadow maps désactivées**.

L'ombre du joueur est maintenant **retirée complètement**. Il n'y a plus de blob, plus d'ombre de contact, plus de mesh transparent sous le personnage, plus de texture Canvas dédiée et plus de calcul de hauteur de sol pour une ombre. Le personnage est uniquement éclairé par le même socle lumineux que le projet principal.

### Démarrage de déplacement caméra derrière en 3RD PERSON

Quand la caméra regarde derrière le personnage puis que le joueur avance, le corps ne fait plus un snap instantané de 180°. La physique reste camera-relative, mais le corps rattrape progressivement la direction avec les taux de rotation 3P existants. Pendant ce rattrapage, le choix visuel utilise la vitesse locale réelle : marche arrière quand le mouvement est derrière le corps, strafe quand il devient latéral, puis marche/course avant une fois le corps réaligné.

La locomotion démarre aussi dès la frame d'input, même si l'inertie physique est encore sous `0.24 m/s`, ce qui supprime le flash d'idle / glissement sans animation au départ.

## Corps visible en 1ST PERSON

La 1re personne utilise maintenant un **second rig uniquement visuel**, séparé du mannequin 3e personne :

- le `PlayerController`, la physique et la sélection d’animation restent uniques ;
- les deux mixers reçoivent exactement les mêmes clips, vitesses et crossfades ;
- le rig 3RD PERSON n’est jamais recentré ou modifié par la vue 1ST ;
- le rig 1ST utilise un cadrage dynamique : **122 % debout**, mais descend vers **84 % en crouch / low posture / slide** avec une transition lissée ;
- le bassin 1ST est fortement reculé derrière la caméra pour garder les cuisses hors de la near-plane, tandis que les bras et mains du même rig 1ST restent visibles quand les animations les projettent vers l’avant ;
- le bassin 1ST est remis droit après chaque frame d’animation : les jambes gardent leurs rotations, mais les Hips ne peuvent plus vriller/rouler le bassin devant la POV ;
- le pied le plus bas est calibré sur la pose de repos puis empêché de passer sous le plan physique des pieds du `PlayerController` ;
- la near-plane de la caméra 1ST est réduite pour éviter qu’une cuisse proche soit tranchée et laisse voir l’intérieur du mesh ;
- les triangles qui mélangent fortement torse et bassin sont supprimés du viewmodel au lieu d’être partiellement découpés par le shader ;
- aucun cap/cylindre/cache géométrique artificiel n’est ajouté au ventre : la coupe reste issue du vrai mesh inférieur ;
- en regardant vers le bas, le bassin reste bas dans l’écran et les jambes remontent vers le centre, façon CS/GTA.

## Mouvements et animations

- le dive reste supprimé : `Espace` reste un saut, y compris pendant le sprint ;
- Q/D restent disponibles pendant le sprint ;
- `Maj + avant` depuis un crouch tente de relever la capsule puis lance le sprint si le plafond le permet ;
- après un slide, le verrou bas reste court (**0,22 s**) et le cooldown anti-spam reste séparé ;
- `Crouched Sneaking Right` conserve sa correction de yaw de 180° sur les Hips ;
- `Running Slide` conserve la partie basse/près du sol puis crossfade vers `Crouch Idle` lorsque la vraie remontée vers debout commence ;
- la partie terminale debout du FBX de slide est tronquée afin que le personnage finisse bien accroupi ;
- **`Running.fbx` reste intégral** : aucune frame de course n'est coupée ; la sortie sprint → walk/idle est gérée uniquement par crossfade ;
- en 3e personne, à l'arrêt, le regard garde environ **±85°** via haut du torse + cou + tête ;
- les turns de l'Idle Action existent en deux niveaux : `Idle Turn Left/Right` à partir d'environ **106°**, puis `Idle Big Turn Left/Right` à partir d'environ **146°** ;
- chaque turn AUTO garde une courte phase visuelle protégée, mais Z/Q/S/D restent toujours directement contrôlés par PlayerController ;
- le yaw de visée reste piloté uniquement par la souris et ne peut pas être réécrit par une animation de turn.

## Chute

Le contrôleur suit maintenant séparément le temps en l'air, la distance réellement perdue et la vitesse verticale.

- une longue chute réduit progressivement l'air-control au lieu de permettre un virage complet artificiel dans le vide ;
- la 1ST PERSON ajoute une légère tension caméra/FOV pendant la descente et un impact proportionnel à la vraie chute ;
- la 3RD PERSON ajoute une pose procédurale de chute au-dessus des FBX existants ;
- marcher simplement d'un rebord n'est plus interprété comme un `Jumping Up` ;
- l'atterrissage dépend à la fois de la vitesse d'impact, de la hauteur de chute et du temps passé en l'air.

## Mort physique

**P** ou le bouton **KILL** capture la pose animée courante et transmet la vitesse du `PlayerController` au ragdoll. Le SkinnedMesh monde a le frustum-culling désactivé et ses matériaux sont forcés opaques à la mort afin que le corps reste visible dans les trous et près du décor. Après un gros impact de chute, la fin de `Falling Flat Impact` est transférée automatiquement à un ragdoll calme déjà au sol.

## Idle AUTO

- au lancement : ancien `idle.fbx`, affiché comme **Sleeping Idle** ;
- après marche, sprint ou crouch : **Idle Action** ;
- si le joueur reste immobile **2,5 s** : une variante est choisie aléatoirement parmi **Looking**, **Looking Down** et **Looking Behind** ;
- à la fin de cette variante, retour sur **Idle Action** pendant environ **2 s** ;
- ensuite : **Action Idle To Standing Idle** joué à vitesse réduite avec un crossfade plus long ;
- puis retour au **Sleeping Idle** ;
- après un `Jumping Up` (saut presque sur place), retour direct au **Sleeping Idle** ;
- un gros retournement depuis l'idle utilise les `Idle Turn` / `Idle Big Turn`, puis revient vers l'Idle Action.

## AUTO locomotion

- Sleeping Idle / Action Idle / Wait 1 / Wait 2 / transition finale ;
- marche / course / strafes de marche ; pendant le sprint, Q/D gardent leur steering mais `Running` reste le clip visuel (les deux mauvais FBX de sprint-strafe ne sont plus proposés) ;
- crouch idle / marche / strafes / transitions debout↔crouch ;
- `Jumping Up` pour le saut presque sur place ;
- `Jump`, `Jump Backward`, `Running Jump` selon vitesse, direction et vraie phase verticale ;
- `Running Slide` avec transition progressive vers crouch au début réel de sa recovery ;
- `Idle Turn Left/Right` et `Idle Big Turn Left/Right` pour les fortes rotations stationnaires.


## v45 — slow turn footwork
En 1re personne, une rotation lente au-delà de la plage de tête conserve désormais des petits turns animés pendant toute la rotation du corps. Aucun pivot stationnaire silencieux des pieds n'est autorisé ; les one-shots idle cèdent la priorité au turn.


## v47 — Perte d’équilibre près des trous

Les trous peuvent maintenant provoquer un ragdoll avant/pendant la chute : trajectoire trop proche du bord, mouvement parallèle risqué, lean du haut du corps au-dessus du vide ou chute réelle engagée. Le ragdoll reçoit une légère impulsion vers le trou, les dégâts dépendent de la hauteur réellement descendue, et un survivant reste au sol en attendant les futures animations de relevé. Les entrées d’escaliers restent protégées pour une descente normale.


## Ragdoll réactif (v49)

Le hand-off vers Rapier ne rend plus le personnage immédiatement inerte. Pendant une fenêtre maximale de 1,48 s, la vitesse réelle des os de l'animation précédente reste prioritaire puis décroît au profit de réflexes physiques courts : poursuite du pas si le joueur marchait/courait, tentative de pas de rattrapage, moulinets des bras, contre-balancement du buste et reach des avant-bras vers le sol. Les variantes `brace`, `windmill`, `scramble` et `asymmetric` évitent une réaction identique à chaque chute. Il n'y a aucun moteur de pose et aucun raycast supplémentaire : les contacts Rapier et les limites articulaires restent autoritaires, puis le corps devient totalement passif.

## v51 — Realtime impact damage / darker blood

- Every significant ragdoll contact applies HP loss immediately in the fixed physics tick. A wall strike during a fall can hurt now, then later floor/head contacts can hurt again.
- Fatal pit drops are resolved on the meaningful floor/step impact itself instead of waiting for the ragdoll to settle. The settled calculation is telemetry fallback only.
- Low HP remains persistent by health threshold, but the screen blood is now dark/multiply-blended rather than bright arcade red.
- 0 HP adds a much harsher death treatment: near-monochrome colour, crushed brightness, boosted contrast and strong tunnel vision.
- Wall/floor/step/object impacts resolve the nearest authored collider surface and place dark blood decals exactly on that plane. Head impacts may leave multiple small satellite droplets.
- Blood decals are pooled at 24 maximum and still use no per-frame raycast.
- `predev` / `prebuild` fetch several CC0 OpenGameArt textures locally; offline mode uses a dark procedural fallback.
- Stair/jump control grace from v50 is unchanged.


## v58 — blood impacts

Les morts par grosse chute et les chocs physiques létaux génèrent maintenant plusieurs taches de sang irrégulières sur la surface réellement touchée, avec tailles, rotations, proportions, textures et petites gouttelettes aléatoires. Le budget reste borné à 48 decals. En 3e personne, un joueur mort ne reçoit plus aucun grading sombre/critical-health à l'écran.


## v59 — textured pit floors / more blood

Les fonds de tous les puits utilisent maintenant la vraie moquette Backrooms (color/normal/ARM) au lieu d’un matériau noir. Les impacts mortels, surtout les chutes, produisent aussi des bursts de sang plus denses et plus aléatoires : plusieurs taches dominantes, davantage de gouttelettes, dispersion élargie et pool borné à 72 decals.


## v63 — hard controlled landing animation

Controlled jumps/falls that hurt but do not ragdoll can now use `hard-landing.fbx` as their authored landing recovery. Ordinary small jumps still use the normal landing/fall return, and lethal/severe impacts still use the heavy impact pipeline. If the optional file is missing during development, the lab falls back to `falling-to-landing.fbx` instead of failing startup.


NOTE: the uploaded Hard Landing FBX could not be accessed by the archive builder in this environment. The code is wired for `public/assets/animation-lab/hard-landing.fbx`; drop the uploaded file there with that lowercase name to enable the clip.

## v64 — Get-up controls

After a non-fatal ragdoll has physically settled, the standard Backrooms interaction prompt appears: E — Se relever (or the remapped interact key). The prompt matches the production HUD's cream/dark styling and is hidden during death, animation recovery, and when input is unlocked.

The two supplied animations, `stand-up-back.fbx` and `stand-up-belly.fbx`, are bundled. The physical torso orientation chooses the correct clip. A short pose crossfade transfers the exact ragdoll posture into the authored get-up; the full animation plays with no automatic respawn and no health reset. A supported and unobstructed standing capsule is required before the recovery begins and checked again before the live controller is restored. The temporary ragdoll is removed instead of becoming a persistent corpse. The existing death/respawn and blood systems remain separate.

The lab's presentation uses the same `interaction-prompt` markup as `src/ui/ExperienceUI.ts` from the main Backrooms repository. Integration should reuse that production HUD component and route the existing `interact` binding into the recovery request. The recovery physics and animation logic is self-contained in `GetUpRecovery.ts`, `GetUpRecoveryRules.ts`, and the shared physics wrapper.


## v65 — Combat guard

Combat mode uses the supplied `fight-idle.fbx` as the guarded upper-body pose. While guarded and moving, only Hips/leg tracks come from the classic `walking`, `left-strafe-walking` and `right-strafe-walking` clips; backward movement reverses Walking. The Fight Idle upper-body layer remains active, so fists/guard stay up in both 1P and 3P.

RMB behavior: 1P guard follows the held button directly. In 3P, a click keeps guard for ~5 s while stationary; moving after release cancels it immediately. Holding RMB keeps guard and disables sprint. Future enemy hits should call `receiveCombatHit(amount)` (or `notifyCombatHit()` if damage is already applied); this gives a 5 s defensive guard in 3P only.

Entry/exit uses the supplied Standing Idle ↔ Fight Idle and Action Idle ↔ Fight Idle transition clips according to the idle family that was active before combat.


## v66 — combat guard torso alignment

While combat guard is active and the player moves, classic Walking/Strafe clips still own the pelvis and legs. Their large authored pelvis yaw is now countered only in the upper spine chain so the Fight Idle hands, chest and head remain aimed with the guard instead of being carried sideways. The correction is distributed over Spine/Spine1/Spine2 and is shared by the third-person and first-person rigs. Stationary Fight Idle remains unchanged.


## v67 — Melee combat

Left mouse now owns attacks. A short click uses the supplied Punching clip as a normal punch; holding for 0.42 s commits a heavier charged punch (same supplied Punching motion, intentionally slower because no separate Big Punch attack FBX was provided). Punches are upper-body layers, so the v66 guarded locomotion legs remain intact in both first and third person.

Counter Hooks are only available while the test opponent is inside its real attack wind-up window. Use a clean double-click: the first tap must follow a quiet period, the second must land in the timing window, and a third rapid tap cancels the counter. A confirmed Hook cancels the incoming damage and lands an unblockable counter on the attacker.

Incoming normal punches have a 20% knockdown chance and big punches 50%. If another hit arrives before the current hit-reaction FBX finishes, knockdown/ragdoll is guaranteed. Surviving 3P hit reactions then enter the existing ~5 s combat guard; 1P does not auto-latch.

The room mannequin is now a 100 HP combat dummy/opponent. Use the `NPC COMBAT: OFF/ON` button: it faces and safely closes a short direct gap, attacks in melee range, can be interrupted, plays the supplied hit-reaction library and can ragdoll. If it is down, the button resets it into combat.


## v68 — Punch variation and POV guard

Normal punches now choose between original/opposite-hand variants derived from the supplied Punching FBX. Long-click Big Punch has separate heavy variants with stronger authored motion, while all punches/hooks are yaw-aligned back to Fight Idle so the torso does not punch sideways. Hit reactions randomize through the supplied library with immediate-repeat avoidance. In first person, only the render body is shifted forward/up and the arm reach is increased while combat is active; the gameplay camera stays fixed.


## v69 — Forward Strike Rebase + Centered 1P Guard

- Punches and long-click Big Punches now select from the real `punching.fbx` / `punching-alt.fbx` source pool. The two supplied punch files currently have the same SHA-256, so the random source selection is wired correctly but those two files are visually identical until distinct punch sources are supplied.
- Strike retargeting was rewritten: every upper-body quaternion track is rebased from its authored first pose onto the corresponding Fight Idle first pose. This removes baked-in sideways stance from torso, shoulders and arms while preserving the actual punch motion. Hooks use the same guard-relative retargeting.
- First-person guard/attacks now remove most of the authored bladed torso yaw, follow the POV yaw with upper-body-only correction, and dynamically center the midpoint of the two rendered hands in screen space.
- 1P combat framing is also moved farther forward/up (`0.22 m` / `0.14 m`) with slightly fuller arm/hand scale. The gameplay camera remains untouched.
- Latest supplied hit/groin/head/hook FBX files replace the previous copies in the bundle.
- `npm test`: **114 / 114 passing**.
- `AnimationLab.ts` and `CombatAnimationLayers.ts`: TypeScript transpile/parse OK.


## v70 — real Punch / Big Punch pools and aim alignment

Short LMB attacks now draw from all four newly supplied regular Punch FBXs through a randomized shuffle bag. Long LMB attacks (0.42 s+) draw only from the two newly supplied authored Big Punch FBXs. The same pools are available to the test NPC. The newly supplied three Hooks replace the previous copies and stay counter-only.

A committed strike is aimed from the player's actual horizontal look yaw, not from delayed body facing. Visual body yaw, melee reach testing and hit/knockback direction use the same aim source. Strike torso tracks are Fight-Idle-rebased with their large authored sideways twist suppressed, and a final Hips+Spine correction removes the residual Fight-Idle blade during attacks.

For first person, combat is presentation-only: the render rig follows POV yaw while guard/attacks are visible, receives full Fight-Idle Hips+Spine neutralization and stronger fist midpoint centering. The gameplay camera remains fixed.

## v72 — NPC runtime initialization fix

Fixed the remaining stale `previous` reference in `playNpcAnimation()`: the crossfade now consistently uses `previousAction`. This prevents the black screen / `ReferenceError: previous is not defined` immediately after loading. No combat behavior was intentionally changed.

## v73 — centered, fluid combat strikes

Fight Idle is now the canonical combat center. While guard or a strike is active, the player root already faces the exact horizontal look direction, so starting a punch cannot snap the whole body left/right just to acquire aim.

At strike start, the exact live Fight Idle torso pose is captured for both the third-person and first-person rigs. During the authored Punch/Big Punch/Hook animation, Spine/Spine1/Spine2 are held 94% toward that captured pose while the shoulders/arms retain the real FBX strike motion. This removes the clip-specific side lean that made some variants jump left and others right. Entry uses a 140 ms blend and return uses 160 ms. Fight Idle keeps advancing during the strike and fades back from its current phase instead of restarting at frame zero.

First-person no longer rotates the Fight Idle torso toward ordinary Idle. The render-only rig already faces the POV; the actual two hand positions are averaged and translated exactly back to the view center with no 1.18x over-correction. The gameplay camera remains untouched.


## v74 — Fight-Idle-master strikes / fluid punch timing

- Fight Idle now remains the **authoritative full-body combat pose for the entire strike**. Punch/Big Punch/Hook FBXs are converted to **arm-only additive quaternion deltas**: Hips, Spine, Spine1, Spine2, neck/head translations and clip-specific body lean/turn cannot replace the guard body pose anymore.
- Every strike delta starts and ends at quaternion identity with a smooth envelope (normal: 18% ease-in / release from 72%; heavy: 20% / 74%). This removes first-frame and last-frame pops while keeping the actual arm motion from the supplied FBXs.
- Fight Idle never fades out during a strike; it keeps bouncing underneath at full weight and at its current phase. Returning from a punch therefore does not restart Fight Idle or crossfade from a foreign torso stance.
- Authored strike speed is normalized by clip duration instead of one fixed playback rate. Normal Punch targets ~0.62 s, Big Punch ~0.82 s and Hook ~0.68 s, with safe clamps. Very slow source FBXs are accelerated rather than played in slow motion.
- The NPC uses the same additive strike overlay and compact timing; its Fight Idle base action also remains running instead of being replaced by an absolute attack clip.
- First-person lateral guard centering is frozen for the duration of a strike. Asymmetric hand travel can no longer drag the entire 1P body left/right during a jab/hook; the gameplay camera remains untouched.
- `npm test`: **121 / 121 passing**.
- TypeScript transpile/parser pass: **29 / 29 source files, 0 parse errors**. A no-resolve compiler pass found **0 critical TS2304/TS2448/TS2451 local-name errors**; only expected unresolved-module diagnostics remain without `node_modules`.
- Full dependency-backed Vite/browser visual validation was not run in this environment because dependency installation timed out.

## v78 — safer first-person guard framing

- First-person combat framing is pulled **16 cm farther away than v77** (`FIRST_PERSON_COMBAT_BODY_FORWARD_OFFSET = 0.08`) and lowered another ~5 cm (`FIRST_PERSON_COMBAT_BODY_UP_OFFSET = -0.105`).
- Combat arm/hand render scale is slightly reduced (`0.97` / `0.96`) so forearms and fists are less likely to cross the camera near plane during guard and punches.
- While first-person guard/attack presentation is active, downward look is capped at **58° below horizontal**. Full look range is restored immediately when guard drops, when switching to third person, or when entering ragdoll/get-up.
- This is an input-look clamp only; combat animation still never animates the gameplay camera.
- Movement/combat regression suite: **130 / 130 passing**.


## v79 — combat input + transition polish

Heavy Punch now requires a clean exact double-click. Holding LMB no longer creates a Heavy, and fast click-spam stays on normal punches; a third rapid click cancels a pending Heavy. During a real enemy counter window, the same exact double-click still belongs to the Hook counter. A confirmed Heavy upgrades the current light wind-up through a short additive crossfade rather than snapping to another absolute pose.

Guard locomotion is also smoother: movement during the idle→fight transition immediately hands Hips/legs to the locomotion layer, backward Walking has its own reverse action so direction changes can crossfade, and returning to Fight Idle phase-syncs the lower body to the continuously running upper body. Guard walking is 84% of normal speed. Forward sprint input cancels guard early with a blended exit and restores full sprint speed.


## v80 — diagonal locomotion + combat transition pass

- Heavy Punch remains **exact double-click only**. Single/long/spam clicks stay in the normal Punch pool; a third rapid click cancels a pending Heavy.
- Moving while `Idle → Fight Idle` is playing immediately hands Hips/legs to locomotion while the guard upper body blends in, preventing the stationary-transition skating effect.
- Guard locomotion uses 84% walk speed; forward sprint intent exits guard through the existing blend instead of waiting for the 5 s latch. Backward/strafe/Fight Idle lower-body changes keep the v79 crossfades and Fight Idle phase synchronization, so 1P hands do not teleport on stop.
- Added four runtime-generated diagonal locomotion clips: **walk forward-left/right** and **run forward-left/right**. They are synthesized once at load from the authored forward and strafe clips: legs/Hips receive the stronger lateral contribution while the torso stays forward-biased.
- In guard, the generated walk diagonals are used only by the lower-body layer; Fight Idle continues to own the guard upper body. Outside guard, the full generated diagonal walk/run clips are used. Pure Q/D strafing and backward diagonals keep their existing animations.
- Normal locomotion crossfades through diagonal states over 0.22 s rather than switching directly between pure forward and pure strafe.

## v81 notes

The 1P combat rig now sits farther back and lower so raised fists and forearms stay away from the camera during guard and strike arcs. Living `E · Se relever` recovery also uses a Rapier-safe suspension handoff instead of removing the articulated rigid bodies during gameplay, preventing the reported wasm removal crash.



### v82 — relevé E fiable

Le relevé vivant réserve maintenant la position debout validée avant de lancer l'animation dos/ventre. Un appui sur la touche d'interaction reste mémorisé jusqu'à ce que le corps soit stabilisé et qu'une capsule debout soit disponible, au lieu d'être perdu sur une seule frame. Les knockdowns de combat disposent aussi d'un fallback borné vers la dernière capsule debout valide, sans permettre de téléporter un joueur hors d'un trou profond.

## v83 — combat input, POV guard and turn stability

- Defensive guard is now actually defensive: ordinary Punch/Big Punch input is ignored while RMB guard or the temporary post-hit guard latch is active. The transient Fight Idle base used underneath an already-running attack is not treated as a defensive latch, so the clean double-click Heavy path still works outside guard.
- Hook counters no longer use the old double-click gesture. **Hold Ctrl + click once during the real NPC pre-impact window** to cancel the hostile hit and play a Hook. Ctrl+click outside that window does nothing, and Ctrl click-spam cannot leak into Punch/Big Punch.
- Forward Q/D animation selection uses a short animation-only commitment gate. Physics still reacts immediately, but rapid left/right chatter while advancing falls back to the straight Walking cycle instead of crossfading opposing diagonals and skating. An already committed diagonal is dropped as soon as the opposite side is requested, so later Q-D-Q-D spam also stays straight.
- First-person combat framing is solved from the actual rendered two-hand midpoint. Guard hands target roughly **0.46 m in front of the eye** and **11.5 cm below it**, with bounded smoothing. The gameplay camera remains untouched, and solved framing freezes during the strike so an extending fist cannot drag the whole viewmodel.
- Repeated full 360° turns rebase the body yaw onto the nearest equivalent turn around the continuous camera yaw, then inherit live mouse yaw once body-follow commits. This removes multi-revolution numerical debt that could make the avatar lag or twist after several spins.
- Regression suite: **143 / 143 passing**. Structural TypeScript scan: **30 source files, 0 syntax errors, 0 critical local-name/redeclaration errors**. Full dependency-backed Vite/browser validation was not run in this environment.

## v84 — garde 1P et chutes

La garde 1P est maintenant plus loin de la caméra et plus basse. Le cadrage ne se contente plus du milieu des deux mains : il garde aussi le poing le plus proche à une profondeur minimale devant l'œil. Le solveur de cadrage est ralenti et se fige temporairement pendant le crossfade jambes `marche → Fight Idle`, afin de supprimer le saut visible des poings quand le joueur s'arrête.

`Fall · high` et `Hard Landing` ne font plus partie du pipeline actif. Les petites chutes conservent `Fall · idle` puis `Fall → landing`; une vraie grosse chute passe en ragdoll vivant, avec le système existant de dégâts physiques et de relevé `E` si le joueur survit.


## v107 - Strike footwork and body transition
Committed strike legs now follow the player's real local travel vector instead of being hard-forced to a forward walking state. Gait phase is preserved across moving strike transitions, body yaw rotates through anticipation rather than snapping on mouse-down, and small procedural torso offsets use the captured entry momentum so side, backward and forward entries read differently.
