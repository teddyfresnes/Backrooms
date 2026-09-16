# Backrooms v141 — ZIP complet autonome en assets

Emotes : un simple appui sur **Tab** ouvre une roue au centre exact de l’écran, indépendamment de sa légende. Sans interaction, elle s’efface linéairement en **2 secondes** ; le survol la garde entièrement visible, avec le curseur normal ou celui du jeu. Sortir de la roue ou de la collection relance le fondu de 2 secondes. La grande flèche centrale revient au jeu ; les quatre petits points ouvrent toutes les emotes et les favoris. **1–8** ou un clic joue un favori ; tout déplacement ferme immédiatement l’overlay, même pendant le survol. La visée et la simulation restent actives. La roue et la collection affichent seulement les emotes de la posture actuelle, avec des favoris séparés debout / au sol. Au sol, **1** sélectionne « S’allonger » et **2** « Kip-up » par défaut. Le personnage rejoint progressivement la pose initiale avant de jouer l’animation. **E** permet toujours de se relever depuis la pose allongée. Les emotes sans espace libre ou sans sol stable sont grisées ; un plafond bas peut autoriser la pose allongée tout en bloquant le Kip-up. Les danses conservent leur trajectoire d’origine via la collision physique.

Extraire le ZIP puis lancer **LANCER-WINDOWS.bat** (Node.js requis). Le build, les sources et tous les assets sont inclus. Les assets sont decompresses localement au premier lancement. Aucun autre ZIP requis.

Lire **LIRE-MOI.txt**. Verification : `node scripts/verify-delivery.mjs`.

Dernière évolution : regard continu pendant les frappes en strafe, chaussures alignées anatomiquement et nouveaux mouvements de cheville, de frappe et de retrait au sol. Détails dans **MOVEMENT_V141.md**.
