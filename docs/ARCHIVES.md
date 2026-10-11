# Archives (ZIP / CBZ)

## Pourquoi un offscreen document
En MV3 le Service Worker n'a pas de DOM (pas de `URL.createObjectURL` fiable pour de gros blobs) et la popup se ferme. L'**offscreen document** (`chrome.offscreen.createDocument`, raison `BLOBS`) exécute le fetch des images, assemble l'archive et crée le blob URL. Permission requise : `offscreen`.

## Flux
1. Le bg s'assure que l'offscreen document existe (`chrome.runtime.getContexts` puis `createDocument` si besoin).
2. Il envoie `BUILD_ARCHIVE` `{ pages, packagerId, meta, options }`.
3. `image-fetcher.ts` télécharge les images : concurrence 3, délai max 30 s, 2 ré-essais (1 s, 3 s), `credentials: 'include'`, vérification `Content-Type: image/*` et taille > 0 (RG-306, 307).
4. `archive-builder.ts` ordonne les entrées (`001.ext`…), appelle `packager.pack(...)`.
5. `URL.createObjectURL(blob)` → `blobUrl` renvoyé au bg.
6. Le bg lance `chrome.downloads.download`, attend `complete`, puis demande à l'offscreen de **révoquer** le blob (RG-309).
7. Progression : l'offscreen émet `ARCHIVE_PROGRESS` après chaque image.

## Formats
| Packager | Extension | Notes |
|---|---|---|
| `cbz` (défaut) | `.cbz` | ZIP renommé + `ComicInfo.xml` optionnel |
| `zip` | `.zip` | ZIP standard |
| `folder` | — | images téléchargées individuellement dans `Grandload/<Série>/<Chapitre>/` |
| futurs | `.pdf`, `.epub` | via nouveaux packagers (voir `EXTENDING.md`) |

ZIP via **fflate** en mode `STORE` (niveau 0) : les images (webp/jpg/png) sont déjà compressées.

## Nommage
- Entrées : `001.webp`, `002.webp`… ; remplissage = `max(3, chiffres du total)`.
- Archive : `Grandload/<Série>/<Série> - Chapitre 012.cbz` ; chapitre décimal `129.5` → `Chapitre 129.5`.
- Nettoyage selon RG-32 ; `conflictAction: 'uniquify'`.

## ComicInfo.xml (CBZ)
```xml
<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Series>…</Series>
  <Number>12</Number>
  <Title>…</Title>
  <PageCount>…</PageCount>
  <Web>URL du chapitre</Web>
</ComicInfo>
```
Valeurs échappées (`& < > " '`). Généré par `packagers/comicinfo.ts`.

## Référer (Referer) / protection anti-hotlink
`fetch` ne permet pas de fixer l'en-tête `Referer`. Si un site refuse les images sans Referer :
1. ajouter `declarativeNetRequestWithHostAccess` ;
2. créer une règle dynamique limitée au domaine des images (`modifyHeaders` sur `Referer`) ;
3. documenter la règle dans `SITE_PROFILES.md` et valider l'ajout de permission (RG-604).
Ne pas l'ajouter par précaution.

## Mémoire
- Une seule archive en construction à la fois (RG-308).
- Avertir au-delà de 300 Mo estimés.
- Libérer les références (`Uint8Array`, blob) après le téléchargement.

## Firefox
L'API `offscreen` n'existe pas : prévoir une implémentation de `archive-builder` exécutée dans l'event page (qui a accès au DOM). L'interface `Packager` reste identique ; seul l'hôte d'exécution change.
