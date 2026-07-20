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
npm test        # suite générative, verticale, physique et rendu
npm run build   # type-check + build production
npm run validate
```

## Commandes

- `ZQSD` ou `WASD` : marcher
- `Maj` : accélérer
- `Ctrl` : s’accroupir
- `E` : traverser les passages exigus interactifs
- `C` : ouvrir le chat local et envoyer un message sous la forme `me: message`
- `H` : ouvrir la console avec `/` déjà prêt
- `↑` / `↓` : parcourir l'historique des messages et commandes
- `/help` : afficher l'aide des commandes
- `/locate` puis `Tab` : afficher toutes les cibles chargées et compléter la sélection
- `/locate dark-room` : rejoindre la pièce hors tension la plus proche
- `/locate missing-lights` : rejoindre une salle où quelques panneaux ont disparu
- souris : regarder
- `Échap` : libérer la souris / pause

Le seed courant est affiché dans le HUD. Une partie lancée sans paramètre reçoit toujours une nouvelle topologie, y compris après rafraîchissement ; pour rejouer un monde précis, utiliser explicitement `?seed=AMBER-HALL-0417`.

## Ce qui est déjà présent

- labyrinthe BSP dense d’environ une centaine de cellules connectées, avec une forte proportion de couloirs, des cloisons d’épaisseurs variables et des volumes volontairement condamnés ;
- salles typées : bureaux, corridors, véritables grands halls de 450 m² ou plus, salles imbriquées, zones silencieuses et galeries de seuils ;
- retours de murs, cloisons coupées, colonnes irrégulières et masses architecturales épaisses qui cassent la sensation d’espace entièrement optimisé ;
- fosses rares en six familles : trou unique, petites/grandes grilles, grilles denses, mixtes et clusters monumentaux ; un aperçu inférieur compact reste actif jusqu’au chargement asynchrone de l’étage canonique ;
- étages infinis streamés verticalement, puits profonds cohérents sur plusieurs niveaux et grands atriums qui réservent réellement les volumes des étages supérieurs ;
- halls à piliers agrandis, galeries symétriques à sorties parallèles et brèches monumentales ouvrant sur de longs couloirs ;
- escalier généré et franchissable grâce à l’autostep Rapier ;
- minuscule ouverture traversable avec `E`, donnant sur un hall de 58 mètres à plafond gigantesque, texturé, éclairé et explorable ;
- moquette, plâtre et faux plafond en PBR (albedo, normal, roughness/AO packés) ;
- lampes sous forme de dalles lumineuses intégrées au faux plafond, snapées sur la grille et filtrées pour ne jamais croiser murs, colonnes, masses ou trous ;
- éclairage fluorescent pré-calculé par chunk, stable pendant le déplacement, avec champ de plafond sensible à la hauteur réelle des cloisons et SSAO de contact sans halo attaché au joueur ;
- températures propres à chaque luminaire, avec de rares panneaux manquants et une pièce hors tension par chunk ;
- déplacement interpolé entre les pas physiques, sprint perceptible et rig caméra avec head bob, roulis et inertie de souris ;
- bloom discret, SMAA, tone mapping AgX et vignette légère, sans passe chromatique plein écran ;
- bourdonnement et ventilation CC0 superposés à un lit électrique synthétique, avec mix différent selon la salle ;
- résolution interne adaptative avec hystérésis pour viser 60 FPS, budget initial sur les grands écrans et remplissage immédiat des cibles HDR après une rare réallocation.

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

La génération produit un `WorldPlan` sérialisable. Les chunks et leurs deux champs d’éclairage sont préparés dans des workers ; le thread principal ne conserve que le montage progressif du rendu et de la physique.

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

Le monde est maintenant streamé horizontalement et verticalement autour du joueur. Les prochaines grosses couches logiques sont les items utiles et les entités/monstres avec extinction locale de lampes.
