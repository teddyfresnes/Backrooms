# New game cinematic — 2026-10-31

Feature source: `21237f8a761332224c5faa2f539f9a932ccc1815` on `codex/vertical-topology-20261020`.

New games play the six user-provided shots in narrative order: office, paperwork, 00:30 monitor, office exit, rainy street, apartment entrance. Each exact requested French sentence appears progressively below its image, with a quiet mechanical typing sound. Slow pan/zoom, crossfades, grain and vignette preserve the supplied composition. The six full-resolution 1672×941 WebP frames total 454,748 bytes; the source/runtime hashes and captions are in `new-game-intro-assets.json`.

Scene preparation runs during the cinematic. Once both are ready, the film fades automatically into the hall entrance, facing the stairs. Skip waits safely for scene readiness. Loading an existing save bypasses the cinematic and restores its saved state. Hidden tabs pause the film; reduced motion shows full captions without pan/zoom or typing ticks. Abort, retry and disposal clear pending image work, animation frames, input handlers and active typing sounds. The warmed 3D scene does not keep simulating underneath the film.

## Verification

- Main checkout: 13 focused Vitest files, **98/98 tests passed**, zero unhandled errors. Coverage includes exact assets/captions, progressive text and sound, automatic handoff, input isolation, visibility, reduced motion, retry/cleanup, real main-module routing, saved games, scene warmup, player input and Rapier collision/walking from the new spawn.
- Main checkout: TypeScript project build (`tsc -b`) and `git diff --check` passed. A complete main-checkout asset build was not run because that checkout is sparse.
- Hosted checkout: 5 focused Vitest files, **21/21 tests passed**; supported production build passed. The hosted build includes its existing optimized asset loaders.
- Hosted output: 3,081 files, **264,648,003 bytes**; entry assets, music, 72 animations, 10 emotes, 148 wardrobe objects and 148 clothing files verified. Apartment decompression still reproduces all 349,270,200 original bytes and its original SHA-256. The static budget is 253 MiB; the hosting verifier also accepts `--archive` to check an expanded tar against 256 MiB.
- A temporary partial mailbox download was excluded from build output, alongside existing partial apartment copies. The actual GLB remains unchanged.

The managed preview service was unavailable (`/tmp/sites-previewd/requests` missing). Browser/WebGL playback, perceived transition quality and listening checks could not be performed in this environment; automated DOM/audio mocks, physical spawn tests and the production build do not replace those checks.

Local packaging could not complete: after repairing a missing temporary directory with a workspace-local `TMPDIR`, two attempts stopped because staged files changed while tar was reading them. No local archive was saved, and the optional local `--archive` check was therefore not run. Publication uses the service's source-build fallback for the exact pushed Site source `599378b3945e9d49d7d3bef9d39e86dd40939381`. Final publication metadata is recorded separately in `deployment-v23.json`.

Version 23 was published successfully at https://backrooms-integre.teddykoeh.chatgpt.site. The service reports a 267,448,320-byte tar archive containing 3,082 files, including its hosting manifest; this is below the 268,435,456-byte archive limit. The saved version confirms the exact source commit above. Twelve runtime/image files were compared byte-for-byte between the main and hosted checkouts and match.

## Mailboxes

The entrance mailboxes are currently static in the game. Their GLB contains separate `Door_1_Bent`, `Door_2`, `Door_3` and `Door_4_Bent` nodes, so their doors can be animated individually. No baked animations are present, and this change does not add mailbox interaction or animation.
