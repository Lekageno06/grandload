# Règles de gestion — Grandload

Format : **RG-xxx** — énoncé. Priorité : 🔴 MVP · 🟡 v1.1 · 🟢 plus tard.
L'agent cite les RG implémentées dans ses commits.

## A. Scan générique
- **RG-01** 🔴 Scan autorisé uniquement sur pages `http:`/`https:`. Sinon : message « Cette page ne peut pas être analysée ».
- **RG-02** 🔴 Scan uniquement sur l'onglet actif et sur action de l'utilisateur. Aucun scan en arrière-plan.
- **RG-03** 🔴 Sources : `a[href]`, `img[src|srcset]`, `picture source[srcset]`, `video`, `audio`, `source`, `link[href]` (icônes), `meta og:image|og:video`, `iframe[src]` (en tant que lien).
- **RG-04** 🟡 Iframes de même origine scannées ; cross-origin ignorées.
- **RG-05** 🟡 Extraction des `background-image: url(...)`.
- **RG-06** 🔴 Attributs lazy lus : `data-src`, `data-original`, `data-lazy-src`, `data-srcset`.

## B. Normalisation
- **RG-10** 🔴 URL résolues en absolu via `new URL(valeur, document.baseURI)`.
- **RG-11** 🔴 Schémas acceptés : `http`, `https`. Rejet de `javascript:`, `mailto:`, `tel:`, `blob:` ; `data:` rejeté par défaut.
- **RG-12** 🔴 Dédoublonnage sur l'URL sans fragment. Limite d'affichage 5 000, avec avertissement.
- **RG-13** 🔴 Pour `srcset`, tous les candidats sont extraits ; le plus grand est marqué « meilleure qualité ».

## C. Classification, filtres, sélection
- **RG-20** 🔴 Type déterminé par l'extension (hors query), puis par la balise source, sinon `link`/`other`.
- **RG-21** 🔴 Catégories : image (jpg, jpeg, png, gif, webp, avif, svg, bmp, ico), video (mp4, webm, mkv, mov, avi ; m3u8 = flux non téléchargeable), audio (mp3, wav, ogg, m4a, flac, aac), document (pdf, doc(x), xls(x), ppt(x), txt, csv), archive (zip, rar, 7z, tar, gz), link.
- **RG-23** 🔴 Filtres cumulables : type, extension, texte (insensible à la casse).
- **RG-24** 🟡 Filtre regex ; regex invalide = message inline, jamais de plantage.
- **RG-25** 🔴 Compteurs par type en badges, mis à jour selon les filtres.
- **RG-26** 🔴 Sélection : individuelle, tout, aucun, inverser. « Tout » = éléments filtrés visibles.
- **RG-27** 🔴 Actions désactivées si la sélection est vide.

## D. Téléchargement de fichiers (mode générique)
- **RG-30** 🔴 3 téléchargements simultanés par défaut (réglable 1–6).
- **RG-31** 🔴 Dossier : `Grandload/<domaine>/`.
- **RG-32** 🔴 Nom = dernier segment décodé ; caractères `\ / : * ? " < > |` remplacés par `_` ; 150 caractères max ; interdiction de `..`.
- **RG-33** 🔴 Conflit de nom : `conflictAction: "uniquify"`.
- **RG-34** 🔴 Échec : 2 ré-essais (1 s puis 3 s) puis statut « échec » avec motif.
- **RG-35** 🔴 Annulation d'un job ou de toute la file.
- **RG-37** 🔴 Confirmation au-delà de 50 fichiers.
- **RG-38** 🟡 Flux `.m3u8`/`.mpd` exclus avec avertissement.

## E. Export (mode générique)
- **RG-40** 🔴 Formats TXT (une URL par ligne), JSON (items complets), CSV (`url,type,ext,source,label`, UTF-8, guillemets échappés).
- **RG-41** 🔴 « Copier les URL » : une par ligne.
- **RG-42** 🔴 Export sur la sélection, ou sur la liste filtrée au choix.

## F. Mode Chapitre
- **RG-100** 🔴 Une page est un chapitre si `adapter.classify(url) === 'chapter'`.
- **RG-101** 🔴 Les planches sont extraites **dans l'ordre de lecture du site** (ordre du DOM, ou ordre fourni par l'adaptateur). Indices à partir de 1.
- **RG-102** 🔴 Lazy-loading : lire `src` puis les attributs `data-*` (RG-06). Si des planches restent sans URL, auto-scroll (pas ≈ hauteur de fenêtre, délai 150–300 ms, arrêt quand le nombre de planches est stable sur 2 passes, délai maximal 60 s).
- **RG-103** 🔴 Si le site propose « défilement » / « page par page », l'adaptateur lit toutes les planches sans modifier durablement la préférence de l'utilisateur ; toute modification temporaire est restaurée.
- **RG-104** 🔴 Une planche = `{ index, url, ext, width?, height?, included, excludeReason? }`.
- **RG-105** 🔴 Exclusion manuelle par case ; actions « tout », « aucune », « inverser », « exclure avant/après celle-ci ».
- **RG-106** 🟡 Pré-exclusion automatique (désactivable, toujours visible et réversible) : largeur < 200 px, URL correspondant aux motifs de l'adaptateur (logo, bannière, avatar), doublon exact consécutif.
- **RG-107** 🟡 Les exclusions peuvent être mémorisées par site (ex. « dernière planche », motif d'URL) et proposées ensuite comme suggestion.
- **RG-108** 🟢 Réordonnancement manuel par glisser-déposer.
- **RG-109** 🔴 Chapitre sans planche : message explicite, aucune archive créée.
- **RG-110** 🔴 Métadonnées du chapitre : série, numéro, libellé, URL source.

## G. Mode Série
- **RG-200** 🔴 Une page est une série si `adapter.classify(url) === 'series'`.
- **RG-201** 🔴 Liste des chapitres fournie par l'adaptateur : dédoublonnée par URL, **triée par numéro croissant**, décimaux supportés (`chapitre-129-5` → 129.5), libellé conservé (ex. « Chapitre 130 - Début Saison 2 »).
- **RG-202** 🔴 La liste est **complète** même si l'interface du site la pagine (« Voir plus ») : l'adaptateur lit le HTML complet ou déclenche le chargement.
- **RG-203** 🔴 Sélection : tout, plage de/à, cases, « non téléchargés seulement ».
- **RG-204** 🔴 Traitement séquentiel : 1 chapitre à la fois (réglable jusqu'à 2).
- **RG-205** 🔴 Acquisition selon `adapter.acquisition` : `live-dom` (onglet inactif unique, fermé après lecture) ou `html-parse` (sans onglet).
- **RG-206** 🔴 Délai de 1,5 s entre chapitres (réglable) ; sur HTTP 429/503, backoff exponentiel (2 s, 4 s, 8 s… plafond 60 s) puis pause automatique du job.
- **RG-207** 🔴 L'échec d'un chapitre n'interrompt pas la série ; récapitulatif final et bouton « Relancer les échecs ».
- **RG-208** 🔴 Historique des chapitres terminés par série ; ignorés par défaut, re-téléchargement possible.
- **RG-209** 🔴 Pause, reprise, annulation ; reprise après redémarrage du Service Worker.
- **RG-210** 🟡 Chapitre avec 0 planche ou publication en cours (ex. libellé « Nouveau » sans image) : signalé, non téléchargé.
- **RG-211** 🔴 Confirmation au-delà de 20 chapitres.

## H. Archives
- **RG-300** 🔴 Formats : **CBZ (défaut)**, ZIP, dossier d'images. Autres formats via packagers (PDF, EPUB…).
- **RG-301** 🔴 **Une archive par chapitre.**
- **RG-302** 🔴 Entrées nommées `001.<ext>`, `002.<ext>`… (remplissage = max(3, nb de chiffres du total)) dans l'ordre de lecture ; extension d'origine conservée ; images stockées sans recompression.
- **RG-303** 🔴 Nom : `Grandload/<Série>/<Série> - Chapitre <n>.cbz`, partie entière sur 3 chiffres (`012`, `129.5`, `153`). Noms nettoyés selon RG-32.
- **RG-304** 🟡 `ComicInfo.xml` ajouté aux CBZ (Series, Number, Title, Web, PageCount), activé par défaut.
- **RG-305** 🔴 Construction **uniquement dans l'offscreen document**.
- **RG-306** 🔴 Images : concurrence 3, délai max 30 s, 2 ré-essais. Si une image échoue après ré-essais, le chapitre passe en échec ; aucune archive incomplète n'est créée silencieusement (option « créer quand même » en 🟢).
- **RG-307** 🔴 Chaque réponse doit avoir un type `image/*` et une taille > 0, sinon échec de l'image.
- **RG-308** 🟡 Avertissement si la taille estimée dépasse 300 Mo ; une seule archive en construction à la fois.
- **RG-309** 🔴 Le blob URL est révoqué dès que le téléchargement est terminé ou annulé.
- **RG-310** 🔴 Conflit de nom : `uniquify`.

## I. Adaptateurs de site
- **RG-400** 🔴 Un adaptateur par site, choisi par `matches(url)` ; sinon adaptateur générique.
- **RG-401** 🔴 L'adaptateur générique applique des heuristiques : conteneur dominant d'images (le plus grand groupe d'`img` de grande taille dans le contenu principal), exclusion de l'en-tête, du pied de page, des commentaires et des suggestions.
- **RG-402** 🔴 Ajouter un site ne modifie ni le noyau ni les modules.
- **RG-403** 🔴 Un adaptateur est pur : DOM injecté, pas d'appel `chrome.*`, testable avec une fixture HTML.
- **RG-404** 🔴 Structure non reconnue : erreur claire « Structure du site non reconnue » (code `ADAPTER_STRUCTURE`).

## J. Modularité
- **RG-500** 🔴 Toute fonctionnalité est un module enregistré dans le registre ; le noyau ne connaît aucun module concret.
- **RG-501** 🔴 Pas d'import direct entre modules : messages typés et services du noyau.
- **RG-502** 🔴 Un module déclare ses permissions (`requiredPermissions`).
- **RG-503** 🟡 Chaque module peut être activé/désactivé dans les préférences.

## K. Sécurité, permissions, éthique
- **RG-600** 🔴 Permissions fixes : `activeTab`, `scripting`, `downloads`, `storage`, `offscreen`. Accès aux sites via `optional_host_permissions`, demandé **par domaine**, sur clic.
- **RG-601** 🔴 Aucun code distant, aucun CDN, aucun `eval`.
- **RG-602** 🔴 Aucune donnée envoyée à un tiers, aucune télémétrie.
- **RG-603** 🔴 Affichage des données de page via `textContent` uniquement.
- **RG-604** 🟡 `declarativeNetRequestWithHostAccess` uniquement si un site exige un `Referer` ; règle limitée au domaine concerné et documentée.
- **RG-605** 🔴 Pas de contournement de connexion, paywall ou captcha. Usage personnel hors-ligne. Débit raisonnable (RG-206).

## L. Interface
- **RG-700** 🔴 Interface en français, textes centralisés (`i18n.ts`).
- **RG-701** 🔴 Bootstrap local ; onglets = modules applicables au contexte.
- **RG-702** 🔴 États vides explicites ; erreurs lisibles, détail technique dans `console.error`.
- **RG-703** 🔴 Progression visible (par chapitre et globale) ; boutons pause/reprise/annulation.
- **RG-704** 🟡 Préférences mémorisées (format, concurrence, délais, dossier, modules actifs).
