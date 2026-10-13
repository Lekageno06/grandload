# Roadmap — Grandload

## Jalon 0 — Fondations

- [x] Dépôt GitHub, `.gitignore`, `AGENTS.md`, `docs/`
- [x] `package.json`, `tsconfig.json` (strict), `esbuild.config.mjs`, ESLint/Prettier, Vitest
- [x] `public/manifest.json`, `popup.html`, `offscreen.html`, Bootstrap local, icônes
- [x] Popup vide qui s'ouvre depuis `dist/`

## Jalon 1 — Noyau

- [x] `core/types`, `messaging` (bus typé), `registry`, `storage`, `errors`, `logger`
- [x] `permissions` (demande par domaine)
- [x] `popup/main.ts` : monte les modules applicables (onglets)

## Jalon 2 — Module `generic-scan`

- [x] `content` : lecture du DOM (RG-03, 06) ; normalisation et classification (RG-10 à 21)
- [x] Filtres, sélection, badges (RG-23 à 27)
- [x] Téléchargement simple (RG-30 à 35) et exports (RG-40 à 42)

## Jalon 3 — Adaptateurs et module `chapter-download`

- [x] Interface `SiteAdapter` + adaptateur générique + `mangas-origines` (sélecteurs confirmés dans DevTools, fixtures)
- [x] Lecture des planches + auto-scroll (RG-100 à 104)
- [x] Grille d'exclusion (RG-105, 109, 110)

## Jalon 4 — Archives

- [x] Offscreen document, `image-fetcher`, `archive-builder` (RG-305 à 307, 309)
- [x] Packagers `zip`, `cbz` (+ `comicinfo`), `folder` (RG-300 à 304)
- [x] Orchestrateur de jobs + persistance + téléchargement du blob

## Jalon 5 — Module `series-download`

- [x] `readSeries`, tri numérique, plage/cases (RG-200 à 203)
- [x] File de chapitres séquentielle, onglet inactif, délai et backoff (RG-204 à 206)
- [x] Pause/reprise/annulation, historique, récapitulatif (RG-207 à 211)

## Jalon 6 — Confort (v1.1)

- [x] Pré-exclusions et exclusions mémorisées (RG-106, 107)
- [x] `html-parse` si faisable pour mangas-origines (RG-205)
- [x] Préférences, activation/désactivation des modules (RG-503, 704)

## Jalon 7 — Publication

- [x] Variante Firefox (`browser_specific_settings`, archive builder sans offscreen)
- [x] Icônes finales, captures, politique de confidentialité
- [x] Packaging (`npm run zip`)
- [ ] Soumission Chrome Web Store / Edge Add-ons / AMO

## Idées de modules futurs

Détection de doublons de planches · conversion WebP → JPG · fusion/découpe de planches webtoon · surveillance des nouveaux chapitres · export PDF/EPUB · lecteur intégré.

## Prochaine tâche

→ Jalon 0 : initialiser le dépôt, la chaîne de build TypeScript/esbuild et le manifest.
