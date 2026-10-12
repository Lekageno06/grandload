# Politique de confidentialité — Grandload

Grandload fonctionne localement dans le navigateur. Aucune donnée n'est envoyée à un serveur tiers, aucun compte n'est requis et aucun outil de suivi ou de télémétrie n'est intégré (RG-602).

## Données conservées localement

- `storage.local.prefs` : format, concurrence, délai, dossier de destination, stratégie d'acquisition, pré-exclusions et activation des modules ;
- `storage.local.jobs` : progression et état des jobs ;
- `storage.local.history:<série>` : chapitres terminés ;
- `storage.local.exclusions:<adaptateur>` : suggestions d'exclusions mémorisées ;
- `storage.session.runtime` : état temporaire de l'exécution ;
- `storage.session.requestedDownloadNames` : association temporaire entre un blob et son nom de téléchargement ;
- `storage.session.seriesTemporaryTabLock` : verrou temporaire d'un job de série.

Les images, archives et fichiers téléchargés sont enregistrés dans le dossier choisi par l'utilisateur via l'API de téléchargements du navigateur. Grandload ne les téléverse pas.

## Effacement

L'historique et les jobs peuvent être effacés depuis le module concerné. Les préférences et exclusions peuvent être réinitialisées depuis les réglages du navigateur, dans les données stockées par l'extension. La désinstallation de Grandload supprime ses données locales selon le comportement du navigateur. Les fichiers déjà téléchargés doivent être supprimés séparément par l'utilisateur.

Grandload respecte RG-601, RG-602 et RG-603 : pas de code distant, pas de tracking et affichage des données de page par nœuds DOM sûrs.
