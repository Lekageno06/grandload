# Profils de site (adaptateurs)

Un adaptateur isole tout ce qui est spécifique à un site. Contrat : voir `ARCHITECTURE.md` §5 (`SiteAdapter`).

## Règles
- **Pur et testable** : reçoit un `Document` (ou une `URL`), renvoie des données ; aucun appel `chrome.*`, aucun `fetch`.
- **Ordre de lecture** : `readChapterPages` renvoie les planches dans l'ordre où le site les affiche.
- **Lazy-loading** : lire `src` puis `data-src`, `data-lazy-src`, `data-original`, `data-srcset`.
- **Erreur claire** si rien n'est reconnu : lever `ADAPTER_STRUCTURE`.
- **Fixtures** : le HTML de référence est sauvegardé dans `tests/fixtures/<site>/` (page série, page chapitre rendue).

## Sélection de l'adaptateur
`getAdapter(url)` renvoie le premier adaptateur dont `matches(url)` est vrai, sinon `generic`.

## Adaptateur générique (repli)
1. Trouver le **conteneur dominant** : élément contenant le plus d'`img` larges (> 300 px) consécutives.
2. Ignorer ce qui est dans `header`, `footer`, `nav`, commentaires, blocs « du même genre / suggestions ».
3. Lister les `img` du conteneur dans l'ordre du DOM.
4. Pour la série : liens dont le chemin contient le chemin de la page courante suivi d'un segment `chapitre|chapter|ch|episode` + numéro.

## Profil `mangas-origines`
Observations (page HTML brute, à confirmer dans DevTools) :
| Élément | Observation |
|---|---|
| Page série | `https://mangas-origines.fr/oeuvre/<slug>/` |
| Page chapitre | `https://mangas-origines.fr/oeuvre/<slug>/chapitre-<n>/` |
| Chapitre décimal | `chapitre-129-5` = chapitre 129.5 |
| Liste de chapitres | tous les liens sont présents dans le HTML même si l'interface n'en montre que 50 (« Voir plus ») |
| Images de chapitre | vides dans le HTML brut → chargées par JavaScript (lazy) |
| Modes de lecture | « Défilement » (webtoon) et « Page par page » (une planche à la fois) ; préférence mémorisée par le site |
| Libellés | peuvent contenir un suffixe (« Chapitre 130 - Début Saison 2 ») |

Implémentation attendue :
```ts
export const mangasOrigines: SiteAdapter = {
  id: 'mangas-origines',
  acquisition: 'live-dom',   // passer à 'html-parse' si les URL d'images sont présentes dans le HTML
  matches: (u) => u.hostname === 'mangas-origines.fr',
  classify: (u) => /\/oeuvre\/[^/]+\/chapitre-[\d-]+\/?$/.test(u.pathname) ? 'chapter'
                 : /\/oeuvre\/[^/]+\/?$/.test(u.pathname) ? 'series' : 'other',
  // readSeries : liens /oeuvre/<slug>/chapitre-<n>/ → ChapterRef (n depuis le slug, 129-5 → 129.5)
  // readChapterPages : <img> du lecteur dans l'ordre du DOM ; src puis data-* ; ignorer logos/avatars
  // prepareChapter : auto-scroll jusqu'à stabilité du nombre de planches (RG-102)
};
```
**Première tâche d'implémentation** : ouvrir un chapitre, repérer dans DevTools le conteneur du lecteur et l'attribut qui porte l'URL réelle des images, puis figer les sélecteurs dans l'adaptateur et la fixture.

## Ajouter un site
Voir `EXTENDING.md`. Checklist : `matches`, `classify`, `readSeries`, `readChapterPages`, `prepareChapter?`, `acquisition`, `autoExclude?`, fixture, tests.
