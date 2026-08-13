## v123 — Mise à jour du combat

La mise à jour est décrite dans [COMBAT_V123.md](COMBAT_V123.md). Elle ajoute `CombatContact.ts` et `CombatRig.ts`, unifie la résolution des contacts et transmet le point d’impact aux ragdolls. Reprendre aussi les modifications de `AnimationLab.ts`, `CombatAnimationLayers.ts`, `GroundKickRules.ts`, `PlayerController.ts`, `RagdollSystem.ts` et `PhysicsWorld.ts`. Les notes suivantes décrivent les versions antérieures.

## v101 combat integration note

Keep `applyCombatStrikeAimCorrection()` after mixer evaluation. It now performs a live target solve: choose head/jaw/upper-chest from the opponent bones, then rotate only the striking upper arm and forearm toward that point with bounded CCD-style passes. Do not reintroduce large spine pitch or per-strike head dips; the body should stay upright while the shoulder/arm carries the punch. Physical hit sweeps should use the solved striking hand and the tighter intended-target volumes.


## v85 — Stable first-person guard framing

- First-person combat body is pulled slightly back toward the eye compared with v84 (`+0.055 m` combat-forward presentation, nearest-fist target `0.49 m`) while staying low on screen.
- Combat arm/hand presentation scale is `0.95 / 0.95`; the 1P arm visibility mask now includes shoulder/clavicle/collar influences to avoid the missing wedge/hole near one upper arm.
- The 1P hand framing solver now calibrates once for ~0.26 s when Fight Idle becomes active, then locks its lateral/depth/vertical offsets for the rest of that guard. Walk/strafe/stop transitions cannot reframe the entire viewmodel anymore.
- Releasing RMB in first person keeps guard for `0.75 s` before lowering it. Re-pressing RMB during that grace keeps the same guard, GTA-style. Sprint/ineligible states still override the grace.
- Gameplay camera position remains untouched.
- `npm test`: **146 / 146 passing**.
- Compiler-API structural scan: **30 source TypeScript files**, **0 syntactic errors**, **0 critical local-name/redeclaration errors**.
- Full dependency-backed Vite/browser validation was not run in this environment.

## v77 — Forward melee + robust living get-up

For integration, keep the world/player yaw look-facing while combat is active. Do not straighten the Fight Idle torso. Instead apply `applyCombatStrikeAimCorrection()` after mixer evaluation: it counter-rotates only the upper-arm roots by the current chest-to-root yaw, multiplied by the punch envelope. Recovery keeps the prevalidated standing position as a fail-safe so a transient dynamic obstruction cannot leave a living player permanently frozen after E.

## v76 — Combat knockdown + living recovery integration

- Keep the 1P camera authoritative: only the render body is lowered for combat guard framing.
- Use the NPC-only first-hit knockdown roll (`8%` Punch, `30%` Big Punch, `16%` Hook) when exercising the lab dummy; `MELEE_ATTACKS` retains the original 20% / 50% player-facing profile.
- Use `hitReactionPlaybackRate()` when playing Hit reactions so slow authored clips do not keep the second-hit knockdown window open for an excessive time.
- Ragdoll knockdowns should receive forward/lateral velocity and modest angular motion from the incoming hit direction.
- For a living ragdoll, show `E · Se relever` independently of Rapier sleep. Gate the actual transition with safe floor/capsule clearance and `recoveryReadyForInput()`; death (`0 HP`) must never recover.

## v75 — Reliable living get-up

- Any living ragdoll (`HP > 0`) can recover with the interaction key (`E` by default); dead ragdolls (`0 HP`) remain unrecoverable.
- The production-style `E · Se relever` prompt no longer waits indefinitely for every limb rigid body to enter Rapier sleep. Core calmness enables it early, with a 2.5 s safety fallback; standing floor/capsule clearance is still mandatory.
- Recovery works even if pointer lock was lost during the fall.
- Uses the supplied `stand-up-back.fbx` and `stand-up-belly.fbx`, selected from the physical back/belly orientation.

# Intégration dans `teddyfresnes/Backrooms` — v53

## v57 — death presentation

`damageVisualState` accepte maintenant un flag `includeDeathEffect`. Le lab le lie au mode de vue : true en 1P, false en 3P. Cela conserve le grading de santé critique en 3P sans le tunnel/voile de mort.


Cette version reste alignée sur l'éclairage du `main` actuel de Backrooms :

- `THREE.NoToneMapping`, exposition 1 ;
- `renderer.shadowMap.enabled = false` ;
- palette `BACKROOMS_ATMOSPHERE` / `BACKROOMS_LEGACY_ATMOSPHERE` ;
- mêmes Hemisphere / Ambient / Directional (positions et intensités modern + legacy) ;
- aucun `PointLight` ajouté.

## Environnement du lab v53

Le testbed utilise désormais les mêmes noms de textures et les mêmes paramètres PBR que `src/render/MaterialLibrary.ts` du repo principal : wallpaper seamless, plaster color/normal/ARM, carpet color-v2/normal/ARM et ceiling color/normal/ARM. Les assets sont copiés en local par `scripts/fetch-backrooms-assets.mjs` avant `dev/build`, avec fallback procédural si le réseau est indisponible.

La géométrie ne cherche pas à reproduire le world generator : elle reste volontairement simple pour isoler les tests de mouvement. En revanche, elle ressemble davantage à un petit morceau de Level 0 grâce au faux-plafond, aux fluorescents visuels, aux plinthes, aux quatre cloisons et quatre piliers collidables. Les cinq puits de test restent séparés, de profondeurs différentes et **tous disposent d’un escalier de remontée**.

Le renderer du lab reprend aussi la politique du jeu : antialias/alpha/log-depth désactivés, `SRGBColorSpace`, `NoToneMapping`, exposition 1 et shadow maps désactivées. Aucune lumière ponctuelle n’est ajoutée aux faux fluorescents.

## Ombre joueur

Aucune. L'ancien `PlayerContactShadow` a été supprimé intégralement : aucun quad, aucune texture d'ombre, aucun render target, aucun raycast dédié et aucune lumière supplémentaire.

## 3e personne — caméra derrière + déplacement

Le rendu ne force plus `bodyYaw = aimBodyYaw` dès l'appui sur Z/Q/S/D. La physique reste camera-relative, mais le corps rejoint progressivement la direction au taux de rotation normal.

Tant que l'écart caméra/corps est important, la sélection d'animation se base sur la vitesse locale réelle pour utiliser marche arrière ou strafe. Le sprint forward ne reprend qu'une fois le corps suffisamment réaligné. La locomotion démarre immédiatement sur la frame d'input, même tant que la vitesse inertielle est encore sous `0.24 m/s`.

Le dossier `repo-overlay` des anciennes versions n'est pas distribué : il ne doit pas servir de patch automatique au repo principal.

## Sleeping Idle / turns 3P

Une rotation de caméra seule ne compte pas comme une action. Tant que le joueur n'a pas déclenché de locomotion ou d'action gameplay, les turns sur place utilisent les clips Sleeping Idle (`left/right-turn-90` puis `left/right-turn`) et reviennent à `idle`.

## Strafe diagonal v40

`PlayerController` conserve le mouvement caméra-relative mais applique `forwardDiagonalStrafeScale = 0.64` uniquement à `avant + gauche/droite`. Les strafes latéraux purs et les diagonales arrière ne sont pas modifiés. En 3P, `AnimationLab` recentre légèrement cou/tête pendant les clips de strafe diagonaux pour que le regard reste davantage devant.

## POV 1P — famille Action Idle v43

`idle-action` ne modifie plus du tout la caméra. La position fournie par `PlayerController` reste la seule POV. Pour conserver le cadrage côté droit, le corps 1P est déplacé dans `firstPersonHipTarget` de +0,05 m sur son axe latéral et -0,055 m sur son axe avant, selon `bodyYaw`. C’est donc le viewmodel qui se place sous l’œil, jamais l’œil qui glisse pendant l’animation.


La correction de cadrage 1P doit rester active pendant `idle-action`, `idle-wait-1`, `idle-wait-2`, les turns Action Idle et `idle-action-to-standing-idle`. Elle ne doit se relâcher qu’après le retour effectif à `idle` (Sleeping Idle).


## v45 — slow turn footwork
En 1re personne, une rotation lente au-delà de la plage de tête conserve désormais des petits turns animés pendant toute la rotation du corps. Aucun pivot stationnaire silencieux des pieds n'est autorisé ; les one-shots idle cèdent la priorité au turn.

## v46 — Action turn settle flexible
Après un turn Action Idle 1P, ne pas forcer immédiatement `idle-action` si le corps a fini son rattrapage et que la POV est déjà dans `idleActionTurnStopDegrees`. Le clip de turn est figé sur sa dernière phase lisible comme stance stationnaire temporaire ; un vrai changement d’état ou la séquence AFK le remplace normalement. Cela évite le saut visuel « deux jambes posées après le turn → jambe avant canonique de `idle-action` ».


## v48 — ragdoll de bord contrôlé / maladroit

`src/dev/PitEdgeRagdoll.ts` reste une logique pure 2D sans raycast par frame, mais la proximité seule n’est plus suffisante. Le système distingue maintenant **intention claire** et **perte de contrôle**.

Un saut explicite est mémorisé par `PlayerController` via une courte fenêtre de contrôle (`getPitControlIntent`). Une approche où le joueur avance dans une direction cohérente tout en regardant vers le fond est traitée comme une descente volontaire. Longer le bord avec une trajectoire stable et sans dérive inward est également considéré contrôlé. Ces états font décroître le risque au lieu de l’accumuler.

Le ragdoll reste réservé aux signaux maladroits : vitesse qui ne correspond plus à l’input, recul/dérive vers le vide sans regarder, déplacement tangent très proche avec perte de contrôle, manual lean prononcé au-dessus du vide, ou chute réelle déjà engagée sans fenêtre de contrôle. Le passage en chute immédiate attend désormais ~0,28 m de drop au lieu d’un franchissement quasi instantané.

Le hand-off physique et les dégâts restent identiques : vitesse gameplay héritée + petite impulsion inward/down, dégâts basés sur la perte d’altitude du bassin, et survivant laissé au sol en attendant le futur système de relevé.


### Ragdoll réactif v49

`src/physics/ActiveRagdollMotion.ts` et la phase `applyActiveFallReactions()` de `RagdollSystem.ts` sont conçus pour rester indépendants de l'éclairage et du level. Le système exploite seulement la vitesse gameplay et `RagdollAnimationMotion` capturé sur les deux dernières poses rendues. Il peut donc être intégré au ragdoll du repo principal sans ajouter de raycast ni de render pass. La réaction active dure au maximum 1,48 s, puis tous les corps redeviennent entièrement passifs.

## v51 integration notes

The damage pass uses `src/dev/DamageSystem.ts` and `src/dev/BloodDecalSystem.ts`. Ragdoll HP now changes on each significant physical impact event inside the fixed physics tick; there is no global "strongest impact then delayed damage" gate. A fatal-height pit fall is marked dead on the first meaningful floor/step impact rather than after `isSettled`. The old settled calculation remains only as telemetry-loss fallback.

Injury vision is still CSS-only and cheap, but death now adds contrast/exposure collapse plus a dark tunnel-vision veil instead of plain grayscale. Screen blood is dark/multiply-blended. Surface blood uses a pool of at most 24 textured planes and small satellite droplets. The predev/prebuild asset fetcher uses CC0 OpenGameArt decal textures; offline fallback is procedural and deliberately dark.

For production Backrooms, reuse the same `DamageSystem` curves and adapt `BloodDecalSystem.spawn()` to the production static-world/object surface lookup. Keep stair/jump control grace before enabling edge-stumble ragdolls on streamed geometry.


## v54 — ragdoll final settling

Les équilibres finaux sur un seul membre ou les jambes accrochées au-dessus du corps sont relâchés uniquement après la phase active. Le core reste la masse dominante, les membres perdent temporairement du grip lorsqu’ils soutiennent une posture suspendue, et le solver reste dynamique jusqu’à un vrai repos.


## v55 — natural head / leg final relaxation

`RagdollSystem` now runs a short calm-only final relaxation after the active fall response. The head is allowed to sag under extra gravity / reduced angular damping for a brief window, while only extreme fore/aft thigh scissors receive a small hip-closure bias and temporary friction reduction. Any renewed impact cancels the pass. Keep this logic after the v54 support-release pass so stair/limb hang release remains higher priority.


## v58 — impact blood burst

`BloodDecalSystem.spawnBurst()` regroupe plusieurs decals sur la surface d'impact pour les morts par chute/choc, avec variation aléatoire et pool FIFO de 48. `AnimationLab.updateHealth()` neutralise entièrement le grading écran quand `health <= 0` en 3P, tout en gardant la présentation de mort complète en 1P.


## v59 — textured pit floors / more blood

Les fonds de tous les puits utilisent maintenant la vraie moquette Backrooms (color/normal/ARM) au lieu d’un matériau noir. Les impacts mortels, surtout les chutes, produisent aussi des bursts de sang plus denses et plus aléatoires : plusieurs taches dominantes, davantage de gouttelettes, dispersion élargie et pool borné à 72 decals.


## v63 — hard controlled landing animation

Controlled jumps/falls that hurt but do not ragdoll can now use `hard-landing.fbx` as their authored landing recovery. Ordinary small jumps still use the normal landing/fall return, and lethal/severe impacts still use the heavy impact pipeline. If the optional file is missing during development, the lab falls back to `falling-to-landing.fbx` instead of failing startup.


NOTE: the uploaded Hard Landing FBX could not be accessed by the archive builder in this environment. The code is wired for `public/assets/animation-lab/hard-landing.fbx`; drop the uploaded file there with that lowercase name to enable the clip.

## v64 — Get-up integration

After a non-fatal ragdoll has physically settled, the standard Backrooms interaction prompt appears: E — Se relever (or the remapped interact key). The prompt matches the production HUD's cream/dark styling and is hidden during death, animation recovery, and when input is unlocked.

The two supplied animations, `stand-up-back.fbx` and `stand-up-belly.fbx`, are bundled. The physical torso orientation chooses the correct clip. A short pose crossfade transfers the exact ragdoll posture into the authored get-up; the full animation plays with no automatic respawn and no health reset. A supported and unobstructed standing capsule is required before the recovery begins and checked again before the live controller is restored. The temporary ragdoll is removed instead of becoming a persistent corpse. The existing death/respawn and blood systems remain separate.

The lab's presentation uses the same `interaction-prompt` markup as `src/ui/ExperienceUI.ts` from the main Backrooms repository. Integration should reuse that production HUD component and route the existing `interact` binding into the recovery request. The recovery physics and animation logic is self-contained in `GetUpRecovery.ts`, `GetUpRecoveryRules.ts`, and the shared physics wrapper.


## v65 — Combat integration

Combat mode uses the supplied `fight-idle.fbx` as the guarded upper-body pose. While guarded and moving, only Hips/leg tracks come from the classic `walking`, `left-strafe-walking` and `right-strafe-walking` clips; backward movement reverses Walking. The Fight Idle upper-body layer remains active, so fists/guard stay up in both 1P and 3P.

RMB behavior: 1P guard follows the held button directly. In 3P, a click keeps guard for ~5 s while stationary; moving after release cancels it immediately. Holding RMB keeps guard and disables sprint. Future enemy hits should call `receiveCombatHit(amount)` (or `notifyCombatHit()` if damage is already applied); this gives a 5 s defensive guard in 3P only.

Entry/exit uses the supplied Standing Idle ↔ Fight Idle and Action Idle ↔ Fight Idle transition clips according to the idle family that was active before combat.


## v66 — combat guard torso alignment

While combat guard is active and the player moves, classic Walking/Strafe clips still own the pelvis and legs. Their large authored pelvis yaw is now countered only in the upper spine chain so the Fight Idle hands, chest and head remain aimed with the guard instead of being carried sideways. The correction is distributed over Spine/Spine1/Spine2 and is shared by the third-person and first-person rigs. Stationary Fight Idle remains unchanged.


## v67 — melee integration

The lab now contains an end-to-end local melee reference implementation. Preserve the existing v65/v66 guard layers and add `CombatMeleeRules.ts` as the deterministic attack/counter rule source. Short LMB = normal punch; held LMB >= 0.42 s = big punch. Hooks must stay counter-only and must be driven by a real enemy threat window, not by raw double-click alone. The included `CombatCounterTapDetector` requires quiet-before-first, exactly two taps, a post-second anti-spam confirmation gap, and lockout on a third rapid click.

For production enemies/network players, route incoming normal/big attacks through `receiveMeleeAttack(kind, direction, overrideDamage?)`. `receiveCombatHit(amount)` remains a normal-punch compatibility wrapper. A second hit during an active reaction is a guaranteed ragdoll handoff; otherwise the attack profile uses 20% knockdown for normal punches and 50% for big punches. After a surviving 3P reaction, call the existing hit-latched guard flow; do not auto-latch 1P.

The lab NPC is intentionally only a short-range reference AI, not a production navmesh agent. It pursues only on direct clear line-of-sight and rejects candidate steps inside pit footprints. Its combat state demonstrates attack telegraph/counter timing, HP, hit reactions, repeated-hit ragdoll, and reset behavior. Production AI should replace only pursuit/target selection while preserving the same combat event timing contracts.


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


## v70 — combat attack integration

Short LMB attacks now draw from all four newly supplied regular Punch FBXs through a randomized shuffle bag. Long LMB attacks (0.42 s+) draw only from the two newly supplied authored Big Punch FBXs. The same pools are available to the test NPC. The newly supplied three Hooks replace the previous copies and stay counter-only.

A committed strike is aimed from the player's actual horizontal look yaw, not from delayed body facing. Visual body yaw, melee reach testing and hit/knockback direction use the same aim source. Strike torso tracks are Fight-Idle-rebased with their large authored sideways twist suppressed, and a final Hips+Spine correction removes the residual Fight-Idle blade during attacks.

For first person, combat is presentation-only: the render rig follows POV yaw while guard/attacks are visible, receives full Fight-Idle Hips+Spine neutralization and stronger fist midpoint centering. The gameplay camera remains fixed.

## v73 combat animation integration note

Treat Fight Idle as the canonical combat-space reference. Do not correct attack torso yaw toward ordinary Idle. Capture the currently evaluated Fight Idle spine chain before beginning a strike, keep that torso center during the upper-body strike, and keep the guard action advancing at zero weight so it can fade back at its current phase. Guard and attack roots should use the same current look yaw; this avoids a root snap on attack start.


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

## v78 integration note — first-person guard pitch/framing

Keep `PlayerController.setCombatGuardLookConstraint()` tied only to live first-person guard/attack state. It sets `PointerLockControls.maxPolarAngle` so the player cannot pitch all the way down into the combat viewmodel, and restores the default `Math.PI` bound outside guard. Third person, ragdoll and get-up must explicitly clear this constraint. The dedicated 1P render rig uses `0.08 m` combat forward offset, `-0.105 m` vertical offset, `0.97` arm scale and `0.96` hand scale; do not move the gameplay camera to reproduce this framing.


## v79 integration note — exact Heavy input and guard locomotion

Current Heavy input supersedes the older hold-to-charge behavior: outside an enemy counter window, a clean exact LMB double-click confirms Big Punch. The first click may begin a normal arm-only wind-up; the second arms the Heavy and the runtime crossfades that additive wind-up into a real Big Punch. A third rapid click cancels the Heavy and remains normal-punch spam. Inside a valid hostile counter window, exact double-click continues to mean Hook counter and has priority.

Keep guard movement physics at `0.84` of ordinary walk speed and read raw sprint intent separately from sprint suppression. Forward sprint intent must make guard persistence false, restore normal movement scale, and blend out guard before normal sprint takes over. Do not play a full-body Idle→Fight transition while the player is already moving: locomotion must own Hips/legs immediately. Backward movement needs its own reverse `AnimationAction`, and Fight Idle lower-body playback must re-enter synchronized to the upper Fight Idle phase to avoid the 1P stop snap.


## v80 — diagonal locomotion + combat transition pass

- Heavy Punch remains **exact double-click only**. Single/long/spam clicks stay in the normal Punch pool; a third rapid click cancels a pending Heavy.
- Moving while `Idle → Fight Idle` is playing immediately hands Hips/legs to locomotion while the guard upper body blends in, preventing the stationary-transition skating effect.
- Guard locomotion uses 84% walk speed; forward sprint intent exits guard through the existing blend instead of waiting for the 5 s latch. Backward/strafe/Fight Idle lower-body changes keep the v79 crossfades and Fight Idle phase synchronization, so 1P hands do not teleport on stop.
- Added four runtime-generated diagonal locomotion clips: **walk forward-left/right** and **run forward-left/right**. They are synthesized once at load from the authored forward and strafe clips: legs/Hips receive the stronger lateral contribution while the torso stays forward-biased.
- In guard, the generated walk diagonals are used only by the lower-body layer; Fight Idle continues to own the guard upper body. Outside guard, the full generated diagonal walk/run clips are used. Pure Q/D strafing and backward diagonals keep their existing animations.
- Normal locomotion crossfades through diagonal states over 0.22 s rather than switching directly between pure forward and pure strafe.

## v81 integration note

For living ragdoll recovery, call `RagdollSystem.suspendForRecovery()` before handing the corpse skeleton to `GetUpRecovery`; do not call `dispose()` at that point. This avoids the Rapier/Vite attached-joint body-removal crash observed during the `E` get-up path. The disabled recovery rig is inert and is reclaimed with the Rapier world. `RagdollSystem.dispose()` uses the same safe disable path so NPC/reset teardown cannot hit the same callback.



### v82 — relevé E fiable

Le relevé vivant réserve maintenant la position debout validée avant de lancer l'animation dos/ventre. Un appui sur la touche d'interaction reste mémorisé jusqu'à ce que le corps soit stabilisé et qu'une capsule debout soit disponible, au lieu d'être perdu sur une seule frame. Les knockdowns de combat disposent aussi d'un fallback borné vers la dernière capsule debout valide, sans permettre de téléporter un joueur hors d'un trou profond.

## v83 integration note — defensive guard, Ctrl counter, POV framing and yaw rebasing

Treat `combatDefensiveGuardActive()` as the offense gate: RMB-held/manual guard and post-hit guard block ordinary Punch/Big Punch. Do not key this from `combatPhase === 'guard'` alone, because the attack system intentionally keeps a transient Fight Idle base under an active punch so the second clean click can still upgrade a non-guard attack to Heavy.

Hook input is now **Ctrl + LMB during `npcCounterWindowIsOpen()`**. Ctrl+LMB outside the threat window must remain a consumed no-op; it must never fall through to the normal/heavy detector. The successful counter cancels the pending NPC attack before damage and then plays the existing unblockable Hook strike.

Use `ForwardLateralAnimationGate` only for animation selection, not movement physics. It deliberately passes through straight Walking during rapid forward Q/D reversals and requires a short stable side before entering a diagonal. For repeated 360° turns, keep `continuousViewYaw` authoritative, use `rebaseAngleNear()` only to choose the nearest 2π-equivalent body angle, and inherit the live mouse delta after the body-follow gate commits.

First-person combat framing must continue to move only `firstPersonAvatarAnchor`. The current solver targets the actual two-hand midpoint around 0.46 m forward and 0.115 m below the eye with bounded offsets; **never apply those offsets to `firstPersonCamera`**.

## v84 integration note — first-person guard framing and fall handoff

Keep the combat presentation on `firstPersonAvatarAnchor`; never move the gameplay camera. The current framing solves from both hands but uses the **nearest hand depth** as the safety constraint, so a bladed Fight Idle cannot leave one fist on the near plane. When lower-body combat state crosses between locomotion and Fight Idle, hold the current framing solution for the lower-body crossfade and then ease back to the solved target.

Do not restore the removed `falling` (Fall High) or `hard-landing` animation path. Small drops retain `falling-idle → falling-to-landing`. Once the former high-fall threshold is crossed, call the non-fatal `startRagdoll` path and let ragdoll impact damage decide whether the player survives. Medium/heavy grounded landings that previously selected Hard Landing also use the living ragdoll handoff.
