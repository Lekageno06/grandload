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

Les sélecteurs et attributs ci-dessous ont été vérifiés dans les captures navigateur `tests/fixtures/mangas-origines/series.html` et `chapter.html`. Ne pas traiter les éléments de la colonne « supposé » comme des observations du site.

| Élément             | Confirmé par fixture                                                                                                                                                                                   | Supposé / non confirmé                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page série          | `/oeuvre/overgeared/`; 323 lignes `.ori-chl-row`, affichées du plus récent au plus ancien. La fixture contient 649 liens et 323 URL de chapitres distinctes.                                           | Le même balisage est utilisé par toutes les œuvres du site.                                                                                                                                                |
| Liens de chapitre   | Chaque ligne contient les liens `.ori-chl-num` et `.ori-chl-corps`; les libellés sont dans `.ori-chl-nom-long` et `.ori-chl-nom-court`. Les actions « Commencer » et « Dernier » sont hors des lignes. | Les mêmes classes sont garanties dans les futurs thèmes du site.                                                                                                                                           |
| Libellés            | Espaces et retours à la ligne peuvent séparer les textes ; le libellé long commence par « Chapitre », le court reprend le numéro sous la forme `Ch.<n>`.                                               | Un suffixe descriptif libre peut apparaître sur d'autres œuvres.                                                                                                                                           |
| Numéros             | Les URL de la fixture sont `/oeuvre/<slug>/chapitre-<n>/`, dont `chapitre-0`.                                                                                                                          | La fixture overgeared ne contient pas de décimal. Le format `chapitre-129-5` est interprété comme 129.5 selon la règle produit et un test de régression.                                                   |
| Lecteur             | `main.ori-lec-scene#ori-lec-scene`, `.reading-content`, `.page-break`, et `img.wp-manga-chapter-img` sont présents ; les images portent des identifiants `image-N` dans l'ordre de lecture.            | Ces sélecteurs restent à confirmer sur les autres modes ou thèmes du site.                                                                                                                                 |
| Source des planches | L'attribut `src` contient l'URL réelle, parfois avec des espaces en début de valeur ; `data-ori-vu` est aussi présent.                                                                                 | `data-src`, `data-lazy-src`, `data-original`, `data-srcset` et `srcset` ne sont pas présents sur les images de lecteur de cette capture. Ils restent des replis de compatibilité, pas des faits confirmés. |
| Mode de lecture     | Les boutons `.ori-lec-mode` portent `data-mode="list"` et `data-mode="paged"`; la capture montre le défilement actif.                                                                                  | La persistance de la préférence pour tous les utilisateurs n'est pas vérifiée par ces seules fixtures.                                                                                                     |

L'adaptateur extrait d'abord les liens `.ori-chl-row a[href]`, identifie les chapitres uniquement par le chemin URL strict, dédoublonne les URL absolues sans fragment et trie les numéros par ordre numérique. Si aucune ligne ne fournit d'URL de chapitre valide, il recherche dans les liens de toute la page. Pour les planches, il utilise le sélecteur confirmé du lecteur et lit les attributs dans l'ordre `src`, puis les replis lazy non confirmés. L'acquisition reste `live-dom` et le pré-scroll ne change pas durablement le mode choisi par l'utilisateur.

## Ajouter un site

Voir `EXTENDING.md`. Checklist : `matches`, `classify`, `readSeries`, `readChapterPages`, `prepareChapter?`, `acquisition`, `autoExclude?`, fixture, tests.
