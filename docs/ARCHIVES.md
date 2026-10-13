# Archives — Grandload

Le Service Worker coordonne les archives mais ne réalise pas le travail lourd. Chrome utilise
`offscreen.html` pour le fetch des images, l'assemblage et les blobs ; Firefox exécute le même
contrat dans sa page d'événement, sans permission `offscreen`.

Les packagers disponibles sont `cbz`, `zip` et `folder`. Les entrées suivent l'ordre des
`PageRef[]`, sont nommées avec un remplissage d'au moins trois chiffres et conservent l'extension
image validée. CBZ ajoute `ComicInfo.xml`.

Le blob est révoqué après livraison ou annulation. Une erreur d'image fait échouer le chapitre et
aucune archive incomplète n'est livrée silencieusement. Les conflits de noms utilisent `uniquify`
pour le navigateur et `(1)`, `(2)`… pour un dossier personnalisé.

La destination active applique le gabarit validé par RG-32. Le mode `ask-each-time` utilise
`chrome.downloads.download({ saveAs: true })` pour une archive unique ; il ne permet pas le
packager `folder`.
