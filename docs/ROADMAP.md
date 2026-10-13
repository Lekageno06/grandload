# Roadmap — Grandload

## Jalons réalisés

- [x] Jalon 0 — Fondations, Manifest V3, build et tests
- [x] Jalon 1 — Noyau, registre, stockage, messagerie et permissions minimales
- [x] Jalon 2 — Scan générique, filtres, sélection et exports
- [x] Jalon 3 — Adaptateurs, chapitre et lecture des planches
- [x] Jalon 4 — Archives ZIP/CBZ/dossier et orchestration persistante
- [x] Jalon 5 — Séries, progression, pause, reprise, historique et backoff
- [x] Jalon 6 — Pré-exclusions, préférences et stratégies d'acquisition
- [x] Jalon 7 — Publication Chrome/Firefox, confidentialité et packaging
- [x] Jalon 8 — Refonte UI : Side Panel, design system, galerie et destinations
- [x] Phase 6 — Documentation et nettoyage de la refonte UI

## État de la refonte

- Interface : `src/sidepanel/` et `src/ui/`, CSS natif sans Bootstrap.
- Collecte : source unique dans `src/content/dom-reader.ts` et les adaptateurs.
- Destinations : navigateur, dossier personnalisé et demander à chaque fois dans `src/destinations/`.
- Firefox : manifest généré avec `sidebar_action`, sans `offscreen` ni `sidePanel`.
- Permissions : aucune permission supplémentaire à `sidePanel` côté Chrome/Edge.

## Prochaines évolutions facultatives

Détection de doublons, conversion WebP/JPG, fusion/découpe de planches, surveillance de chapitres,
exports PDF/EPUB et lecteur intégré.
