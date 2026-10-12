# Checklist de publication

## Qualité technique

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run zip`
- [ ] Les deux archives de `release/` sont présentes et lisibles.
- [ ] Aucun test, fixture, document ou sourcemap ne figure dans une archive.
- [ ] Les icônes 16, 32, 48 et 128 sont présentes dans chaque archive.
- [ ] La version du manifest est la version de publication attendue.
- [ ] Le manifest Chrome se charge dans `chrome://extensions` sans erreur console.
- [ ] Le manifest Firefox se charge dans `about:debugging` sans erreur console.

## Permissions et confidentialité

- [ ] `docs/PERMISSIONS.md` est à jour.
- [ ] Aucune permission non auditée n'a été ajoutée.
- [ ] Les permissions d'hôtes sont demandées au clic et par domaine.
- [ ] `docs/PRIVACY.md` est à jour.
- [ ] Aucun tracking, appel tiers ou code distant n'est présent.
- [ ] Aucun texte ne présente Grandload comme un contournement de connexion, paywall ou captcha.

## Tests manuels

- [ ] Mode générique : scan, filtres, export.
- [ ] Chapitre : ordre de lecture, exclusion de deux planches, CBZ lisible.
- [ ] Chapitre lazy-loading : toutes les planches sont détectées.
- [ ] Série : liste complète et tri décimal correct (`129.5` entre `129` et `130`).
- [ ] Série : plage de trois chapitres produit trois archives distinctes.
- [ ] Pause, reprise, annulation et fermeture de la popup.
- [ ] Redémarrage forcé du contexte d'arrière-plan pendant un job.
- [ ] Erreur d'image : chapitre en échec, aucune archive incomplète.
- [ ] Firefox : archive créée sans `offscreen`, téléchargement et révocation testés.
- [ ] Popup : message d'usage responsable visible dans les préférences.

## Store

- [ ] Captures fictives ou libres de droits uniquement.
- [ ] Description neutre sans nom de site ni de série.
- [ ] Respect des droits d'auteur et des conditions des sites rappelé dans la fiche.
