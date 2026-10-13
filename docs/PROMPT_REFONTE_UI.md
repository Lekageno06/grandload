# PROMPT — Refonte du front-end de Grandload (Jalon 8)

> À donner à l'agent IA de codage **après** la fusion des jalons 0 à 7 dans `develop`.
> Branche : `feat/refonte-ui`. Travail en 6 phases avec points d'arrêt.

---

## 1. RÔLE

Tu es un **Lead UI/UX Designer et développeur frontend expert** en extensions de navigateur Manifest V3. Tu conçois des interfaces ultra-esthétiques, modernes, ergonomiques et très performantes. Tu travailles sur le dépôt Grandload : **lis `AGENTS.md` en premier**, puis `docs/ARCHITECTURE.md`, `docs/EXTENDING.md`, `docs/REGLES_DE_GESTION.md`, `docs/ARCHIVES.md`, `docs/CONVENTIONS.md`.

Format de réponse à chaque phase : (1) justification UX très brève (5 lignes max) de tes choix, (2) code, (3) comment tester, (4) écarts éventuels. Pas de longues introductions.

## 2. OBJECTIFS (demande du propriétaire du projet)

1. **Fin de la popup** : l'interface s'affiche dans un **panneau latéral** (Side Panel) à côté de la page, l'onglet étant « fractionné ».
2. **Design visuellement très attractif, sans Bootstrap** : Bootstrap est retiré du projet. Système de design maison.
3. **Scan générique avec aperçu des images, à la manière d'Imageye** : galerie, tri et sélection, puis téléchargement **en fichiers dans un dossier** ou **en archive ZIP / CBZ**. Le scan générique doit détecter les images de la page comme le fait le module « télécharger le chapitre » (lazy-loading, srcset, arrière-plans…), et réutiliser le même pipeline d'archive.
4. **Dossier de destination au choix** : il n'est plus forcément `Grandload/…`.

> Priorité en cas de conflit : ce prompt prime sur tout document existant qui mentionne Bootstrap ou la popup (`AGENTS.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, RG-701…). Mets ces documents à jour (phase 6).

## 3. CONTRAINTES NON NÉGOCIABLES

- **Ne casse rien** : toutes les règles de gestion existantes (RG-xxx) restent valides sauf celles explicitement remplacées ici. Les modules `chapter-download`, `series-download`, `generic-scan`, `preferences` conservent toutes leurs fonctionnalités.
- **L'architecture modulaire est conservée** : noyau / modules / adaptateurs / packagers. La refonte touche la couche UI et ajoute un point d'extension `destinations` (voir §6). Toute modification de `src/core` doit être minimale, justifiée dans le message de commit et documentée.
- **Aucune dépendance npm nouvelle sans m'en parler** (pas de React/Vue/Tailwind/Bootstrap/composants UI). UI en **TypeScript + CSS natif** (variables CSS, Grid, Flexbox, container queries).
- **Permissions** : tu es autorisé à ajouter **uniquement `sidePanel`**. Toute autre permission : tu t'arrêtes et tu me demandes. Mets à jour `docs/PERMISSIONS.md`.
- **Sécurité** : jamais d'`innerHTML` avec des données venant d'une page (`textContent`, `createElement`, `setAttribute`) ; pas de CDN, pas de police ni d'icône distante ; pas d'`eval` ; pas de script inline.
- **Accessibilité** : contraste WCAG AA (4,5:1 texte), `:focus-visible` visible, navigation clavier complète, `aria-live` pour la progression, `prefers-reduced-motion` respecté, cibles tactiles ≥ 32 px.
- **Performance** : galerie fluide jusqu'à 2 000 images (virtualisation ou fenêtrage au-delà de 300), chargement paresseux des miniatures (IntersectionObserver), au plus 6 miniatures chargées en parallèle, aucun layout shift.
- Termine chaque phase par `npm run typecheck`, `lint`, `build`, `test` et montre les sorties. Commits atomiques citant les RG.

## 4. PANNEAU LATÉRAL (Side Panel)

- Manifest : `"side_panel": { "default_path": "sidepanel.html" }`, permission `sidePanel`, **suppression de `action.default_popup`**. Dans le Service Worker : `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- Remplace `src/popup/` par `src/sidepanel/` (`main.ts`, `shell.ts`, `views/`). Supprime `popup.html`, `popup.js`, `public/vendor/bootstrap.min.css`. Le bundle devient `sidepanel.js` + `sidepanel.css` (esbuild gère le CSS).
- Le contrat de module `mountPopup` devient `mountPanel` (renommage atomique : types, modules, tests, docs).
- **Le panneau reste ouvert quand l'utilisateur change d'onglet** : écoute `chrome.tabs.onActivated` et les changements d'URL (anti-rebond 150 ms), recalcule le `PageContext` et rafraîchit l'interface avec une transition douce.
- **Contrainte activeTab** : `activeTab` est accordé à l'onglet où l'utilisateur a cliqué sur l'icône. Ne demande pas la permission `tabs`. Vérifie le comportement réel au changement d'onglet et documente-le dans `docs/ARCHITECTURE.md`. Pour un onglet non autorisé, affiche un état vide soigné avec un bouton « Autoriser Grandload sur ce site » (`chrome.permissions.request` par domaine, déclenché par un clic) ou l'invitation à recliquer sur l'icône de la barre d'outils.
- **Largeur variable** : l'utilisateur peut redimensionner le panneau (≈ 320 à 700 px). Utilise des **container queries** (`@container`) : la grille passe de 2 à 6 colonnes, la barre d'actions se compacte en dessous de 380 px.
- Firefox : `sidebar_action` sera géré au Jalon 7 (variante). Ne l'implémente pas ici, mais ne rends pas la logique dépendante de `chrome.sidePanel` hors du fichier d'amorçage.

## 5. DESIGN SYSTEM (sans Bootstrap)

Crée `src/ui/` : `tokens.css`, `base.css`, `components/*.ts` + `components/*.css`, `icons.ts`, `dom.ts` (petit helper `h(tag, props, ...children)` sûr).

### 5.1 Direction artistique
Sobre, premium, « outil de pro » : surfaces en couches, bordures très fines, ombres douces, un seul accent vif utilisé avec parcimonie, beaucoup de respiration. Thème **sombre par défaut**, thème clair complet, option « Auto / Clair / Sombre » (préférence) ; le thème suit `prefers-color-scheme` en mode Auto.

### 5.2 Tokens de départ (ajuste-les si un contraste est insuffisant)
```css
:root {
  /* sombre */
  --bg: #0b0d12;        --surface: #12151c;   --surface-2: #1a1e28;  --surface-3: #232838;
  --border: rgb(255 255 255 / .08);  --border-strong: rgb(255 255 255 / .16);
  --text: #e8eaf0;      --text-muted: #8a91a5; --text-faint: #5d6477;
  --accent: #6c7cff;    --accent-2: #2dd4bf;  --accent-ink: #0b0d12;
  --success: #34d399;   --warning: #fbbf24;   --danger: #f87171;
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .4);
  --shadow-2: 0 8px 24px rgb(0 0 0 / .35);
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px;
  --ease: cubic-bezier(.2,.8,.2,1); --dur-1: 120ms; --dur-2: 200ms;
  --font: ui-sans-serif, system-ui, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", Consolas, monospace;
}
```
Définis la version claire équivalente. Pas de police distante : pile système (une police embarquée type Inter n'est autorisée qu'après ma validation). Chiffres tabulaires pour les compteurs (`font-variant-numeric: tabular-nums`).

### 5.3 Icônes
Jeu d'une vingtaine d'icônes en **SVG inline** dans `src/ui/icons.ts` (trait 1,75 px, arrondi) : scan, image, lien, dossier, archive, télécharger, annuler, pause, lecture, réglages, filtre, tri, recherche, coche, croix, avertissement, œil, copier, rafraîchir, lune/soleil. Dessine-les toi-même ou reprends-en de Lucide (licence ISC) avec mention dans `THIRD_PARTY.md`. Aucun fichier distant.

### 5.4 Composants à construire (tous accessibles, états hover / focus / actif / désactivé / chargement)
Button (primaire, secondaire, fantôme, danger ; tailles ; état `loading` avec spinner), IconButton avec tooltip, **Segmented control / Tabs avec indicateur glissant**, Chip et Badge (type, dimensions, avertissement), Checkbox personnalisée (animation de coche), Switch, Slider (taille des miniatures, largeur minimale), Select, Input avec icône et bouton d'effacement, Card, **Toast**, Dialog de confirmation, Progress (barre + anneau), Skeleton, EmptyState illustré (SVG), Tooltip, Menu déroulant (« Plus d'actions »), **Barre d'action collante** (compteur de sélection, bouton principal, menu secondaire), **Lightbox** (aperçu plein écran, flèches clavier, Échap, bascule inclure/exclure).

### 5.5 Mouvement
Transitions 120–200 ms (`--ease`), apparition échelonnée des vignettes (≤ 30 ms de décalage, plafonnée), léger « ressort » sur la coche de sélection, glissement de l'indicateur d'onglet, skeletons pendant le scan. Tout est neutralisé sous `prefers-reduced-motion`.

### 5.5 bis Disposition générale du panneau
```
┌ En-tête : logo + nom · contexte de la page (favicon, domaine, type détecté) · ⚙ ┐
│ Onglets des modules applicables (segmented control)                           │
├ Barre d'outils du module (recherche · filtres · tri · densité)                 │
├ Contenu défilant (galerie / liste de chapitres / préférences)                  │
├ Zone « Tâches en cours » repliable (progression, pause, annuler)               │
└ Barre d'action collante (sélection · [Télécharger ▾] · plus d'actions)         ┘
```
Compact mais respirant : titres 13–15 px, texte 12–13 px, espacement sur grille de 4 px.

## 6. DESTINATION DU TÉLÉCHARGEMENT (remplace RG-31 et la partie « chemin » de RG-303)

Nouveau point d'extension `src/destinations/` avec l'interface :
```ts
export interface DestinationWriter {
  id: 'browser' | 'custom-folder' | 'ask-each-time';
  isAvailable(): Promise<boolean>;
  prepare(): Promise<void>;                                  // vérifie droits / handle
  write(file: Blob, relativePath: string): Promise<WriteResult>;
}
```
Trois modes, au choix dans les préférences **et** dans la feuille de téléchargement :

1. **Dossier du navigateur + sous-dossier libre** (`chrome.downloads`) : le chemin est relatif au dossier Téléchargements de Chrome (limite de l'API : pas de chemin absolu). Le sous-dossier est **modifiable ou vide**. Gabarit avec jetons : `{serie}`, `{chapitre}`, `{domaine}`, `{titre}`, `{date}` (ex. `Manga/{serie}`). Suggestion par défaut : `Grandload`, mais **jamais imposée**.
2. **Dossier personnalisé** (File System Access API) : bouton « Choisir un dossier… » → `showDirectoryPicker({ mode: 'readwrite' })` appelé depuis le panneau (clic utilisateur). Stocke le handle dans **IndexedDB** (origine de l'extension). Affiche le nom du dossier choisi et un bouton « Changer ». Écriture par `getDirectoryHandle(..., { create: true })` / `createWritable()` ; conflit de nom : suffixe ` (1)`, ` (2)`… (jamais d'écrasement). Avant chaque tâche, `queryPermission` ; si l'état est `prompt`, la tâche passe en `needs-permission` et le panneau affiche un bouton « Autoriser à nouveau » (clic requis). Le handle n'est **pas** transmissible par `chrome.runtime.sendMessage` : l'offscreen document le relit lui-même dans IndexedDB et écrit directement.
3. **Demander à chaque fois** : `chrome.downloads.download({ saveAs: true })` pour une archive (un seul fichier). Pour le format « dossier », propose le mode 1 ou 2 à la place.

Règles :
- Chaque segment de chemin est nettoyé (RG-32) : pas de `..`, pas de chemin absolu en mode 1, pas de caractères interdits, 150 caractères max ; erreurs lisibles.
- Chrome refuse certains dossiers système dans le sélecteur : message clair et invitation à en choisir un autre.
- Si le mode 2 est indisponible (Firefox) ou échoue, repli explicite sur le mode 1 avec une alerte visible ; aucune perte silencieuse.
- Le **nom de l'archive** (ou du dossier) est modifiable avant le téléchargement ; défaut : titre de la page (scan générique) ou `<Série> - Chapitre <n>` (chapitre).
- Les séries appliquent la destination choisie à chaque chapitre.
- Le comportement `onDeterminingFilename` existant reste en place pour le mode 1.
- Ajoute `DestinationSettings` dans `Prefs` (mode, gabarit, nom du dossier mémorisé) et documente le nouveau point d'extension dans `docs/EXTENDING.md`.

## 7. SCAN GÉNÉRIQUE AVEC APERÇU (style Imageye)

### 7.1 Détection
- Onglets du module : **Images** | **Liens et médias** (la vue liste actuelle est conservée pour le second).
- Sources d'images : `img` (`src`, `srcset` meilleure qualité, `data-src`, `data-lazy-src`, `data-original`), `picture source`, `background-image` (styles calculés des éléments visibles), `meta og:image`, `link rel=icon`, `video[poster]`, et `svg` référencés par URL. Applique `trim()` aux URL (cas réel : espace initiale dans `src`), normalisation et dédoublonnage (RG-10 à 13).
- Option « Charger les images paresseuses » (activée par défaut) : réutilise `scroll-loader.ts` (arrêt sur stabilité, 60 s max), avec progression visible et bouton « Arrêter ».
- Réutilise l'adaptateur du site s'il existe, sinon l'adaptateur générique (RG-401). Pour les images, le résultat est converti en `PageRef[]` afin de **réutiliser tel quel le pipeline d'archive** (`image-fetcher`, `archive-builder`, packagers `zip` / `cbz` / `folder`, destinations).
- Rescan automatique léger si la page change (bouton « Rescanner » toujours visible).

### 7.2 Galerie
- Grille de vignettes (`auto-fill, minmax(…)`), curseur de **taille des vignettes**, bascule grille / liste compacte.
- Chaque vignette : aperçu, case de sélection animée, badge de type (JPG, PNG, WEBP, SVG, GIF), **dimensions** (mesurées au chargement), poids sur demande (survol ou bouton « Calculer les tailles », requêtes `HEAD` limitées, RG-22), pastille d'avertissement (miniature probable RG-14, très petite image).
- Échec d'aperçu (protection anti-hotlink) : repli par récupération via l'offscreen (blob) puis état « aperçu indisponible » avec option de télécharger quand même.
- **Filtres** : type (chips), taille minimale (largeur × hauteur, avec préréglages Petites / Moyennes / Grandes), recherche texte dans l'URL, masquer les doublons, masquer les miniatures probables.
- **Tri** : ordre de la page, largeur, hauteur, surface, poids (si connu), nom, type ; croissant / décroissant.
- **Sélection** : clic, Maj+clic (plage), Ctrl/Cmd+clic, tout / aucune / inverser (sur les éléments **filtrés visibles**), sélection par glissement (optionnelle), raccourcis clavier (flèches, Espace, A, Échap).
- **Lightbox** : agrandissement, navigation, bascule inclure/exclure.
- La **barre d'action collante** affiche « N sélectionnées · taille estimée » et le bouton **Télécharger ▾** avec trois choix : *Fichiers dans un dossier*, *Archive ZIP*, *Archive CBZ*. Un clic ouvre la **feuille de téléchargement** (nom, destination, format, option ComicInfo pour CBZ). Menu « Plus d'actions » : copier les URL, exporter TXT / JSON / CSV (RG-40 à 42).
- L'ordre des fichiers dans l'archive suit **l'ordre d'affichage courant** (tri compris) ; noms `001.ext`, `002.ext`… (RG-302).
- Confirmation au-delà de 50 fichiers (RG-37). Avertissement mémoire au-delà de 300 Mo estimés (RG-308).

### 7.3 Mutualisation
Crée des composants partagés **sans dupliquer** : `ImageGallery`, `ImageToolbar` (filtres/tri), `SelectionBar`, `DownloadSheet`, `DestinationPicker`, `JobList`. Le module `chapter-download` les utilise en **mode ordonné** (ordre de lecture figé, tri désactivé, actions inclure/exclure avant/après, pré-exclusions RG-106 avec badges). Le module `series-download` réutilise `JobList`, `DownloadSheet` et `DestinationPicker`.

## 8. ÉCRANS À LIVRER
1. **Coquille** : en-tête, contexte de page, onglets des modules, zone tâches, barre d'action.
2. **Scan générique** : états *aucun scan*, *scan en cours* (skeletons + progression), *résultats*, *aucun résultat*, *erreur*, *permission requise*.
3. **Chapitre** : galerie ordonnée, exclusions, pré-exclusions visibles, feuille de téléchargement.
4. **Série** : liste de chapitres avec sélection de plage, statuts, progression globale et par chapitre, pause / reprise / annulation, récapitulatif, « Relancer les échecs ».
5. **Tâches** : liste repliable avec progression, annulation, avertissements (nom modifié, permission à renouveler).
6. **Préférences** : thème, format par défaut, destination, concurrence, délais, stratégie d'acquisition, pré-exclusions, activation des modules (le module Préférences reste non désactivable), mention d'usage responsable.
7. **États vides, erreurs et chargements** soignés (illustrations SVG sobres, messages clairs en français).

## 9. PLAN EN PHASES (arrête-toi à la fin de chaque phase et attends mon feu vert)

**Phase 0 — Audit et plan (aucun code).** Liste les fichiers UI existants, les points de couplage à Bootstrap/popup, les risques (activeTab, File System Access, offscreen), et propose le découpage en commits. Pose au maximum 3 questions.

**Phase 1 — Design system + prototype visuel.** `src/ui/` (tokens, base, composants), icônes, et une page statique **`design/preview.html`** (script `npm run preview` produisant `dist-preview/index.html`) montrant tous les composants et la galerie avec de **fausses données**, thèmes clair et sombre. Je validerai le rendu avant la suite. Aucun branchement à l'extension.

**Phase 2 — Panneau latéral et coquille.** Manifest, Service Worker, `src/sidepanel/`, suppression de la popup et de Bootstrap, onglets des modules, suivi du changement d'onglet, états de permission. Les modules existants fonctionnent dans la nouvelle coquille (même sans nouveau design interne).

**Phase 3 — Scan générique avec galerie.** §7 complet, composants partagés, feuille de téléchargement, réutilisation du pipeline d'archive.

**Phase 4 — Chapitre, série, tâches, préférences.** Migration des vues vers les nouveaux composants, sans régression fonctionnelle.

**Phase 5 — Destinations.** §6 complet, `needs-permission`, repli, tests.

**Phase 6 — Documentation et nettoyage.** Mets à jour : `AGENTS.md` (règle Bootstrap/popup remplacée), `ARCHITECTURE.md` (arborescence `sidepanel/`, `ui/`, `destinations/`, manifest), `EXTENDING.md` (destinations, composants UI), `REGLES_DE_GESTION.md` (RG-31, RG-303, RG-600 avec `sidePanel`, RG-700 à RG-704 réécrites, nouvelles RG pour galerie, filtres, tri, destination), `CONVENTIONS.md` (règles UI), `PERMISSIONS.md`, `ROADMAP.md` (Jalon 8 coché), `THIRD_PARTY.md` si besoin. Supprime tout code mort.

## 10. TESTS ET CRITÈRES D'ACCEPTATION
- **Vitest** : filtres, tri, sélection (plage, inverser, filtrés visibles), conversion image → `PageRef`, gabarits de chemin et nettoyage, dédoublonnage, tailles estimées, machine d'états de permission.
- **Manuel (à documenter dans `docs/RELEASE_CHECKLIST.md`)** :
  - [ ] Le panneau s'ouvre à côté de la page et reste affiché au changement d'onglet, avec mise à jour du contexte.
  - [ ] Aucun fichier Bootstrap dans `dist/` ; aucune requête réseau externe à l'ouverture.
  - [ ] Scan générique : galerie fluide sur une page de 500+ images, filtres et tri corrects, Maj+clic fonctionnel.
  - [ ] Téléchargement de 10 images en **dossier**, en **ZIP** et en **CBZ** ; les noms suivent l'ordre d'affichage.
  - [ ] Destination : sous-dossier libre (y compris vide), dossier personnalisé via sélecteur, « demander à chaque fois ».
  - [ ] Permission de dossier expirée : message `needs-permission` puis reprise.
  - [ ] Thèmes clair, sombre et Auto ; navigation clavier complète ; `prefers-reduced-motion` respecté.
  - [ ] Chapitre et série : aucune régression (annulation, reprise, historique, exclusions).
- `npm run typecheck`, `lint`, `build`, `test` sans erreur ; `public/manifest.json` : seule la permission `sidePanel` est ajoutée.

## 11. À NE PAS FAIRE
- Pas de framework UI, pas de Bootstrap, pas de CDN, pas de police ou d'icône distante.
- Pas de `tabs` ni d'autre permission sans m'en parler.
- Pas de logique métier dans les composants UI : ils appellent les services et messages du noyau.
- Pas de suppression de fonctionnalité existante, pas d'état durable en mémoire dans le Service Worker.
- Pas d'invention de sélecteurs de site : les adaptateurs restent la seule source de vérité.
- Si un point est ambigu ou impossible (limite d'API, comportement d'`activeTab`), arrête-toi, explique-le en 3 lignes et propose 2 options plutôt que de deviner.

Commence par la **Phase 0**.
