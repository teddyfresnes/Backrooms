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
- Main TypeScript project build passed; the final routing/photo rerun passed 9/9 after error cleanup was tightened. The hosted suite passed **59/59 in 14 files**, including the optimized loader contract. Hosted production build, lossless apartment reconstruction and the 148 clothing/148 OBJ verification passed. The hosted apartment retains its split-gzip URL and the hosted CharacterAssetLoader retains its optimized motion pack. The 303,095-byte entry motion pack matches its source manifest.
- Full character regression exercised **651 cases**: 649 passed in the first run; the two hip-hop trajectory cases stopped on a missing local JSON fixture in the sparse checkout. After restoring that unchanged fixture, both passed on a targeted rerun. There are no unresolved character test failures. The separate real wardrobe entrance integration also passed. This is a combined result, not a claim that the initial full run was green.

The managed preview service is unavailable (`/tmp/sites-previewd/requests` missing). Actual browser frame pacing, WebGL appearance and subjective audio mixing have not been measured here. Automated CPU/geometry/lifecycle checks establish the new scheduling and handoff contracts, not a measured FPS or a guarantee of zero stalls on every device. The complete hosted build was checked; the sparse main checkout does not contain every source pack needed by the full asset build.

This supersedes the parallel scene-construction description in `HALL_ARRIVAL_VALIDATION_20261031.md`; its mailbox, voice and original asset provenance remain applicable.

## Hosting budget recovery

The first remote publication (version 25, source `9fd2724beb7660809bbb574191e48269d3b1eeb2`) failed its 256 MiB expanded archive limit. The previous version remained live. Two existing repository PNGs now have hosted WebP lossless variants: `blood/blood-decal-a` and `mpfb/textures/sss`. The original files remain in source; only their proven redundant copies are omitted from the hosted output. The hosted decal loader references the WebP. RGBA pixels, transparent RGB and dimensions are identical after decoding, and original credits remain. This saves **1,519,428 bytes**. `hosting-lossless-textures.json` records encoded hashes, decoded RGBA hashes and dimensions. The hosted integrity guard checks these files and the 253 MiB static budget before packaging. The main repository retains its original PNG paths.

Version 26 then caught a missing hosted blood WebP during remote finalization: its source directory was ignored by Git, although local verification had the file. That variant is now explicitly included and hashed in the source index alongside the other new runtime binaries. Hosting budget, packed motion, texture hashes and wardrobe checks also run in `postbuild`, so the same validations apply on the remote builder. The 59 hosted tests passed again after the format adaptation.

The stricter local budget check also exposed a 3,670,016-byte temporary MHCLO copy in the build output. Finalization now removes random-suffixed copies only when their base filename exactly matches a known catalogue source/runtime filename. The 296 original wardrobe source URLs were checked; no source file needed deletion. Final output and all integrity checks passed after this correction.

Final local static output: **3,099 files, 263,947,960 bytes**. Fourteen shared runtime files, including the cinematic, loader scheduling and source motion pack, match byte-for-byte between the main and hosted checkouts. Hosted-only loader/URL/texture adaptations remain explicit. The final publication outcome, immutable source SHA and expanded archive provenance are recorded in `deployment-v27.json`, together with the two failed attempts.
