# Aperçu intégré pour la conversation

Cet aperçu utilise CharacterRuntime, PlayerController, PhysicsWorld et la commande /viewmodel du commit 5b6194362753a4363d1f65a36e22e3d9200622a7. Le décor est une petite pièce procédurale prévue pour la conversation ; ce n’est pas l’ensemble du monde Backrooms. Les panneaux de laboratoire ne sont pas utilisés.

Les 70 FBX et 10 clips JSON du pack sont convertis en données locales : le squelette à 65 os, le mesh et les clips conservent leurs valeurs, sans rééchantillonnage. Les pistes constantes sont optimisées comme dans le runtime. Les tâches physiques, les transitions et les interactions restent celles du jeu. Les traces utilisent le fallback procédural déjà présent dans le repo.

Les données sont chargées comme modules JavaScript statiques depuis un CDN autorisé. L’aperçu n’effectue ni requête fetch, ni XHR, ni connexion de jeu externe. Rapier utilise son paquet compat avec WebAssembly intégré. La capture de souris est facultative grâce au comportement embarqué déjà présent dans PlayerController.

Préparer : npm ci puis node scripts/unpack-character-assets.mjs
Générer les données : node artifact-preview/extract-assets.mjs
Compiler : node artifact-preview/build-preview.mjs
Les fichiers de distribution correspondants se trouvent dans character-preview/.

Validation hors écran : chargement des 80 assets, mesh et squelette, ouverture contextuelle de Tab avec collection solo masquée, aller-retour /viewmodel, simulation du ragdoll, zéro appel réseau. Le rendu WebGL ne peut pas être validé dans cet environnement.

Cette branche contient uniquement l’ajout de l’aperçu. Elle ne modifie pas main.
