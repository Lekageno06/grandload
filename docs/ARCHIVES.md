# Archives (ZIP / CBZ)

## Pourquoi un offscreen document

En MV3 le Service Worker n'a pas de DOM (pas de `URL.createObjectURL` fiable pour de gros blobs) et la popup se ferme. L'**offscreen document** (`chrome.offscreen.createDocument`, raison `BLOBS`) exécute le fetch des images, assemble l'archive et crée le blob URL. Permission requise : `offscreen`.

## Flux

1. Le bg s'assure que l'offscreen document existe (`chrome.runtime.getContexts` puis `createDocument` si besoin).
2. Il envoie `BUILD_ARCHIVE` `{ pages, packagerId, meta, options }`.
3. `image-fetcher.ts` télécharge les images : concurrence 3, délai max 30 s, 2 ré-essais (1 s, 3 s), `credentials: 'include'`, vérification `Content-Type: image/*` et taille > 0 (RG-306, 307).
4. `archive-builder.ts` ordonne les entrées (`001.ext`…), appelle `packager.pack(...)`.
5. `URL.createObjectURL(blob)` → `blobUrl` renvoyé au bg.
6. Avant `chrome.downloads.download`, le bg persiste `blob URL → nom demandé` dans `storage.session`. Le listener `downloads.onDeterminingFilename` le consomme et suggère le nom avec `uniquify`. À la fin, le bg compare le nom demandé au `filename` réel renvoyé par `downloads.search`, enregistre un avertissement si nécessaire, puis demande à l'offscreen de **révoquer** le blob (RG-309).
7. Progression : l'offscreen émet `ARCHIVE_PROGRESS` après chaque image.

**Limite Chrome :** si plusieurs extensions proposent un nom pour le même téléchargement, Chrome retient la suggestion de la dernière extension enregistrée. Grandload ne peut donc pas garantir seul le nom final dans un profil où une autre extension intervient après lui ; le job conserve alors le nom réel et affiche un avertissement sans échouer.

## Formats

| Packager       | Extension       | Notes                                                                     |
| -------------- | --------------- | ------------------------------------------------------------------------- |
| `cbz` (défaut) | `.cbz`          | ZIP renommé + `ComicInfo.xml`; blob `application/octet-stream`            |
| `zip`          | `.zip`          | ZIP standard                                                              |
| `folder`       | —               | images téléchargées individuellement dans `Grandload/<Série>/<Chapitre>/` |
| futurs         | `.pdf`, `.epub` | via nouveaux packagers (voir `EXTENDING.md`)                              |

ZIP via **fflate** en mode `STORE` (niveau 0) : les images (webp/jpg/png) sont déjà compressées. Le ZIP standard utilise `application/zip`.

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

L'API `offscreen` n'existe pas : la variante Firefox exécute `archive-builder` dans la page d'événement, qui dispose de `Blob`, `URL.createObjectURL` et de l'interface `Packager`. Le résultat et le cycle de révocation restent identiques ; seul l'hôte d'exécution change.

Écarts connus :

- téléchargements : Firefox accepte `filename` relatif et `conflictAction: 'uniquify'`, mais ses API sont naturellement orientées Promise ; la variante conserve l'interface callback compatible exposée par Firefox ;
- permissions optionnelles : Firefox peut afficher la permission d'hôte dans le gestionnaire des modules complémentaires et l'accord est demandé au clic ; aucun accès hôte permanent n'est ajouté ;
- `downloads.onDeterminingFilename` : le listener est installé seulement si l'événement existe. Sinon Firefox utilise le nom passé directement à `downloads.download`, sans garantie de remplacer le nom qu'un autre gestionnaire imposerait ;
- le manifest Firefox utilise `background.scripts` pour sa page d'événement, tandis que Chrome utilise `background.service_worker` ; `offscreen` est absent du manifest Firefox.

Le polyfill `browser.*` n'est pas nécessaire : Firefox fournit la compatibilité `chrome.*` callback utilisée par le code. Si une API n'est pas disponible, elle est détectée et le comportement de repli est explicite.
