# Workflow — Grandload

## Parcours utilisateur

Le Side Panel détecte le contexte de l'onglet, demande l'accès au domaine uniquement après clic,
puis affiche le module générique, chapitre ou série applicable. La zone Tâches reste accessible
pendant les changements d'onglet.

Pour un chapitre : lecture DOM via l'adaptateur, galerie ordonnée, pré-exclusions visibles,
sélection, feuille de téléchargement, job persistant, archive puis livraison par la destination.

Pour une série : lecture de la liste complète, sélection de chapitres, confirmation si nécessaire,
création d'un job parent et d'un job enfant par chapitre, progression globale, pause/reprise,
annulation, historique et récapitulatif.

Pour le scan générique : collecte unique via `src/content/dom-reader.ts`, badges de provenance,
filtres, sélection, exports TXT/JSON/CSV et téléchargement des médias choisis.

## Flux technique

1. Le Side Panel envoie `PAGE_CONTEXT`; le Worker résout l'adaptateur.
2. Le content script lit les pages via `dom-reader.ts` et l'adaptateur sans collecte parallèle.
3. `JOB_CREATE` persiste le job dans `chrome.storage.local`.
4. Chrome construit l'archive dans l'offscreen ; Firefox utilise la page d'événement.
5. Le packager produit ZIP, CBZ ou fichiers ; la destination applique le gabarit.
6. Un job personnalisé vérifie `queryPermission`; sinon il passe à `needs-permission`.
7. Le Worker publie la progression, attend la fin, révoque les blobs et écrit l'historique.

## Reprise et erreurs

Chaque transition est persistée. Au redémarrage du Worker, les jobs interrompus sont relus et
repris ou marqués en échec selon leur dernière étape. Une erreur d'image ou de destination ne
produit jamais d'archive incomplète silencieuse.
