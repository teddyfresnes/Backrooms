# Backrooms v141 — ZIP complet autonome en assets

Emotes : un simple appui sur **Tab** ouvre une roue qui s’efface linéairement en **2 secondes**. **1–8** ou un clic joue un favori ; tout déplacement ferme immédiatement l’overlay. La visée et la simulation restent actives. La roue et « Tout voir » affichent seulement les emotes de la posture actuelle, avec des favoris séparés debout / au sol. Au sol, **1** sélectionne « S’allonger » et **2** « Kip-up » par défaut. Le personnage rejoint progressivement la pose initiale avant de jouer l’animation. **E** permet toujours de se relever depuis la pose allongée. Les emotes sans espace libre ou sans sol stable sont grisées ; un plafond bas peut autoriser la pose allongée tout en bloquant le Kip-up. Les danses conservent leur trajectoire d’origine via la collision physique.

Extraire le ZIP puis lancer **LANCER-WINDOWS.bat** (Node.js requis). Le build, les sources et tous les assets sont inclus. Les assets sont decompresses localement au premier lancement. Aucun autre ZIP requis.

Lire **LIRE-MOI.txt**. Verification : `node scripts/verify-delivery.mjs`.

Dernière évolution : regard continu pendant les frappes en strafe, chaussures alignées anatomiquement et nouveaux mouvements de cheville, de frappe et de retrait au sol. Détails dans **MOVEMENT_V141.md**.
