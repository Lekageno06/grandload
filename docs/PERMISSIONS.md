# Audit des permissions

Audit Phase 6, conforme à RG-600. La seule permission ajoutée par la refonte est `sidePanel` côté
Chrome/Edge. Aucune permission n'est ajoutée pour les destinations personnalisées : File System
Access et IndexedDB sont des API de l'origine de l'extension.

| Permission | Fonctionnalité | Pourquoi nécessaire | Alternative écartée |
| --- | --- | --- | --- |
| `activeTab` | Lire l'onglet après action utilisateur | Accès ponctuel et limité | Accès permanent aux sites |
| `scripting` | Injecter le content script et lire le DOM | Les adaptateurs travaillent sur le DOM rendu | Content scripts permanents |
| `downloads` | Télécharger archives, liens et médias | Nommer et dédupliquer les fichiers | Serveur tiers, interdit par RG-602 |
| `storage` | Préférences, jobs, historique et exclusions | Reprise après arrêt du Worker | État mémoire, incompatible MV3 |
| `offscreen` | Archives Chrome et fetch lourds | Le Worker n'héberge pas ce travail lourd | Construire dans l'UI ou le Worker |
| `sidePanel` | Ouvrir `sidepanel.html` dans Chrome/Edge | Interface persistante à côté de l'onglet | Popup, supprimée par la refonte |
| `http://*/*`, `https://*/*` optionnelles | Accès aux domaines demandé sur clic | Lire la page et ses médias après accord | Hôtes fixes larges |

Firefox retire `offscreen` et `sidePanel` de la variante générée, puis utilise `sidebar_action` et
la page d'événement. Il ne demande ni `tabs`, ni `webRequest`, ni cookies, ni DNR.

Les handles de dossier sont conservés dans IndexedDB et ne transitent jamais par
`chrome.runtime.sendMessage` ni vers un tiers.
