# Garde-robe

La Garde-robe est intégrée sous `src/wardrobe` et son popup est embarqué comme
page de `ExperienceUI`. Le bouton **Garde-robe** est présent dans le menu
principal et le menu pause, juste avant **Paramètres**.

Le point d'entrée est `src/wardrobe/BackroomsWardrobeElement.tsx`. Son import
enregistre le custom element `<backrooms-wardrobe>`. L'éditeur ne monte son
arbre React et sa scène Three.js que lorsque l'attribut `active` est présent ;
le retrait de cet attribut démonte l'éditeur. Les méthodes `navigateBack()` et
`resetNavigation()` sont disponibles sur l'élément pour l'intégration au shell.

Les Paramètres contiennent également l'onglet **Développeur** du preview complet.
Le code local `1234` déverrouille l'export batch des aperçus : les personnages
sont rendus avec le runtime MakeHuman puis téléchargés dans un ZIP WebP.

Navigation :
- personnage par défaut + six alternatives ;
- `Modifier` ouvre une seule interface ;
- catégories simples communes : Général, Peau, Yeux, Coiffure, Sourcils, Cils, Haut, Bas, Chaussures ;
- la catégorie Barbe est réservée aux hommes et sépare les barbes des moustaches (sélection indépendante) ;
- la catégorie Ongles est réservée aux femmes ;
- `Options avancées` est un toggle dans cette même interface ;
- les catégories avancées apparaissent à la suite dans la navigation, sans nouvelle page ;
- `Retour` revient au choix des personnages ; l'hôte futur pourra ensuite
  fermer la Garde-robe.

Le mode avancé expose directement les parties anatomiques (Nez, Bouche, Mâchoire, Joues, Menton, Front, Sourcils, Oreilles, Poitrine, Épaules, Torse, Ventre, Taille, Hanches, Fesses, Bras, Jambes, Mains, Pieds, Cou, etc.). Les contrôles à deux axes utilisent des pads 2D et les contrôles à un seul axe des sliders.

La configuration courante reste conservée dans `localStorage` sous
`character-studio/current/v4`. Le personnage personnalisé et son aperçu sont
stockés sous les clés `backrooms/wardrobe/custom-character/v1`,
`backrooms/wardrobe/custom-preview/v1` et
`backrooms/wardrobe/custom-preview-stamp/v1`.


Rendu v11 : les hauts/bas/cheveux n’utilisent plus les `delete_verts` communautaires trop larges ; les coiffures sont rendues en alpha cutout double face et aucun accessoire/chapeau caché n’est chargé par les presets.
