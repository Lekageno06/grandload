# Étendre Grandload

Principe : **ajouter une capacité = ajouter un fichier + une ligne d'enregistrement**. Aucune modification de `src/core`.

## Ajouter un site (adaptateur)
1. Créer `src/adapters/<site>.ts` implémentant `SiteAdapter` (voir `SITE_PROFILES.md`).
2. L'enregistrer dans `src/adapters/index.ts` : `registerAdapter(monSite)`.
3. Écrire `tests/adapters/<site>.test.ts` avec un **HTML de référence** (fixture) sauvegardé dans `tests/fixtures/<site>/`.
4. Aucun changement dans les modules : ils appellent l'adaptateur via le registre.

## Ajouter un format d'archive (packager)
1. Créer `src/packagers/<format>.ts` implémentant `Packager` (`id`, `extension`, `pack`).
2. L'enregistrer dans `src/packagers/index.ts`.
3. Il apparaît automatiquement dans la liste des formats de la popup.
Exemples de formats futurs : PDF, EPUB, dossier d'images.

## Ajouter une fonctionnalité (module)
1. Créer `src/modules/<nom>/` avec `index.ts` exportant un `GrandloadModule`.
2. `canHandle(ctx)` décide quand le module est proposé (ex. page série uniquement).
3. `mountPopup` construit la vue ; `registerBackground` déclare ses handlers de messages.
4. Enregistrer dans `src/modules/index.ts`.
5. Déclarer dans `requiredPermissions` toute permission nécessaire et la signaler dans la PR.
6. Ajouter les RG correspondantes dans `docs/REGLES_DE_GESTION.md`.

Idées de modules futurs : détection de doublons de planches, conversion WebP → JPG, découpage/fusion de planches webtoon, OCR, surveillance des nouveaux chapitres, export vers un NAS, lecteur intégré.

## Ajouter une étape au pipeline
Les étapes (extraction, filtre, acquisition, empaquetage) sont des fonctions `(input) => Promise<output>` composées par l'orchestrateur. Insérer une étape = l'ajouter à la liste ordonnée du job concerné dans `orchestrator.ts`.

## Ajouter une préférence
1. Ajouter la clé au type `Prefs` dans `core/storage.ts` avec une valeur par défaut.
2. Lire via `getPrefs()` ; ne jamais lire `chrome.storage` directement depuis un module.

## Check-list d'une extension réussie
- [ ] Aucun fichier de `src/core` modifié (sinon, justifier)
- [ ] Aucune dépendance entre deux modules
- [ ] Tests unitaires + fixture
- [ ] RG et docs mises à jour
- [ ] Permission supplémentaire = signalée
