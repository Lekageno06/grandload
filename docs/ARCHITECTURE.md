# Architecture — Grandload

## 1. Principes
- **Noyau minimal + modules enfichables** : le noyau fournit messagerie, registre, stockage, file de tâches, permissions. Les fonctionnalités vivent dans des modules.
- **Trois points d'extension** : *module* (fonctionnalité + vue popup), *adaptateur* (spécificités d'un site), *packager* (format de sortie).
- **Pipeline** : `Détecter → Extraire → Filtrer/Sélectionner → Acquérir → Empaqueter → Livrer`. Chaque étape est remplaçable.
- **Séparation des exécutions** : popup (UI), content script (DOM de la page), service worker (coordination), offscreen document (travail lourd).

## 2. Stack et build
- TypeScript strict, esbuild, fflate, Bootstrap CSS local, Vitest.
- esbuild produit 4 bundles IIFE dans `dist/` : `service-worker.js`, `content.js`, `offscreen.js`, `popup.js`. `public/` est copié tel quel (manifest, HTML, CSS, icônes).
- Scripts npm : `dev` (watch), `build`, `lint`, `test`, `zip` (archive pour publication).
- On charge **`dist/`** en « extension non empaquetée ».

## 3. Arborescence
```
grandload/
├── AGENTS.md
├── docs/                        # cette documentation
├── package.json  tsconfig.json  esbuild.config.mjs
├── public/
│   ├── manifest.json
│   ├── popup.html  offscreen.html
│   ├── vendor/bootstrap.min.css
│   └── icons/                   # 16, 32, 48, 128
├── src/
│   ├── core/                    # NOYAU (aucune dépendance à un site/module)
│   │   ├── types.ts             # types partagés (PageContext, Item, Job…)
│   │   ├── messaging.ts         # bus de messages typé (popup/bg/content/offscreen)
│   │   ├── registry.ts          # registres : modules, adaptateurs, packagers
│   │   ├── job-queue.ts         # file de jobs persistante, pause/reprise/annulation
│   │   ├── storage.ts           # accès typé à chrome.storage
│   │   ├── permissions.ts       # demande de host permissions par domaine
│   │   ├── errors.ts            # codes d'erreur
│   │   └── logger.ts
│   ├── modules/                 # FONCTIONNALITÉS (un dossier = un module)
│   │   ├── generic-scan/        # scan liens/médias, filtres, export TXT/JSON/CSV
│   │   ├── chapter-download/    # planches d'un chapitre + exclusion + archive
│   │   └── series-download/     # liste des chapitres + file de chapitres
│   ├── adapters/                # SITES (un fichier = un site)
│   │   ├── types.ts             # interface SiteAdapter
│   │   ├── generic.ts           # repli heuristique
│   │   ├── mangas-origines.ts
│   │   └── index.ts             # enregistrement des adaptateurs
│   ├── packagers/               # FORMATS DE SORTIE
│   │   ├── types.ts             # interface Packager
│   │   ├── zip.ts  cbz.ts  folder.ts
│   │   └── comicinfo.ts         # génération de ComicInfo.xml
│   ├── background/
│   │   ├── service-worker.ts    # point d'entrée : listeners uniquement
│   │   ├── orchestrator.ts      # machine d'états des jobs (chapitre/série)
│   │   └── downloads.ts         # wrapper chrome.downloads
│   ├── offscreen/
│   │   ├── offscreen.ts         # point d'entrée du document offscreen
│   │   ├── image-fetcher.ts     # fetch d'images (concurrence, retries)
│   │   └── archive-builder.ts   # assemble l'archive via un packager
│   ├── content/
│   │   ├── content.ts           # point d'entrée injecté
│   │   ├── dom-reader.ts        # lecture du DOM (images, liens)
│   │   └── scroll-loader.ts     # auto-scroll pour déclencher le lazy-loading
│   ├── popup/
│   │   ├── main.ts              # monte le module applicable
│   │   ├── components/          # briques UI réutilisables (Bootstrap)
│   │   └── i18n.ts              # textes centralisés (fr)
│   └── shared/                  # utilitaires purs (url, filename, number, sleep)
└── tests/                       # miroir de src/ (Vitest)
```

## 4. Les trois exécutions
| Contexte | Rôle | Interdit |
|---|---|---|
| **Popup** | Afficher, sélectionner, lancer des jobs | Travail lourd, source de vérité de l'état |
| **Content script** | Lire le DOM, auto-scroll, renvoyer des données brutes | `chrome.downloads`, état durable |
| **Service Worker** | Coordonner : file de jobs, onglets temporaires, téléchargements, persistance | DOM, état en mémoire, ZIP |
| **Offscreen document** | Fetch des images, construction d'archive, création du blob | Accès aux onglets |

Le Service Worker peut être arrêté : l'état des jobs est écrit dans `chrome.storage` à chaque transition et relu au réveil.

## 5. Contrats (interfaces TypeScript)
```ts
// core/types.ts
export type PageKind = 'chapter' | 'series' | 'other';

export interface PageContext {
  url: string;
  kind: PageKind;
  adapterId: string;      // adaptateur retenu
  tabId: number;
}

// modules : une fonctionnalité enfichable
export interface GrandloadModule {
  id: string;                          // ex. "chapter-download"
  title: string;                       // texte de l'onglet
  priority: number;                    // plus grand = proposé en premier
  canHandle(ctx: PageContext): boolean;
  mountPopup(root: HTMLElement, ctx: PageContext, api: ModuleApi): void;
  registerBackground?(router: MessageRouter): void;
  requiredPermissions?: string[];      // documentation + vérification
}

// adapters/types.ts : un site
export interface SiteAdapter {
  id: string;                          // ex. "mangas-origines"
  matches(url: URL): boolean;
  classify(url: URL): PageKind;
  readSeries(doc: Document): SeriesInfo;                 // titre + chapitres
  readChapterPages(doc: Document): PageRef[];            // planches dans l'ordre
  prepareChapter?(doc: Document): Promise<void>;         // ex. auto-scroll
  acquisition: 'live-dom' | 'html-parse';                // stratégie série
  autoExclude?(page: PageRef): string | null;            // raison d'exclusion
}

// packagers/types.ts : un format de sortie
export interface Packager {
  id: string;                          // "cbz" | "zip" | "folder"
  extension: string;                   // ".cbz"
  pack(entries: ArchiveEntry[], meta: ArchiveMeta): Promise<Blob>;
}

export interface PageRef { index: number; url: string; ext: string; width?: number; height?: number }
export interface ChapterRef { number: number; label: string; url: string }
export interface SeriesInfo { title: string; chapters: ChapterRef[] }
export interface ArchiveEntry { name: string; data: Uint8Array }
export interface ArchiveMeta { series: string; chapter: ChapterRef; pageCount: number; sourceUrl: string }
```

## 6. Registres
`core/registry.ts` expose `registerModule`, `registerAdapter`, `registerPackager` et leurs `get/list`. Les points d'entrée (`popup/main.ts`, `service-worker.ts`) importent un fichier `index.ts` par famille qui enregistre tout ce qui existe. **Ajouter un élément = un fichier + une ligne d'enregistrement** (voir `EXTENDING.md`).

## 7. Messages (bus typé)
| `type` | Sens | Payload | Réponse |
|---|---|---|---|
| `PAGE_CONTEXT` | popup → bg | `{ tabId }` | `PageContext` |
| `READ_CHAPTER_PAGES` | bg/popup → content | `{ adapterId }` | `PageRef[]` |
| `READ_SERIES` | bg/popup → content | `{ adapterId }` | `SeriesInfo` |
| `JOB_CREATE` | popup → bg | `{ kind, params }` | `{ jobId }` |
| `JOB_CONTROL` | popup → bg | `{ jobId, action: pause\|resume\|cancel\|retry }` | `{ ok }` |
| `JOB_UPDATE` | bg → popup | `{ jobId, state, progress, error? }` | — |
| `BUILD_ARCHIVE` | bg → offscreen | `{ pages, packagerId, meta, options }` | `{ blobUrl, size }` |
| `ARCHIVE_PROGRESS` | offscreen → bg | `{ jobId, done, total }` | — |

Toutes les réponses ont la forme `{ ok: boolean, data?, error?: { code, message } }`.

## 8. Modèle de job
```ts
type JobState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
interface Job {
  id: string;
  kind: 'chapter' | 'series' | 'links';
  state: JobState;
  params: unknown;            // propre au module
  children?: string[];        // série → jobs chapitre
  progress: { done: number; total: number };
  error?: { code: string; message: string };
  createdAt: number;
}
```
Persisté dans `chrome.storage.local` (`jobs`) ; l'historique des chapitres téléchargés dans `history:<série>`.

## 9. manifest.json (cible)
```json
{
  "manifest_version": 3,
  "name": "Grandload",
  "version": "0.1.0",
  "description": "Extrait, filtre et télécharge liens, médias et chapitres de webtoons/mangas.",
  "permissions": ["activeTab", "scripting", "downloads", "storage", "offscreen"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "action": { "default_popup": "popup.html", "default_title": "Grandload" },
  "background": { "service_worker": "service-worker.js" },
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```
- Pas de `content_scripts` ni de `host_permissions` fixes : injection par `chrome.scripting`, accès aux domaines demandé à la demande (`chrome.permissions.request`, déclenché par un clic).
- `declarativeNetRequestWithHostAccess` n'est ajouté **que** si un site exige un en-tête `Referer` (voir `ARCHIVES.md`).
- Firefox : prévoir `browser_specific_settings` et une variante sans `offscreen` (jalon final).

## 9 bis. Panneau latéral et `activeTab`

Chrome/Edge ouvrent `sidepanel.html` via `chrome.sidePanel.setPanelBehavior` dans le bootstrap du Service Worker. Le code de l’interface ne dépend pas de `chrome.sidePanel`. La variante Firefox utilise `sidebar_action` avec la même page.

Le panneau ne demande ni `tabs` ni hôtes fixes. Il lit l’onglet actif lorsque son URL est exposée par `tabs.query`; sinon il affiche « Cliquez sur l’icône Grandload pour analyser cet onglet » sans bouton d’autorisation. Lorsque l’origine est connue mais que le contexte n’est pas accessible, un clic utilisateur peut demander uniquement `<origine>/*` via `chrome.permissions.request`.

Le comportement exact doit être vérifié manuellement dans Chrome/Edge :

1. Charger `dist/`, ouvrir le panneau avec l’icône Grandload sur une page HTTP/HTTPS, puis noter si le domaine et les modules apparaissent.
2. Sans fermer le panneau, changer d’onglet vers une page autorisée puis vers une page non autorisée ; noter si `tab.url` et le contexte se mettent à jour.
3. Sur l’onglet non autorisé dont l’URL est visible, cliquer « Autoriser sur ce site » et vérifier que seule son origine est demandée.
4. Cliquer l’icône Grandload alors que le panneau est déjà ouvert, puis vérifier si l’onglet courant récupère `activeTab` et si le contexte apparaît.
5. Naviguer ou recharger l’onglet autorisé, puis répéter après fermeture/réouverture du panneau ; noter si l’accès persiste et transmettre les résultats avant d’envisager un panneau par onglet.

## 10. Stockage
| Zone | Clé | Contenu |
|---|---|---|
| `storage.session` | `runtime` | état volatil (offscreen ouvert, onglet temporaire) |
| `storage.local` | `jobs` | file de jobs |
| `storage.local` | `history:<seriesId>` | chapitres déjà téléchargés |
| `storage.local` | `prefs` | préférences (format, concurrence, délais, modules actifs) |
| `storage.local` | `exclusions:<adapterId>` | règles d'exclusion mémorisées |
