# Lumière et préparation GPU

`LightSlot` est une donnée de génération, pas une lumière Three.js. Les panneaux
non morts restent des émetteurs visuels ; le rendu des surfaces utilise un champ
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
plafonniers et appliques pilotent un pool constant de quatre lumières locales,
repositionnées entre les étages sans changer le nombre de lumières du shader.
Le profil moderne a des sources plus concentrées ; le classique reste plus
chaud et plus large. Les deux shadow maps extérieures sont calculées une fois,
puis invalidées uniquement lors d'une réactivation des ombres. En qualité
Performance, elles sont désactivées avec l’anticrénelage, bloom et le normal pass/SSAO du
mode classique. Auto adopte ce repli après un ralentissement durable et ne
rétablit les effets qu'après vingt secondes stables. Sa résolution peut descendre
vers 850 000 pixels sur grand écran. La pause et une page masquée ne redessinent
pas continuellement la scène. La cage utilise FXAA, sans passes auxiliaires ni
textures de recherche SMAA. Le pipeline Backrooms attend explicitement les tables
SMAA avant son warmup.

`SceneWarmup` envoie toutes les textures à la carte graphique, prépare les limites
et textures d'os des trois vues du personnage et dessine les géométries hors champ
sous le chargement. Visibilité et culling sont restaurés avant présentation ; les
ombres statiques sont invalidées après ces vues temporaires. Une fence GPU
asynchrone attend la fin des transferts, sans `gl.finish()` ni readback. La première
sauvegarde et sa miniature précèdent le démarrage de la boucle de jeu. Auto et
Performance limitent les cartes secondaires à 512 pixels ; albédo, affiches et
textures partagées avec le garde-robe restent intacts. Une Source propre au jeu
évite de modifier l’éditeur ; Qualité restaure les cartes d’origine.

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
matériaux PBR propres à l’intérieur réduisent fortement leur albédo et leur
émission afin que le rig global de la cage ne rende pas la pièce artificiellement
claire ; les vitres transparentes et le repère de l’interrupteur restent lisibles.
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

Les coordonnées de `LightSlot.ceilingY` sont absolues dans le plan local ;
`WorldBuilder` applique ses petits offsets visuels une seule fois.

Retour au [routeur runtime](RUNTIME_RENDERING.md).
