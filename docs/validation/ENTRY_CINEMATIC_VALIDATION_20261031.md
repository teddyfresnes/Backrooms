# Photographic prologue and animated entrance

## Result and loading boundary

New games play the six existing photographs and captions, then wait under a small rotating indicator and real scene progress if preparation remains. Only apartment fetch/decompression/JSON conversion runs in a worker during the photographs. The worker holds its large typed arrays until the runtime requests them. Importing the stairwell runtime, constructing Three/Rapier objects, mounting the wardrobe avatar and compiling shaders happen after the photograph sequence. This removes the identified competing main-thread work from that sequence. Photo zoom/fades use owned Web Animations; typing no longer writes their transforms or opacity every frame. Visibility changes pause both clocks.

Once warmup and audio loading finish, the chosen wardrobe character enters the code in a close dolly shot, then opens the real entrance door and enters in a second shot. The code keypad is positioned using the authored left-hand finger. Only the moving right-hand door pieces are reparented to a hinge; the frame and other leaf remain in place. The existing player and physics stay frozen at the safe interior endpoint during playback. The final camera blends for 0.95 s into the exact CharacterRuntime first-person position, quaternion and field of view, then releases input and permits the first autosave. Escape/Enter/Space and the skip button use the same safe handoff. Saved games restore directly without this sequence.

The supplied music loops through photographs, loading and both 3D shots. Ownership transfers from the photo overlay to the stairwell runtime. It fades only during the POV blend. Cancellation/disposal stops it and releases workers, mixers, private materials and presentation rigs. Cinematic pose sampling uses the host renderer and frame loop; no second renderer or physics world is introduced. Mailbox progression, silent captions, voices, the procedural world and its pitfalls remain on their existing paths.

## Supplied animation data

`scripts/pack-entry-animations.mjs` extracts animation tracks from the two supplied FBX files without retaining source meshes/textures. Float32 animation data retains its original precision; redundant keys are optimized and arrays are gzip-packed. Retargeting adapts the hips scale to the chosen avatar, retaining authored horizontal movement separately from the bone pose. Original uploads are untouched.

| Source | Full duration | Tracks |
| --- | ---: | ---: |
| Entering Code.fbx | 7.5 s | 53 |
| Opening Door Inwards.fbx | 6.366666793823242 s | 53 |

The runtime pack is 303,095 bytes, SHA-256 `18e324cc51ab5285d30baeb24ca051af995e9f039f54ad220d28ab409aa822f5`. Source hashes and encoding are recorded in `entry-animation-assets.json`; the asset catalogue identifies the user-supplied animations.

## Verification

- Main targeted suite: **128/128 tests in 23 files passed**, including routing, compositor animation ownership, late loading, soundtrack transfer, worker hold/release/error/abort, real entrance geometry and the new camera handoff.
- The actual wardrobe avatar integration passed using the supplied clips and real entrance GLB geometry. It checks the safe interior endpoint, hidden live presentation rigs, full source timing, no early audio fade or input release, exact final POV and restoration of the first-person body.
- Main TypeScript project build passed. Hosted production build, lossless apartment reconstruction and the 148 clothing/148 OBJ verification passed. The hosted apartment retains its split-gzip URL and the hosted CharacterAssetLoader retains its optimized motion pack.
- Full character regression results and publication provenance are recorded below when completed.

The managed preview service is unavailable (`/tmp/sites-previewd/requests` missing). Actual browser frame pacing, WebGL appearance and subjective audio mixing have not been measured here. Automated CPU/geometry/lifecycle checks establish the new scheduling and handoff contracts, not a measured FPS or a guarantee of zero stalls on every device. The complete hosted build was checked; the sparse main checkout does not contain every source pack needed by the full asset build.

This supersedes the parallel scene-construction description in `HALL_ARRIVAL_VALIDATION_20261031.md`; its mailbox, voice and original asset provenance remain applicable.
