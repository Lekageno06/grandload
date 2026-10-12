# Roadmap — Grandload

## Jalon 0 — Fondations
- [ ] Dépôt GitHub, `.gitignore`, `AGENTS.md`, `docs/`
- [ ] `package.json`, `tsconfig.json` (strict), `esbuild.config.mjs`, ESLint/Prettier, Vitest
- [ ] `public/manifest.json`, `popup.html`, `offscreen.html`, Bootstrap local, icônes
- [ ] Popup vide qui s'ouvre depuis `dist/`

## Jalon 1 — Noyau
- [ ] `core/types`, `messaging` (bus typé), `registry`, `storage`, `errors`, `logger`
- [ ] `permissions` (demande par domaine)
- [ ] `popup/main.ts` : monte les modules applicables (onglets)

## Jalon 2 — Module `generic-scan`
- [ ] `content` : lecture du DOM (RG-03, 06) ; normalisation et classification (RG-10 à 21)
- [ ] Filtres, sélection, badges (RG-23 à 27)
- [ ] Téléchargement simple (RG-30 à 35) et exports (RG-40 à 42)

## Jalon 3 — Adaptateurs et module `chapter-download`
- [ ] Interface `SiteAdapter` + adaptateur générique + `mangas-origines` (sélecteurs confirmés dans DevTools, fixtures)
- [ ] Lecture des planches + auto-scroll (RG-100 à 104)
- [ ] Grille d'exclusion (RG-105, 109, 110)

## Jalon 4 — Archives
- [x] Offscreen document, `image-fetcher`, `archive-builder` (RG-305 à 307, 309)
- [x] Packagers `zip`, `cbz` (+ `comicinfo`), `folder` (RG-300 à 304)
- [x] Orchestrateur de jobs + persistance + téléchargement du blob

## Jalon 5 — Module `series-download`
- [ ] `readSeries`, tri numérique, plage/cases (RG-200 à 203)
- [ ] File de chapitres séquentielle, onglet inactif, délai et backoff (RG-204 à 206)
- [ ] Pause/reprise/annulation, historique, récapitulatif (RG-207 à 211)

## Jalon 6 — Confort (v1.1)
- [ ] Pré-exclusions et exclusions mémorisées (RG-106, 107)
- [ ] `html-parse` si faisable pour mangas-origines (RG-205)
- [ ] Préférences, activation/désactivation des modules (RG-503, 704)

## Jalon 7 — Publication
- [ ] Variante Firefox (`browser_specific_settings`, archive builder sans offscreen)
- [ ] Icônes finales, captures, politique de confidentialité
- [ ] Packaging (`npm run zip`) et soumission Chrome Web Store / Edge Add-ons / AMO

## Idées de modules futurs
Détection de doublons de planches · conversion WebP → JPG · fusion/découpe de planches webtoon · surveillance des nouveaux chapitres · export PDF/EPUB · lecteur intégré.

## Prochaine tâche
→ Jalon 0 : initialiser le dépôt, la chaîne de build TypeScript/esbuild et le manifest.
