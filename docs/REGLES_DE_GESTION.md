# Règles de gestion — Grandload

## Acquisition et collecte

- **RG-03 / RG-06** : les URL sont normalisées, dédoublonnées et validées avant utilisation.
- **RG-100 à RG-104** : les planches sont lues dans l'ordre du lecteur et le lazy-loading est traité.
- **RG-106 / RG-107** : les pré-exclusions sont visibles, réversibles et les suggestions mémorisées ne sont jamais appliquées sans affichage.
- **RG-200 à RG-211** : les séries sont triées numériquement, traitées séquentiellement, contrôlables et historisées.
- **RG-205** : l'adaptateur déclare `live-dom` ou `html-parse`; un repli vers `live-dom` est utilisé si le HTML brut est insuffisant.
- **RG-206** : le délai et le backoff respectent les limites du site ; aucune vérification anti-robot n'est contournée.

## Archives et nommage

- **RG-300** : les formats CBZ, ZIP et dossier sont disponibles ; CBZ est le format par défaut.
- **RG-301 / RG-302** : une archive est produite par chapitre ; les entrées suivent l'ordre de lecture et utilisent un remplissage d'au moins trois chiffres.
- **RG-303** : le chemin est produit par la destination active et son gabarit validé RG-32 ; le nom de chapitre est nettoyé.
- **RG-305** : la construction lourde s'effectue dans l'offscreen Chrome ou dans la page d'événement Firefox.
- **RG-306 / RG-307** : une erreur d'image fait échouer le chapitre sans archive incomplète ; les réponses doivent être des images non vides.
- **RG-308 à RG-310** : les tailles importantes sont signalées, les blobs sont révoqués et les conflits sont suffixés.

## Adaptateurs et modularité

- **RG-400 à RG-404** : un adaptateur est choisi par URL, reste pur et signale clairement les structures inconnues.
- **RG-500 à RG-503** : les fonctionnalités sont des modules enregistrés ; aucun import direct entre modules ; Préférences reste activé.

## Permissions, sécurité et vie privée

- **RG-600** : permissions fixes minimales : `activeTab`, `scripting`, `downloads`, `storage`, `offscreen` côté Chrome et `sidePanel` côté Chrome/Edge ; les hôtes sont optionnels et demandés par domaine au clic.
- **RG-601 / RG-602** : aucun code distant, tracking, appel tiers ou donnée envoyée.
- **RG-603** : les données de page sont rendues via `textContent` ou des nœuds créés explicitement.
- **RG-604** : aucune règle réseau spéciale sans justification et documentation.
- **RG-605** : aucun contournement de connexion, paywall, captcha ou protection anti-robot.

## Interface et design system

- **RG-700** : interface française ; les textes visibles passent par `src/sidepanel/i18n.ts`.
- **RG-701** : les vues utilisent les composants de `src/ui/`; aucune logique métier dans les composants.
- **RG-702** : chaque vue expose les états vide, chargement, erreur, permission requise et succès.
- **RG-703** : les progressions sont visibles et annoncées par `aria-live`; clavier, focus visible et annulation sont obligatoires.
- **RG-704** : les préférences couvrent thème, format, destination, concurrence, délais, acquisition, pré-exclusions et modules actifs.
- **RG-705** : la galerie prend en charge la sélection, les filtres, le tri demandé, les badges de provenance et la virtualisation au-delà de 300 éléments.
- **RG-706** : les composants restent indépendants du noyau et reçoivent données et callbacks par contrat.

## Destinations

- **RG-711** : trois modes sont proposés : navigateur, dossier personnalisé et demander à chaque fois.
- **RG-712** : le gabarit accepte `{serie}`, `{chapitre}`, `{domaine}`, `{titre}` et `{date}` ; chaque segment respecte RG-32 ; vide signifie Téléchargements.
- **RG-713** : le handle personnalisé reste dans IndexedDB de l'origine et ne transite jamais par un message runtime ni vers un tiers.
- **RG-714** : `queryPermission` est vérifié avant chaque tâche ; `needs-permission` exige un clic explicite et persiste la reprise possible.
- **RG-715** : demander à chaque fois utilise `saveAs: true` pour une archive unique ; le format dossier est refusé avec un message explicite.
- **RG-716** : les sous-dossiers sont créés selon le gabarit, les conflits utilisent `(1)`, `(2)` et une écriture interrompue ne laisse pas de fichier partiel.
