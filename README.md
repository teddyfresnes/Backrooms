# THRESHOLD ZERO — Backrooms Level 0

Une vertical slice jouable sur navigateur consacrée à l’atmosphère du Level 0 : plan procédural déterministe, matériaux PBR locaux, faux plafonds irréguliers, néons instanciés, audio réactif et déplacement FPS avec vraies collisions.

Il n’y a volontairement ni monstre ni objectif pour l’instant. Cette version sert de fondation esthétique et technique.

## Lancer

Prérequis : Node.js 22.12 ou plus récent.

```powershell
npm install
npm run dev
```

Puis ouvrir `http://127.0.0.1:4173/`.

```powershell
npm test        # 158 assertions génératives/physiques
npm run build   # type-check + build production
npm run validate
```

## Commandes

- `ZQSD` ou `WASD` : marcher
- `Maj` : accélérer
- `Ctrl` : s’accroupir
- `E` : traverser les passages exigus interactifs
- `C` : ouvrir le chat
- `H` : ouvrir la console avec `/` déjà prêt
- `/locate` puis `Tab` : autocompléter une anomalie chargée, puis `Entrée` pour s'y téléporter
- souris : regarder
- `Échap` : libérer la souris / pause

Le seed se trouve dans l’URL : `?seed=AMBER-HALL-0417`. Un même seed et une même version de générateur produisent exactement le même plan.

## Ce qui est déjà présent

- labyrinthe BSP dense d’environ une centaine de cellules connectées, avec une forte proportion de couloirs, des cloisons d’épaisseurs variables et des volumes volontairement condamnés ;
- salles typées : bureaux, corridors, véritables grands halls de 450 m² ou plus, salles imbriquées, zones silencieuses et galeries de seuils ;
- retours de murs, cloisons coupées, colonnes irrégulières et masses architecturales épaisses qui cassent la sensation d’espace entièrement optimisé ;
- fosses en trois silhouettes : petits trous, grille mixte et grande ouverture rare ; la chute est continue vers un sous-niveau éclairé et explorable, sans recalage visible ;
- escalier généré et franchissable grâce à l’autostep Rapier ;
- minuscule ouverture traversable avec `E`, donnant sur un hall de 58 mètres à plafond gigantesque, texturé, éclairé et explorable ;
- moquette, plâtre et faux plafond en PBR (albedo, normal, roughness/AO packés) ;
- lampes sous forme de dalles lumineuses intégrées au faux plafond, snapées sur la grille et filtrées pour ne jamais croiser murs, colonnes, masses ou trous ;
- éclairage fluorescent pré-calculé par chunk, stable pendant le déplacement, avec occlusion murale et SSAO de contact sans halo attaché au joueur ;
- températures propres à chaque luminaire ; les états de panne/scintillement sont prêts dans le plan mais désactivés pour cette version sans monstre ;
- déplacement interpolé entre les pas physiques, sprint perceptible et rig caméra avec head bob, roulis et inertie de souris ;
- bloom discret, SMAA, tone mapping AgX et vignette légère, sans passe chromatique plein écran ;
- bourdonnement et ventilation CC0 superposés à un lit électrique synthétique, avec mix différent selon la salle ;
- résolution interne adaptative selon les performances.

## Architecture

```text
src/
  audio/       ambiance Web Audio et pas synthétiques
  core/        initialisation, boucle fixe, qualité adaptative
  input/       clavier AZERTY/QWERTY
  physics/     capsule cinématique Rapier et colliders générés
  player/      caméra FPS, inertie, bob et chute
  render/      PBR, géométrie fusionnée, instancing, lumières et post-FX
  ui/          écran d’entrée et HUD
  world/       seed, plan pur, BSP, registre de features et tests
```

La génération produit uniquement un `WorldPlan` sérialisable. Le rendu et la physique le consomment séparément : les futurs workers, chunks ou exports serveur n’ont donc pas besoin d’importer Three.js.

Les éléments répétés sont instanciés ; les murs et plinthes sont fusionnés par matériau. Les données de gameplay (colliders, sockets d’objets, salles et features) restent accessibles dans le plan.

## Ajouter une pièce spéciale

Voir [docs/ADDING_FEATURES.md](docs/ADDING_FEATURES.md). Le registre est dans `src/world/FeatureRegistry.ts`, les types dans `src/world/types.ts`, et les recettes de rendu dans `src/render/WorldBuilder.ts`.

## Assets et licences

Les ressources livrées sont locales et le jeu ne hotlinke aucun CDN. Les sources et transformations sont consignées dans [public/assets/licenses.json](public/assets/licenses.json).

- PBR : ambientCG, CC0.
- Audio : Freesound, CC0.
- Motif de papier peint : asset original généré pour ce projet avec le mode intégré `imagegen`, puis optimisé en WebP.
- Albédo de moquette : asset original généré pour ce projet avec `imagegen`, associé aux cartes normal/ARM CC0 existantes puis optimisé en WebP.

## Prochaine étape logique

Le monde est maintenant streamé par chunks autour du joueur via worker. Les prochaines grosses couches logiques sont les étages verticaux pleinement streamés, les items utiles et les entités/monstres avec extinction locale de lampes.
