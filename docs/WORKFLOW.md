# Workflow — Grandload

## 1. Parcours utilisateur

### A. Mode Chapitre (page `/chapitre-N/`)
```
Ouverture de la popup
   │  détection : kind = chapter (adaptateur du site)
   ▼
Demande d'accès au site (1re fois) ──► chrome.permissions.request
   ▼
Lecture des planches (ordre de lecture) + auto-scroll si lazy-loading
   ▼
Grille de miniatures : numéro, case « inclure », pré-exclusions signalées
   │   actions : tout / aucune / inverser / exclure avant-après ici
   ▼
Choix : format (CBZ défaut · ZIP · dossier), dossier de sortie
   ▼
[Télécharger] ──► job « chapitre » ──► progression ──► fichier dans Téléchargements
```

### B. Mode Série (page `/oeuvre/<slug>/`)
```
Ouverture de la popup
   │  détection : kind = series
   ▼
Liste complète des chapitres (tri numérique, décimaux inclus)
   │   sélection : tout · plage de/à · cases · « non téléchargés seulement »
   ▼
[Télécharger la sélection] ──► job « série » ──► un job « chapitre » par élément
   │   progression globale + par chapitre · pause · reprise · annulation
   ▼
Récapitulatif : réussis / échecs ──► [Relancer les échecs]
```

### C. Mode Générique (toute autre page http/https)
Scan des liens et médias → filtres → sélection → téléchargement, copie ou export TXT/JSON/CSV.

## 2. Flux technique — Chapitre
1. `popup` envoie `PAGE_CONTEXT` ; le bg résout l'adaptateur (`matches` + `classify`).
2. `popup` demande l'accès au domaine si absent (clic utilisateur obligatoire).
3. Le bg injecte `content.js` (`chrome.scripting.executeScript`).
4. `content` : `adapter.prepareChapter` (auto-scroll) puis `adapter.readChapterPages` → `PageRef[]`.
5. `popup` affiche la grille ; l'utilisateur exclut des planches.
6. `JOB_CREATE(kind=chapter)` : le bg persiste le job et s'assure que l'offscreen document existe.
7. `BUILD_ARCHIVE` : l'offscreen télécharge les images (concurrence 3, 2 retries), vérifie les types, assemble l'archive via le packager, crée un `blobUrl`.
8. Le bg appelle `chrome.downloads.download({ url: blobUrl, filename, conflictAction: 'uniquify' })`, attend `onChanged = complete`, révoque le blob, passe le job à `done`.

## 3. Flux technique — Série
1. `READ_SERIES` → `SeriesInfo` (liste de chapitres dédoublonnée et triée).
2. L'utilisateur sélectionne ; `JOB_CREATE(kind=series)` crée un job parent et un job enfant par chapitre (`queued`).
3. L'orchestrateur traite **un chapitre à la fois** :
   - stratégie `live-dom` : ouvre un onglet **inactif** (`chrome.tabs.create({ active:false })`), injecte `content.js`, lit les planches, ferme l'onglet ;
   - stratégie `html-parse` : récupère le HTML, le parse dans l'offscreen (`DOMParser`) et lit les planches sans onglet.
4. Application des exclusions mémorisées (RG-107) ; génération de l'archive comme en §2 (étapes 7-8).
5. Pause de 1,5 s entre chapitres ; backoff exponentiel sur 429/503 (RG-206).
6. Mise à jour de l'historique `history:<série>` à chaque chapitre terminé.
7. Fin : job parent `done` (ou `failed` si tous échouent) et récapitulatif.

## 4. Reprise après arrêt du Service Worker
Chaque transition de job est écrite dans `storage.local`. Au réveil (`onStartup`, message, événement `downloads`), l'orchestrateur relit les jobs `running`, les repasse en `queued` et reprend au chapitre non terminé.

## 5. Cas limites
- Page non scannable (`chrome://`, store, `file://`) : message clair (RG-01)
- Permission de domaine refusée : explication + bouton pour réessayer
- Chapitre sans image / en cours de publication : alerte, pas d'archive (RG-109, RG-210)
- Mode « page par page » du site : l'adaptateur lit toutes les planches sans modifier durablement la préférence de l'utilisateur (RG-103)
- Image en échec après retries : chapitre en échec, pas d'archive incomplète silencieuse (RG-306)
- Popup fermée : les jobs continuent ; l'état est visible à la réouverture
- Plus de 20 chapitres sélectionnés : confirmation (RG-211)

## 6. Branches Git
`main` (stable) ← `develop` ← `feat/<sujet>`, `fix/<sujet>`, `docs/<sujet>`
