# Audit des permissions

Audit réalisé pour le Jalon 7 (RG-600 à RG-605). Aucune permission non documentée n'est ajoutée.

| Permission | Fonctionnalité qui l'utilise | Pourquoi nécessaire | Alternative écartée |
| --- | --- | --- | --- |
| `activeTab` | Lecture de l'onglet actif depuis la popup et injection ponctuelle | Limiter l'accès à l'action explicitement déclenchée par l'utilisateur | `host_permissions` permanentes, plus larges et non nécessaires |
| `scripting` | Injection de `content.js` et lecture du DOM du chapitre/de la série | Les adaptateurs doivent lire le DOM rendu | Content scripts permanents, qui augmenteraient l'accès aux pages |
| `downloads` | Téléchargement des archives, fichiers et liens sélectionnés | Créer les téléchargements avec un nom et `uniquify` | Téléchargement via un serveur tiers, interdit par RG-602 |
| `storage` | Préférences, jobs, historique, exclusions et état de reprise | Persister l'état malgré l'arrêt du worker/event page | État mémoire, incompatible avec la durée de vie MV3 |
| `offscreen` (Chrome uniquement) | `offscreen.html` et `src/offscreen/archive-builder.ts` | Déporter les fetch massifs, blobs et ZIP hors du Service Worker | Construire dans la popup ou le Service Worker, fragile et contraire à RG-305 |
| `http://*/*`, `https://*/*` dans `optional_host_permissions` | Accès ponctuel au domaine de la page et aux images sélectionnées | Demander l'accès au domaine au clic, conformément à RG-600 | Accès fixe à tous les sites, refusé pour minimiser les privilèges |

| `sidePanel` (Chrome/Edge uniquement) | Ouvrir `sidepanel.html` à côté de l’onglet depuis l’icône d’action | Remplacer la popup par le panneau latéral persistant | `action.default_popup`, trop petit et fermé lors des changements d’onglet |

## Permissions inutiles

L'audit du code ne relève aucune permission fixe inutilisée. `offscreen` est utile dans le paquet Chrome, mais n'est pas déclarée dans le manifest Firefox : Firefox exécute le même contrat de packager dans sa page d'événement.

Le manifest Firefox conserve les cinq permissions communes et les mêmes permissions d'hôtes optionnelles. Il ne demande ni `tabs`, ni `webRequest`, ni `cookies`, ni `declarativeNetRequestWithHostAccess`, car aucune fonctionnalité ne les utilise.

Les permissions d'hôtes sont demandées uniquement après l'action de l'utilisateur, par origine. Grandload ne demande pas d'accès aux cookies, ne modifie pas les requêtes et ne contourne aucune protection.
