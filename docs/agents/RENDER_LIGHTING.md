# Lumière et préparation GPU

`LightSlot` est une donnée de génération, pas une lumière Three.js. Les panneaux
non morts utilisent des diffuseurs HDR blancs neutres (radiance linéaire 2),
indépendants de la teinte du papier peint. Ils restent lisibles sans bloom ; le rendu des surfaces utilise un champ
fluorescent dans `ZonalLighting.ts`. Une clé directionnelle douce, sans shadow
map, révèle les normales et les coins sans réintroduire les bandes du bake.
Le chemin historique dérive des panneaux et volumes une texture RG8 de 96² :
elle produit de larges nappes locales et une proximité structurelle très douce
aux contacts, sans rayon ni visibilité murale. Le shader effectue une seule
lecture par fragment et la texture doit être libérée avec le `WorldView`.
Pour les plans spatiaux modernes, les mêmes valeurs sont regroupées dans un atlas
96² par couche : bornes verticales float en nearest, exposition/contacts/blackout
en RGBA8 nearest. Le shader choisit le vrai volume séparément aux quatre
texels, puis interpole les valeurs et hauteurs en normalisant les texels valides.
Ne jamais filtrer une ligne d'atlas avant ce choix : les indices de couche
peuvent changer à la fin d'une galerie. Dans un atrium où plusieurs volumes
contiennent le fragment, le sol le plus proche départage les candidats.
Les textures GPU 98² par couche ajoutent une bordure d'un texel aux 96² utiles.
`WorldStream` raccorde cette bordure aux données originales des huit voisins
horizontaux, par hauteur réelle, au montage/démontage et après une bascule de
mode. Le cache CPU reste intact et un voisin absent répète le bord local.
Avec une seule couche, les bornes GPU sont prémultipliées par leur validité en
RGBA16F linéaire (les données CPU restent float32 exactes) et le champ lumineux
RGBA8 conserve sa validité en alpha. Deux lectures interpolées suffisent, sans
boucle de sélection ni extension de filtrage float32. Le chemin à plusieurs
couches garde ses bornes float32 nearest et la sélection aux quatre texels. Le nombre de couches suit le chevauchement réel sans troncature
à trois. Les contacts sont relatifs au sol et au plafond du volume. Deux volumes
ayant les mêmes sources/structures réutilisent leur calcul CPU ; le worker
transfère les buffers, sans objets Three dans `WorldPlan`. Les deux textures GPU
sont libérées au démontage. Les pièces utilisent les panneaux fiables, teintes,
intensités et dispositions du générateur historique.

`WorldPlan.unlitZones` reste en coordonnées locales. Le shader évalue ces
rectangles depuis la position monde moins l’origine du chunk, avec un fondu aux
seuils, une portée réduite seulement dans le blackout et une garde verticale sur
la story active. Ne pas piloter une forte densité de fog depuis la seule position
du joueur : cela recréerait une bulle visible pendant les transitions.

En mode moderne, le post-traitement ne contient ni normal pass ni SSAO. Son
pipeline utilise bloom, tone mapping, contraste, grain, vignette et SMAA. Le
champ fluorescent garde un socle sombre entre les panneaux, mais élargit et
renforce nettement les nappes sous les néons. Le biome visuel `dim` conserve
l’ancien étalonnage moderne plus sombre sans repasser par le bake classique.
Les contacts sol/mur/plafond restent renforcés pour éviter un rendu uniformément
éclairé. Le mode classique recrée le normal pass, le SSAO et les réglages de
bloom historiques ; le composer est reconstruit lors de la bascule.

`RussianStairwellGame` conserve le rig global et le `PostFX` nocturnes. Les
quatre plafonniers et trois appliques possèdent sept sources fixes sans ombres
locales. Leur position et leur contribution ne dépendent jamais de la caméra ;
le nombre de lumières du shader reste constant pendant les déplacements.
Une lumière s'éteint par son intensité, jamais par `visible` ni sous un parent
masqué (le modèle intérieur de l'appartement est culé depuis le palier) : tout
changement du nombre de lumières visibles recompile chaque shader éclairé en
plein jeu. `FrameHitchMonitor` journalise le paramètre de clé qui a changé.
Le profil moderne a des sources plus concentrées ; le classique reste plus
chaud et plus large. Les deux shadow maps extérieures sont calculées une fois,
puis invalidées uniquement lors d'une réactivation des ombres. En qualité
Performance, elles sont désactivées avec l’anticrénelage, bloom et le normal pass/SSAO du
mode classique. Auto désactive les ombres dès le chargement et garde un pipeline
fixe : FXAA en moderne, passes réduites en classique. Seule sa résolution s'adapte
pendant la marche, sans reconstruire le composer ni les shaders d'ombres. Elle peut descendre
vers 850 000 pixels sur grand écran. La pause et une page masquée ne redessinent
pas continuellement la scène. La cage utilise FXAA, sans passes auxiliaires ni
textures de recherche SMAA. Le pipeline Backrooms attend explicitement les tables
SMAA avant son warmup.

La cage ajoute une passe `VhsEffect` séparée (elle échantillonne ses voisins) :
niveau permanent faible, accentué par `BacteriaEncounter.cameraDisturbance`
(proximité, regard, mise à mort). Aucun flash teinté : il rosissait la créature.

`SceneWarmup` envoie toutes les textures à la carte graphique, prépare les limites
et textures d'os des trois vues du personnage. Il monte aussi les buffers hors
champ : des proxies partagent les buffers exacts avec une plage de dessin nulle,
par lots de huit objets ou 4 Mo. Plages et tri sont restaurés même en cas d'échec ;
`compileAsync` seul ne transfère pas ces buffers. Les textures sont groupées par
lots d'au plus huit textures ou 4 ms, avec une tâche navigateur entre les lots,
sans attendre une image par texture. Sans `KHR_parallel_shader_compile`
(Firefox), `compileAsync` rend la main tout de suite et chaque programme se lie
au premier rendu, en un seul gel : `compileSceneProgressively` lie un matériau
à la fois (`getUniforms()`) avec une tâche navigateur toutes les ~12 ms, en
liant une cible hors écran : la clé de programme dépend de la cible (espace de
sortie) et la scène passe par le composer, sinon tout est recompilé au rendu. Seuls les personnages sont dessinés hors
champ ; l'architecture conserve son culling normal. Visibilité et culling sont
restaurés avant présentation. La cage prépare aussi huit vues à 320×180 (paliers
et intérieur), en restaurant caméra et visibilité même en cas d'échec ; les
ombres statiques sont invalidées après ces vues temporaires. Une fence GPU
asynchrone attend la fin des transferts, sans `gl.finish()` ni readback, avec une
limite de 15 secondes mesurée en temps réel et sans dépendre de `requestAnimationFrame`.
La progression distingue transferts, compilation et premières images. La première
sauvegarde et sa miniature précèdent le démarrage de la boucle de jeu. Auto et
Performance limitent les cartes secondaires à 512 pixels ; albédo, affiches et
textures partagées avec le garde-robe restent intacts. Une Source propre au jeu
évite de modifier l’éditeur ; Qualité restaure les cartes d’origine.
Le menu Backrooms prépare aussi les deux premières passes du composer en
320×180, puis remplit une fois les cibles à la résolution de jeu avant révélation.
Les durées des sous-phases sont dans `window.__BACKROOMS_LOAD__.operationsMs`.
Après panne, seul `structure` est masqué ; `exterior` (pluie/ciel) et les lumières
racines restent présents. Les sept lampes électriques et le fill de réaction,
préparé avant le warmup, changent d'intensité sans changer les defines du shader.

`StairwellDetails` reste statique : cinq matériaux et un atlas opaque de 1024²,
sans lumière ni travail par image. Les volumes solides rejoignent
`environment.furnitureColliders`. Le parent détruit les géométries après fusion ;
le module libère ses matériaux et son atlas. Les radiateurs ont de vraies colonnes
arrondies et les plafonniers des tubes et douilles. `StairwellSurfaceFinish` bake
la peinture, fissures, coulures et reprises d'enduit dans un atlas opaque de
2048×1024 propre aux murs. Les pièces de maçonnerie contiguës partagent les mêmes
coordonnées de texture. `StairwellPaintLayout` conserve exactement les 42
empreintes de peinture approuvées avant l'atlas : trois demi-paliers, aucune
répétition au-dessus de la dernière volée, et les retours du RDC. Ne pas les
remplacer par un motif périodique. Aucune bande de peinture rapportée ou incrustation de
sol coplanaire n'est ajoutée. Les tests sondent les murs, les sept paliers,
les budgets géométriques et les parcours Rapier sur les quatre niveaux.

Le modèle intérieur de l'appartement est masqué au rendu quand la dalle ou la
porte fermée le cache. Ses copies de portes voisines, la porte interactive et
ses colliders restent montés. Les matrices du modèle statique sont figées ; les
pivots interactifs gardent leur mise à jour. `SmallPropGeometry` regroupe une
seule fois les sommets trop denses des accessoires de moins de 50 cm, en gardant
les coutures UV et normales. Chaque regroupement est refusé si son écart monde
dépasse 1,4 mm ; architecture, personnages et éléments multi-matériaux sont
exclus. Les accessoires opaques sont ensuite fusionnés par matériau et cellule
de 3,5 m afin de garder le culling spatial ; les meshes de collision gardent
leur hiérarchie d'origine. Il n'y a aucun calcul de simplification par image.

L’appartement démarre avec son plafonnier principal éteint. Une unique source
à longue portée est alignée sur son diffuseur afin d’éclairer aussi l’entrée
sans créer plusieurs halos au plafond. Un interrupteur raycasté sur la face
intérieure du mur, à côté de la porte d’entrée, le commande et garde
un petit repère non éclairé visible dans le noir. Quand il est coupé, les
matériaux PBR conservent leur albédo ; les sources et émissions électriques
s'éteignent, laissant le palier éclairer naturellement l'entrée. Les stores,
détachés sous leur pivot, participent aussi à la préparation des matériaux :
tissu mat sans émission ni lightmap. Les vitres et le repère restent lisibles.
Les vitres de l’appartement utilisent un verre PBR très peu opaque, tone-mappé
et soumis au fog nocturne comme celles du hall ; elles ne doivent jamais ajouter
un voile blanc non éclairé sur le décor extérieur.
Son état fait partie de
`RussianStairwellSavePayload`; les anciennes sauvegardes sans ce champ sont
relues avec la lumière éteinte.
Les supports importés `Curtain` et `Curtain1` restent strictement statiques. Les
toiles déjà partiellement déroulées juste dessous (`polySurface36` et
`polySurface34`) sont raycastées directement avec l’action **interagir**.
Chacune est réancrée sur son arête supérieure puis étirée verticalement jusqu’au
bas de sa propre fenêtre ; leurs hauteurs ouvertes différentes produisent donc
des facteurs de fermeture distincts. Aucun panneau ou matériau de remplacement
n’est ajouté. L’échelle 1 restaure exactement la forme ouverte d’origine. Le
snapshot conserve leurs deux états cibles ; une sauvegarde antérieure les
recharge ouverts.

`LightingMode` expose `modern` et `legacy` aux paramètres graphiques. Le mode
`legacy` restaure le pipeline antérieur à `e6d7e6a` : bake CPU de deux lightmaps
224² par chunk (surfaces générales et plafond), masque de surface dans le shader
et réglages de matériaux historiques. Les workers calculent le bake hors du
thread principal quand ils sont disponibles. `WorldStream.setLightingMode()`
reconstruit uniquement les `WorldView`, conserve plans, colliders et portes
ouvertes, garde les données du bake actif et publie une progression
`{ completed, total }` utilisable par le menu.

`GameSettings.brightness` est un nombre entre 0 et 100, par défaut 50, persistant
sous la clé existante. Une ancienne sauvegarde de paramètres sans ce champ garde
ses préférences et reçoit 50 ; zéro est valide. `LightingBrightness` centralise
la courbe : dans les Backrooms modernes, 0 reprend le rig et les pools de 7317222,
100 ceux de 687c5eb, et 50 interpole leurs paramètres. Les cibles de blackout et
les pools spécifiques à `dim` ne changent pas. Le mode Classique et le Stairwell
conservent leurs sources/palettes propres : 100 garde leurs intensités de
référence ; les valeurs inférieures appliquent le gain relatif combiné du rig
et des pools modernes. Il s'agit d'une convention commune d'atténuation, pas
d'un passage automatique en mode historique. Le rig russe n'avait pas reçu la
hausse v17 des Backrooms. L'extérieur garde lune et réverbère ; l'interrupteur de
l'appartement reste prioritaire sur son gain de source. Les diffuseurs restent
indépendants du curseur.

`WorldStream.setBrightness` met à jour les vues existantes, les prochains
montages et les remplacements asynchrones. `ZonalLightingContext.poolUniforms`
partage ses holders avec les shaders présents et les décors chargés ensuite.
Les champs CPU/worker et textures GPU restent identiques ; aucune recompilation
ni reconstruction de composer n'est nécessaire. Le bake classique conserve ses
données ; les intensités de lightmap/émission des matériaux détenus sont ajustées
depuis leurs valeurs de base, sans accumulation entre réglages.

Les surfaces sèches optent pour `MatteSurface`, après leurs décorateurs de
lumière. Il remappe la rugosité effective après lecture de la texture, entre
0,82 et 0,98, tout en gardant ses variations. Le marqueur sérialisable suit les
clones ; le hook doit être réappliqué au clone final, car Three ne copie pas
`onBeforeCompile`. Verre, métaux et diffuseurs ne sont pas concernés. Les pixels
des textures partagées, l'albédo, les normales et le bloom restent inchangés.

La sous-face des toits inclinés est calculée avec `surfaceUndersideY` :
l’épaisseur s’extrude le long de la normale. Le diffuseur reste parallèle à
cette sous-face, 3,6 cm en dessous, et le profil prévu correspond au vrai vide.

Les coordonnées de `LightSlot.ceilingY` sont absolues dans le plan local ;
`WorldBuilder` applique ses petits offsets visuels une seule fois.

Retour au [routeur runtime](RUNTIME_RENDERING.md).
