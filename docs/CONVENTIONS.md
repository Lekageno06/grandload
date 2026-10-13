# Conventions — Grandload

## Code
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true` ; pas de `any` (utiliser `unknown` + garde de type)
- Modules ES, `const` par défaut
- Nommage : `camelCase` (variables/fonctions), `PascalCase` (types/classes), `UPPER_SNAKE` (constantes), fichiers en `kebab-case`
- Fonctions courtes à responsabilité unique ; effets de bord isolés (`background/`, `offscreen/`, `content/`)
- Commentaires concis en français, pour le *pourquoi*
- Erreurs : `class GrandloadError { code, message }` ; jamais de `catch` vide
- Dépendances npm : validation requise avant tout ajout (fflate, esbuild, vitest, eslint, prettier, typescript, @types/chrome)

## Interface
- Side Panel responsive (320–700 px), contenu scrollable
- Composants et tokens du design system de `src/ui/`, CSS natif uniquement ; aucune dépendance Bootstrap
- Textes uniquement via `i18n.ts` ; accessibilité (labels, focus clavier, contraste)

## Tests
- Vitest pour : adaptateurs (fixtures HTML), `url-utils`, nommage, tri des chapitres (129.5), packagers, file de jobs
- Les adaptateurs se testent avec `DOMParser`/jsdom sur `tests/fixtures/`
- Pas de test réseau réel ; `fetch` simulé

## Git
- Branches : `feat/…`, `fix/…`, `docs/…` depuis `develop`
- Commits (Conventional Commits, en français), RG citées :
  `feat(chapter): extraction des planches dans l'ordre (RG-101)`
  `fix(archive): padding des noms d'entrées (RG-302)`
- `.gitignore` : `node_modules/`, `dist/`, `*.zip`, `.DS_Store`

## UI Phase 4

- Les composants partagés ne contiennent aucune logique métier : données et callbacks uniquement.
- Les textes visibles passent par `src/sidepanel/i18n.ts`.
- Toute progression ajoute `aria-live` ou un libellé accessible ; les tâches sont annulables.
- Les contrôles utilisent les classes du design system ; aucune règle de secours scoppée sous `.ui-app` n'est autorisée.

## Checklist de test manuel avant PR
- [ ] `npm run build` OK, chargement de `dist/` sans erreur console
- [ ] Mode générique : scan, filtres, export
- [ ] Chapitre : planches dans le bon ordre, exclusion de 2 planches, CBZ lisible dans un lecteur (le nombre de pages = planches incluses)
- [ ] Chapitre avec lazy-loading : toutes les planches détectées
- [ ] Série : liste complète (≥ 150 chapitres), chapitre décimal bien placé (129.5 entre 129 et 130)
- [ ] Série : sélection d'une plage de 3 chapitres → 3 CBZ distincts
- [ ] Pause / reprise / annulation ; fermeture du Side Panel pendant un job
- [ ] Redémarrage forcé du Service Worker pendant un job : reprise
- [ ] Erreur simulée (image 404) : chapitre en échec, pas d'archive incomplète
