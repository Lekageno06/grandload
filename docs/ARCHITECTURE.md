# Architecture — Grandload

## Principes

Grandload est une extension MV3 modulaire. Le Side Panel fournit l'interface, le content script
lit le DOM de la page, le Service Worker orchestre les jobs et l'offscreen Chrome effectue les
fetch massifs et la construction des archives. Firefox utilise la variante sans offscreen.

Le noyau (`src/core`) reste indépendant des sites, modules et formats. Les adaptateurs sont purs,
les modules communiquent par messages typés et les packagers produisent ZIP, CBZ ou dossiers.

## Stack et build

TypeScript strict, esbuild, fflate, CSS natif du design system et Vitest. Aucun framework UI,
Bootstrap ou CDN n'est utilisé. `npm run build` produit les variantes Chrome et Firefox dans
`dist/`, sans sourcemaps.

## Arborescence

```text
public/
  manifest.json       Manifest Chrome source
  sidepanel.html      Interface Chrome et Firefox
  offscreen.html      Document Chrome pour les archives
  icons/              Icônes 16, 32, 48, 128
src/
  core/               Types, messages, registre, stockage, erreurs
  sidepanel/          Coquille, vues, i18n et suivi de l'onglet
  ui/                 Tokens, base, icônes et composants partagés
  content/            dom-reader partagé et lecture des adaptateurs
  modules/            generic-scan, chapter-download, series-download, preferences
  adapters/           Adaptateurs de sites, dont mangas-origines
  destinations/       browser, custom-folder, ask-each-time, gabarits et picker
  background/         Service Worker et orchestrateurs de jobs
  offscreen/          image-fetcher, archive-builder et écriture custom-folder
  packagers/          zip, cbz et folder
tests/                Tests unitaires et fixtures DOM
```

Il n'existe plus de `src/popup/`. La collecte DOM est centralisée dans `src/content/dom-reader.ts`
et les adaptateurs ; aucun module ne collecte directement les images.

## Messages principaux

| Message | Sens | Fonction |
| --- | --- | --- |
| `PAGE_CONTEXT` | Side Panel → Worker | Résoudre l'onglet et l'adaptateur |
| `READ_CHAPTER_PAGES` | Worker → Content | Lire les planches via l'adaptateur |
| `READ_SERIES` | Worker → Content | Lire les chapitres |
| `JOB_CREATE` | Side Panel → Worker | Créer un job persistant |
| `JOB_CONTROL` | Side Panel → Worker | Pause, reprise, annulation, relance |
| `BUILD_ARCHIVE` | Worker → Offscreen | Construire une archive |
| `WRITE_CUSTOM_FILES` | Worker → Offscreen | Écrire dans un dossier choisi |
| `ARCHIVE_PROGRESS` | Offscreen → Worker | Publier la progression |

Toutes les réponses ont la forme `{ ok, data?, error?: { code, message } }`.

## Jobs et stockage

Les états sont `queued`, `running`, `paused`, `needs-permission`, `done`, `failed`, `ignored` et
`cancelled`. Les jobs et préférences sont persistés dans `chrome.storage.local`; les états de
session sont dans `chrome.storage.session`.

Les handles File System Access sont stockés dans IndexedDB de l'origine de l'extension. Ils ne
sont jamais transmis par `chrome.runtime.sendMessage` ni envoyés à un serveur. Avant une tâche
personnalisée, `queryPermission` est vérifié. Une permission à renouveler produit
`needs-permission` et attend un clic explicite sur « Autoriser à nouveau ».

## Destinations

`src/destinations/types.ts` définit `DestinationSettings` et `DestinationWriter`. Le registre est
dans `registry.ts`; `template.ts` valide RG-32 et développe `{serie}`, `{chapitre}`, `{domaine}`,
`{titre}` et `{date}`. `browser.ts` utilise `chrome.downloads`, `custom-folder.ts` utilise File
System Access et IndexedDB, et `picker.ts` est partagé par les feuilles de téléchargement.

Le mode navigateur conserve `onDeterminingFilename`. Le mode personnalisé crée les sous-dossiers,
ajoute `(1)`, `(2)` en cas de conflit et ne laisse pas de fichier partiel. Le mode demander à
chaque fois utilise `saveAs: true` pour une archive unique ; le format dossier y est refusé.

## Manifest et permissions

Chrome déclare `sidePanel` et utilise `side_panel.default_path`. Firefox retire `sidePanel` et
`offscreen`, puis génère `sidebar_action`, `browser_specific_settings` et une page d'événement.
Les permissions fixes restent `activeTab`, `scripting`, `downloads`, `storage`, `offscreen` et
`sidePanel` côté Chrome, avec les hôtes optionnels demandés par domaine au clic. Aucune permission
supplémentaire n'est utilisée.

Le code d'interface ne dépend pas de `chrome.sidePanel`; seule l'amorce du Service Worker l'utilise.
