# AGENTS.md — Grandload

> Point d'entrée pour l'agent IA de codage. **Lis ce fichier en premier**, puis les documents de `docs/` pertinents avant toute modification.

## Mission
Grandload est une extension de navigateur (Manifest V3) qui :
1. **Scanne** la page active et extrait liens et médias (mode générique, type Imageye / JDownloader LinkGrabber) ;
2. **Télécharge un chapitre** de webtoon/manga : planches dans l'ordre de lecture, exclusion manuelle de certaines planches, archive **CBZ/ZIP** ;
3. **Télécharge une série** : à partir de la page de l'œuvre, repère tous les chapitres et produit **une archive par chapitre** ;
4. reste **modulaire** : toute nouvelle fonctionnalité, nouveau site ou nouveau format s'ajoute sans modifier le noyau.

Site de référence pour les tests : `mangas-origines.fr` (page œuvre `/oeuvre/<slug>/`, page chapitre `/oeuvre/<slug>/chapitre-<n>/`, chapitre décimal `chapitre-129-5`).

## Documents (ordre de lecture conseillé)
| Fichier | Contenu |
|---|---|
| `docs/ARCHITECTURE.md` | Stack, arborescence, couches, contrats (interfaces), messages, manifest |
| `docs/EXTENDING.md` | Comment ajouter un module, un site, un format d'archive, un exporteur |
| `docs/WORKFLOW.md` | Parcours utilisateur et flux techniques (scan, chapitre, série) |
| `docs/REGLES_DE_GESTION.md` | Règles métier numérotées RG-xxx (à citer dans les commits) |
| `docs/SITE_PROFILES.md` | Contrat des adaptateurs de site + profil `mangas-origines` |
| `docs/ARCHIVES.md` | Fabrication des ZIP/CBZ (offscreen document, nommage, ComicInfo) |
| `docs/CONVENTIONS.md` | Style de code, Git, tests |
| `docs/ROADMAP.md` | Jalons et prochaine tâche |

## Stack
- **TypeScript** (strict) — un seul langage pour tout le projet, aucun autre n'est nécessaire
- **esbuild** pour le bundling (sortie dans `dist/`, c'est ce dossier qu'on charge dans le navigateur)
- **fflate** pour fabriquer les ZIP/CBZ
- **Bootstrap 5 (CSS)** embarqué localement ; UI en TypeScript sans framework
- **Vitest** (tests unitaires), **ESLint + Prettier**
- Git / GitHub / VS Code. Cible : Chrome/Edge d'abord, Firefox ensuite.

## Règles impératives
1. **Manifest V3** : Service Worker, pas de background page, pas de code distant, pas d'`eval`.
2. **Permissions minimales** : `activeTab`, `scripting`, `downloads`, `storage`, `offscreen` + `optional_host_permissions` demandées par domaine à la demande. Toute autre permission = à signaler et justifier avant de l'ajouter.
3. **Le Service Worker n'a aucun état en mémoire** : état persistant dans `chrome.storage.session` / `local`. Il peut être arrêté à tout moment.
4. **Le travail lourd (fetch massif d'images, ZIP) se fait dans l'offscreen document**, jamais dans la popup ni dans le Service Worker.
5. **Noyau (`src/core`) indépendant** : il ne connaît ni site ni module concret. Les fonctionnalités sont des **modules** (`src/modules/*`), les sites des **adaptateurs** (`src/adapters/*`), les formats des **packagers** (`src/packagers/*`).
6. **Pas d'import croisé entre modules** : communication par messages typés et services du noyau.
7. Les adaptateurs de site sont des **fonctions pures** testables (le DOM est injecté), sans appel direct à `chrome.*`.
8. `async/await` + `try/catch` partout ; erreurs typées `{ code, message }` ; jamais d'échec silencieux.
9. Jamais d'`innerHTML` avec des données venant d'une page : `textContent` / `createElement`.
10. Aucune donnée envoyée à un serveur tiers, aucun tracking. Pas de contournement de connexion, de paywall ou de captcha.
11. Réponses : droit au but, code d'abord, commentaires concis en français. Signaler toute modification du `manifest.json`.
12. Une tâche = une branche = un commit atomique citant les RG implémentées.

## Définition de « terminé »
- `npm run build` et `npm run lint` sans erreur ; `npm test` vert
- Chargé depuis `dist/` dans `chrome://extensions` sans erreur console
- Règles RG citées respectées ; aucune permission ajoutée sans validation
- Checklist de test manuel de `CONVENTIONS.md` passée
