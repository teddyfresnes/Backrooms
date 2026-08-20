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

## v77 — Forward strikes + lower 1P guard + get-up freeze fix

- First-person combat body is lowered by 13 cm versus v76 (`+0.075 m` → `-0.055 m`) without touching the gameplay camera.
- During Punch / Big Punch / Hook, Fight Idle still owns Hips/Spine/head, but the upper-arm roots counter-rotate the Fight Idle chest yaw with the same smooth strike envelope. This makes the fist travel along the reticle/look axis instead of along the bladed torso axis.
- Get-up source takes are normalized to ~2.15 s (back) / ~2.45 s (belly), so pressing E produces visible motion immediately instead of looking frozen for 6–8 s.
- Final get-up cannot deadlock with input disabled if the end-of-animation clearance query is transiently blocked: it falls back to the already validated reserved standing position. HP is still preserved and 0 HP remains unrecoverable.

## v76 — Lower POV guard, directional knockdowns, reliable get-up

- First-person combat guard is lowered substantially in the render-only rig (`+7.5 cm` instead of `+16 cm` vertical combat offset); the gameplay camera remains untouched.
- The test NPC now favors supplied Hit reactions on first contact (8% normal / 30% big first-hit knockdown) while the original player-facing 20% / 50% melee profile is preserved. A genuine second hit before a Hit reaction finishes still guarantees ragdoll.
- Hit reactions are tempo-normalized so normal follow-up attacks do not accidentally overlap a very slow reaction clip.
- Combat ragdolls inherit stronger forward travel, a small lateral imbalance and angular motion so a face hit pushes/tips the body instead of making it collapse in place.
- Any living player ragdoll shows `E · Se relever` immediately. Actual recovery becomes force-ready after 1.25 s if Rapier never reports full calm, still requires a supported unobstructed standing capsule, and searches a wider nearby ring plus the last valid live standing center when it remains close. `0 HP` remains unrecoverable.

## v75 — Reliable living get-up

- Any living ragdoll (`HP > 0`) can recover with the interaction key (`E` by default); dead ragdolls (`0 HP`) remain unrecoverable.
- The production-style `E · Se relever` prompt no longer waits indefinitely for every limb rigid body to enter Rapier sleep. Core calmness enables it early, with a 2.5 s safety fallback; standing floor/capsule clearance is still mandatory.
- Recovery works even if pointer lock was lost during the fall.
- Uses the supplied `stand-up-back.fbx` and `stand-up-belly.fbx`, selected from the physical back/belly orientation.

# Movement Lab intégré

## v57 — death FX first-person only

Le gros effet sombre de mort ne s’applique plus en troisième personne ; il reste uniquement en première personne.


Le mouvement reste dans un unique `PlayerController` : inertie, marche, sprint, crouch, saut, slide, slide-jump, lean A/E, bodycam et collision Rapier. Le ragdoll de mort est une couche physique séparée : le collider cinématique du joueur est simplement désactivé après la mort.

Commandes AZERTY par défaut : `ZQSD`, `Maj` sprint, `Espace` saut, `Ctrl` crouch / glissade. **P** (ou le bouton **KILL**) déclenche le ragdoll instantané.

Q/D restent utilisables pendant le sprint mais n'utilisent plus les anciens FBX `left-strafe/right-strafe` de sprint : l'animation `Running` reste utilisée afin de ne pas retourner visuellement tout le personnage. Les strafes de marche restent disponibles.

Après une glissade, le joueur entre directement en crouch normal : si une direction reste maintenue, `Crouch Walk` peut prendre le relais sans frame de `Crouch Idle`. Seuls le redressement / sprint automatique sont bloqués environ **0,22 s**. Le cooldown du slide reste séparé.

Un saut doit désormais être réarmé au sol pendant **0,24 s**. Comme l'entrée saut est également consommée au front montant, maintenir/spammer Espace ne permet plus de repartir exactement à chaque contact ni de relancer sans cesse le clip de saut.

## Décor de test Backrooms — v53

Le lab reste une zone mécanique compacte d’environ **36 × 30 m**, mais sa surface reprend désormais le langage visuel du repo principal `teddyfresnes/Backrooms` : papier peint Level 0, moquette humide, plaster, faux-plafond, plinthes et diffuseurs fluorescents avec les mêmes paramètres de matériaux. Quatre cloisons et quatre piliers physiques cassent l’effet « arène vide » sans fermer les trajets de test. Quelques dalles de plafond manquent volontairement et des traces de saleté restent visibles pour conserver l’aspect prototype.

Les **cinq trous restent indépendants et de profondeurs différentes** (~3,6 m à 12,6 m). Chaque fond possède toujours un escalier direct permettant de remonter et de recommencer les tests ; le puits le plus profond reste volontairement létal pour les tests de dégâts/ragdoll.

`npm run dev` lance une synchronisation best-effort des mêmes textures PBR que le repo principal depuis `public/assets/textures/...`. Si elles ne peuvent pas être récupérées, des textures procédurales locales prennent le relais afin que le lab démarre quand même.

## Chutes / gros impacts

Les longues chutes diminuent progressivement l'air-control. Les chutes normales utilisent `Falling Idle` puis `Falling To Landing`; les grosses chutes utilisent `Falling` puis `Falling Flat Impact`.

Quand `Falling Flat Impact` arrive à son terme, la pose finale au sol est transférée automatiquement au ragdoll en mode calme : vitesse initiale nulle, aucune bascule/variation de mort ajoutée et garde-fous anti-rebond renforcés pendant les premières fractions de seconde. Les membres réellement non supportés peuvent néanmoins finir de retomber sous la gravité.


## v45 — slow turn footwork
En 1re personne, une rotation lente au-delà de la plage de tête conserve désormais des petits turns animés pendant toute la rotation du corps. Aucun pivot stationnaire silencieux des pieds n'est autorisé ; les one-shots idle cèdent la priorité au turn.


## v47 — Perte d’équilibre près des trous

Les trous peuvent maintenant provoquer un ragdoll avant/pendant la chute : trajectoire trop proche du bord, mouvement parallèle risqué, lean du haut du corps au-dessus du vide ou chute réelle engagée. Le ragdoll reçoit une légère impulsion vers le trou, les dégâts dépendent de la hauteur réellement descendue, et un survivant reste au sol en attendant les futures animations de relevé. Les entrées d’escaliers restent protégées pour une descente normale.


## v55 — head/legs final relaxation

La fin du ragdoll reste entièrement physique. Après la phase active, une tête encore trop alignée avec le torse est brièvement laissée plus lourde et moins amortie afin de couler vers son appui sous gravité. Les grands écarts avant/arrière extrêmes se referment légèrement avec un très faible biais aux hanches et une réduction temporaire de grip, sans coller les jambes ni effacer les poses asymétriques normales.

La logique anti-perch v54 reste active : un bras/jambe ne peut toujours pas soutenir durablement le core dans le vide.


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

## v73 combat centering

Combat guard and strikes now share one look-facing root. Punch variants retain their authored arm motion while the live Fight Idle torso pose anchors the body center, preventing per-animation left/right body jumps. Attack entry/exit crossfades are longer and Fight Idle resumes at its continuously running phase. The first-person hand-centering pass uses the real pair of hand bones without lateral overshoot and never moves the gameplay camera.


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

## v78 — first-person guard comfort

The combat viewmodel now sits farther behind the eye and slightly lower, with a small reduction in combat arm/hand scale so punches do not push forearms through the POV. While guard is raised in first person, the camera keeps normal horizontal/upward freedom but downward pitch stops at 58° below horizontal; releasing guard restores the ordinary full look range immediately. No gameplay camera animation was added.


## v79 — guard movement polish

While guard is active, walking speed is reduced to 84%. Pressing forward sprint cancels guard before the 3P timeout and blends back to normal locomotion instead of cutting the pose. Starting to move during the Idle→Fight transition now immediately gives the legs to the movement layer, so the avatar no longer slides on the authored stationary transition.

Backward guard movement uses a separate reversed-Walking action and longer crossfades. When movement stops, the Fight Idle lower body resumes at the exact phase of the still-running upper Fight Idle, removing the visible hand/body teleport in first person. Heavy Punch input is now exact double-click only; click-spam remains normal punches.


## v80 — diagonal locomotion + combat transition pass

- Heavy Punch remains **exact double-click only**. Single/long/spam clicks stay in the normal Punch pool; a third rapid click cancels a pending Heavy.
- Moving while `Idle → Fight Idle` is playing immediately hands Hips/legs to locomotion while the guard upper body blends in, preventing the stationary-transition skating effect.
- Guard locomotion uses 84% walk speed; forward sprint intent exits guard through the existing blend instead of waiting for the 5 s latch. Backward/strafe/Fight Idle lower-body changes keep the v79 crossfades and Fight Idle phase synchronization, so 1P hands do not teleport on stop.
- Added four runtime-generated diagonal locomotion clips: **walk forward-left/right** and **run forward-left/right**. They are synthesized once at load from the authored forward and strafe clips: legs/Hips receive the stronger lateral contribution while the torso stays forward-biased.
- In guard, the generated walk diagonals are used only by the lower-body layer; Fight Idle continues to own the guard upper body. Outside guard, the full generated diagonal walk/run clips are used. Pure Q/D strafing and backward diagonals keep their existing animations.
- Normal locomotion crossfades through diagonal states over 0.22 s rather than switching directly between pure forward and pure strafe.

## v81 notes

First-person combat presentation is farther/lower without moving the gameplay camera. A living ragdoll recovery now disables the temporary articulated physics rig before get-up animation rather than removing its bodies through Rapier's joint-removal callback.



### v82 — relevé E fiable

Le relevé vivant réserve maintenant la position debout validée avant de lancer l'animation dos/ventre. Un appui sur la touche d'interaction reste mémorisé jusqu'à ce que le corps soit stabilisé et qu'une capsule debout soit disponible, au lieu d'être perdu sur une seule frame. Les knockdowns de combat disposent aussi d'un fallback borné vers la dernière capsule debout valide, sans permettre de téléporter un joueur hors d'un trou profond.

## v83 — guard input + lateral spam + continuous turns

Actual defensive guard (RMB or the temporary hit latch) now blocks normal offense. Hook is a separate counter command: hold **Ctrl** and click only inside the incoming NPC impact window; holding Ctrl and mashing LMB outside a threat window produces no attack. Ordinary punches therefore require LMB without Ctrl, while Heavy keeps the existing clean double-click rule.

Forward left/right animation chatter is filtered independently of physics. Q/D still changes travel immediately, but a forward diagonal must remain on one side for about 105 ms before the feet commit. Opposite-side input instantly drops the old diagonal, preventing Q-D-Q-D spam from alternating opposing clips and visually gliding.

The first-person combat body now uses the real hand midpoint to solve a bounded horizontal/depth/height framing target, keeping the fists visible in front of and below the fixed gameplay eye. Repeated third-person 360° mouse turns also discard redundant 2π yaw debt and feed live mouse delta into the body once turning has committed, preventing delayed spinning/twisting.

Verification: **143 / 143 tests pass**; 30 TypeScript source files pass the syntax/critical-symbol scan.

## v84 — combat POV / fall ragdoll

- Garde 1P plus éloignée et plus basse, avec protection du poing le plus proche de la caméra.
- Arrêt en garde : crossfade jambes `0.42 s` et gel court du solveur de cadrage pour éviter le téléport marche → Fight Idle.
- Petites chutes : `falling-idle` + `falling-to-landing` conservés.
- Grosses chutes : plus de `Fall High` / `Hard Landing`; passage au ragdoll vivant à la place.


## v107 - Momentum-aware strike movement
Punch advancement is no longer a forced straight-line override. At strike start the controller captures horizontal entry momentum, then blends it into the attack axis over the commitment window. Forward approaches retain carry, strafes arc into the attack, and backward movement performs a short brake/plant before the forward step. Collision remains handled by the normal player movement path.
