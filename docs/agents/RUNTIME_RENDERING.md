# Runtime, rendu et physique

Le contrat commun des sols, couches et migrations est décrit dans
[VERTICAL_TOPOLOGY.md](../VERTICAL_TOPOLOGY.md).

## Lire seulement le sujet concerné

| Sujet | Guide |
|---|---|
| Streaming, préfetch, workers, buffers transférables et propriétaires | [Streaming](RUNTIME_STREAMING.md) |
| Géométrie, matériaux, coutures, z-fighting et règles des anciennes structures | [Construction visuelle](RENDER_GEOMETRY.md) |
| Fluorescence, atlas régionaux, blackouts, qualité et warmup GPU | [Lumière](RENDER_LIGHTING.md) |
| Rapier, contrôleur, ragdoll, portes et assets | [Physique et assets](PHYSICS_ASSETS.md) |

## Diagnostic rapide

| Symptôme | Vérifier d’abord |
|---|---|
| Objet décalé dans les chunks voisins | offset appliqué deux fois ou coordonnées non locales |
| Collision fantôme après déplacement | `unmountChunk()` / propriété du collider |
| Trou noir ou face manquante vue d’en dessous | caps, normales et matériau du puits/plafond |
| Halo ou couture lumineuse | sélection par texel, bordures de `RegionalLighting` et origine monde |
| Stutter à l’approche d’un étage | préfetch, `SpatialArchitectureBuffers` worker et cache CPU |
| Mémoire qui monte en explorant | `dispose()` du `WorldView`, des props et matériaux clonés |
| Prop dans un mur/trou | ordre de `populateRareProps()` et empreinte de placement |

## Tests associés

- rendu architectural : `src/render/WorldBuilder.test.ts`
- coutures sol/mur/plafond : `src/render/ArchitectureSeams.test.ts`
- transferts géométriques : `src/render/SpatialArchitectureBuffers.test.ts`
- lumière régionale : `src/render/RegionalLighting.test.ts`
- lumière zonale : `src/render/ZonalLighting.test.ts`
- lumière classique : `src/render/BakedLighting.test.ts`
- graffiti : `src/render/WallGraffiti.test.ts`
- streaming : `src/core/WorldStream.test.ts`
- physique : `src/physics/PhysicsWorld.test.ts`
- déplacement : `src/player/PlayerController.test.ts`

Voir `docs/agents/VERIFICATION.md` avant de lancer plusieurs suites lourdes.
