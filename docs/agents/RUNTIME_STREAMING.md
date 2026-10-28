# Streaming et buffers

`WorldStream` maintient les chunks actifs, les `WorldView` et les colliders
associés. Le voisinage de base est un 3×3 autour du propriétaire du support.
Les dépendances spatiales et la trajectoire ajoutent au plus 12 propriétaires. `SpatialVisibility`
priorise les supports proches, puis les ouvertures dans la direction du regard
(36 m structurels, 72 m pour les vues, marge verticale de 20 m). Le voisinage
de base est exclu de ce budget supplémentaire. Elles préchargent les niveaux visibles et
les réceptions avant le franchissement. `supportedCoordAt` cherche d’abord un
sol réel, puis le volume libre courant ; l’inverse régional ne sert qu’en repli.
Les anciens aperçus ci-dessous concernent les monuments et le chemin legacy.

- Au démarrage, jusqu’à trois workers temporaires préparent les voisins.
- Ensuite, un worker persistant génère un chunk à la fois.
- Sa réponse alimente un cache CPU de 12 plans, sans montage dans le callback.
  Le runtime monte au plus une vue prête par frame. Les plans et données de
  lumière récemment démontés rejoignent ce cache ; leurs ressources GPU sont libérées.
- Les owners hors de la story active ou à au moins 20 m du joueur utilisent
  `WorldView.architectureOnly` :
  architecture, matériaux, lumière, luminaires, portes et collisions réels.
  Les props, graffitis et dommages de plafond attendent l’approche. `promoteDetails`
  les ajoute sans recréer les géométries structurelles ni les textures lumineuses.
- La sélection des dépendances est réutilisée dans une marge de 1,5 m / environ
  12° ; une mutation de montage ou un changement de centre l’invalide.
- Les destinations verticales sont préchargées près des puits et escaliers.
  `FallPrefetch` utilise la vitesse physique du bassin pour anticiper jusqu'à
  trois propriétaires sur 0,6 s ; ils entrent dans ce même budget de 12.
  La file d'attente reste bornée à huit demandes, prioritaires en chute.
  Les volées ouvertes ajoutent aussi une dépendance de vue vers le propriétaire
  inférieur et, si percées, vers la vraie dalle supérieure. Aucun sol factice.
- Les volumes hauts de `epic2`, `epic3`, `epic4` et `epic5` épinglent leur
  story source au lieu de remonter tous les 5,4 m. Le runtime source est résolu
  depuis la position du joueur, y compris juste après une téléportation haute.
- `epic3` dépasse son chunk propriétaire sur l’axe longitudinal. Tant que le
  joueur est dans son volume, le streamer garde ce propriétaire comme centre et
  exclut ses voisins en x, dont les murs ordinaires couperaient la faille.
- `epic1` n’est jamais épinglé : seule la story immédiatement inférieure est
  préchargée en priorité à l’approche du gouffre. Chaque story montée prépare la
  suivante, sans rafale de trois générations, puis utilise le même hand-off à
  mi-hauteur que les pits.
  Au démontage, le dernier palier sûr conserve seulement son plan CPU ; le
  callback de chute le remonte immédiatement, sans régénération ni
  superposition des aperçus verticaux.
- Une transition d’étage est différée tant que le chunk cible n’est pas prêt.
- Sans `Worker`, un fallback synchrone reste disponible.

Le worker (`src/world/infinite.worker.ts`) calcule le `WorldPlan` sérialisable et
les `SpatialArchitectureBuffers` séparés : positions, normales, UV, couleurs,
boîtes et sphères de culling. Ces tableaux sont transférés puis conservés dans
le cache CPU borné. Le montage réutilise leurs buffers sans clipping, calcul de
normales ou bake 2D inutilisé sur le thread du jeu. Une nouvelle géométrie GPU
reste détenue par chaque vue ; sa destruction ne détruit pas les tableaux CPU.
`WorldStream.mountChunk()` crée les matériaux zonaux puis applique l’offset monde
au groupe Three.js, au contexte shader et au lot de colliders. Le démontage doit
retirer les ressources visuelles et physiques, dont les deux textures de lumière
régionale. `buildSpatialArchitecture` consomme uniquement les surfaces/prismes
communs et écrit directement les buffers par matériau, sans géométrie GPU
intermédiaire pour chaque fragment ; aucune dalle historique n’est rajoutée à zéro. Le mode moderne sélectionne le champ fluorescent historique par volume dans
`RegionalLighting`, sans multiplier une seconde fois l’exposition. Les buffers
CPU sont calculés et transférés par `infinite.worker`, puis montés avec le chunk.
Le mode classique conserve son bake, avec filtrage vertical des contributions.
Les UV partagent une origine monde et les quatre chunks d’un BSP conservent
les mêmes motifs. Les chants enfouis sont éliminés par `SurfaceExposure`.
`FaceExposure` traite ensemble sols, plafonds et prismes avant la séparation en
matériaux. Il soustrait les polygones coplanaires superposés, y compris les
joues trapézoïdales et pentes, et retire les interfaces internes opposées.
`PrismExposure` conserve ce même traitement pour les appels limités aux murs.
Un index 2D par plan borne les candidats ; les UV gardent leur origine monde.
`CeilingFixture` aligne les diffuseurs sur le profil du toit et place leurs
coins sous sa vraie sous-face ; un luminaire ne traverse pas un plafond incliné.
Ces méthodes restent des approximations, pas un calcul d’ombres 3D.
`/geometry uv|volumes|off` active un diagnostic temporaire, libéré au démontage.
Les sauvegardes reprojettent dans le propriétaire enregistré : voir le contrat
vertical pour la migration des ancrages et le repli sûr.

`/locate epic1`, `/locate epic2`, `/locate epic3`, `/locate epic4` et
`/locate epic5` résout analytiquement l’occurrence la plus proche, même hors du
voisinage monté. Un worker auxiliaire prépare le plan hors du thread principal ;
le chunk central, sa vue et ses colliders sont ensuite montés
avant la téléportation. Pour `epic1`, le voisin nord visible depuis le point
d’arrivée est monté dans le même warmup ; les autres voisins rejoignent le flux
normal du streamer.
Pour `epic3`, seuls les voisins nord et sud restent montés pendant la visite.

Retour au [routeur runtime](RUNTIME_RENDERING.md).
