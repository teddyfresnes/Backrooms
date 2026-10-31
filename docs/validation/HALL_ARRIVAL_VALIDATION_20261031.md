# Hall arrival, voices and cinematic audio

Initial implementation: `f7cab6cb7f25b0e80dad61b9abc02de99b82e233` on `codex/vertical-topology-20261020`, followed by the audio-only asset validation in this revision.

## Result

The entrance mailbox cabinet moves from the east wall to the facing west wall. Its four original leaves remain separate. Only `Door_3` is the player's compartment: approaching the first stairs displays “Mon courrier… Je dois le récupérer avant de monter.” and plays Miscellaneous 2 (Hmm) in the chosen voice. A pale outline identifies that leaf. The existing configurable interaction prompt displays “Récupérer le courrier”; a valid interaction opens the original hinge outward, removes the letter and displays “Il est temps de rentrer chez moi. Au dernier étage.” with Miscellaneous 19 (Gasping). Captions type silently, pause with gameplay, then disappear.

The cabinet has a static collider. Its moving hierarchy is excluded from static mesh batching. Ray tests require the correct leaf, foreground play, the ground-floor hall and a distance of at most 2.6 m; another part of the cabinet can occlude it. Retrieving twice is prevented. The objective is saved through the optional `arrivalState`; old saves without that field skip the new objective, while collected mail stays collected and its leaf restores open.

Garde-robe → Modifier → Général offers Alex Brodie, Ian Lampert, Sean Lenhart, Karen Cenon and Meghan Christian, with separate voice/breath previews. Selection persists with the character profile without changing body/face references. The two reactions per actor are loaded and cached, respect master volume, and stop on pause, visibility loss, preview cancellation or runtime disposal. CC BY 4.0 credit goes to Dillon Becker in the asset catalogue and voice selector.

The photographic prologue keeps only the images, captions and skip control during normal playback. The supplied “its ok, we can make new memories” recording plays underneath, pauses in background tabs and fades at the handoff. The typing sound uses softer filtered noise, a rounded attack, lower gain and fewer ticks. Scene preparation continues in parallel; an already prepared 3D scene does not keep rendering underneath the film.

## Loading and preservation

`apartment.worker.ts` fetches, decompresses and parses the large apartment JSON, then transfers typed geometry arrays. `LoadApartmentScene` creates geometries in batches with a 3 ms cooperative budget and preserves the original Three.js material, transform and door hierarchy. Cancellation terminates the worker and releases a cancelled mount. The main repository's raw JSON URL and the hosted split-gzip URL both work.

The full source check used all **349,270,200 bytes**, SHA-256 `1b1864ff763676e6fa4bc0b66e0ae2d854a7bf9ef3e61990d2c9f6fce7067dda`: 267 geometries, 56 images, 1,287 transferred buffers totalling 72,719,584 bytes. The object hierarchy hash remains identical. In an isolated Node worker run, decoding took 2,362.78 ms in the worker and conversion took 104.05 ms; the parent heartbeat continued with a maximum observed gap of 13.13 ms. These are a CPU proxy, not browser frame-rate or GPU measurements. Individual geometry parsing, scene mounting, Rapier and GPU compilation still contain indivisible main-thread work.

The procedural world, its old structures/pitfalls, lighting and character physics are unchanged. The hosted character and apartment asset optimizations are retained. The actor pack and original music uploads remain untouched; only eleven runtime audio files are added, totalling **485,513 bytes**. All original/source and runtime hashes are in `arrival-audio-assets.json`. Runtime vocalizations explicitly exclude the artwork/video stream embedded in the source WAV containers.

## Checks

- Main checkout: **122/122 tests**, 21 files; TypeScript project build and whitespace checks passed. Coverage includes the actual mailbox GLB geometry/hinge, occlusion/range/pause, one-time retrieval, all save stages and old saves, silent caption timing, voice selection/persistence/cancellation/mute, soundtrack lifecycle, Opus stream structure, worker transfers and cancellation, routing and existing stairwell physics.
- Hosted checkout: **61/61 tests**, 13 files, including its optimized loader contracts. The production build and hosting integrity checks pass; the deployment record contains final output sizes and source provenance.
- Eleven files were inspected with ffprobe and fully decoded with ffmpeg: exactly one Opus audio stream each, ten mono reactions and the stereo music (83.6065 s including codec padding).
- The full main asset build was not run in the sparse checkout; the complete hosted production build was run.

The managed preview daemon is unavailable (`/tmp/sites-previewd/requests` missing). In-browser WebGL playback, subjective listening/mixing and actual frame pacing could not be verified here. Automated tests and the Node worker profile do not establish those results. See `deployment-v24.json` for the publication outcome.

## Publication

Version 24 is live at https://backrooms-integre.teddykoeh.chatgpt.site, built from pushed Site source `0b0e77459408b05a19c0b2528df1e58ea39542bd`. The final implementation in the GitHub branch is `8720a7512b1520c2eda43252ba06d333b1849fcc`. Twenty runtime files match byte-for-byte between the checkouts; the hosted apartment keeps its split-gzip URL and the hosted loader tests retain their existing adaptations. All eleven hosted audio hashes match the manifest.

The final static output has 3,097 files and 265,147,422 bytes. The published tar has 3,098 files (including its hosting manifest), 267,960,320 bytes and hash `sha256:d2630529400212ce8f060de3f681887a9f2f21f687ca4a0956b4cb93c588399c`, below the project's 256 MiB tar budget. The local packager stopped because staged files changed while tar read them; no local archive was saved. The service rebuilt the same immutable pushed source and publication succeeded. The existing custom audience was preserved.
