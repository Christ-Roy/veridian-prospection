# Prospection — UI Review queue (solo polish)

> File d'attente de polish UI pour Robert en session standalone, hors sprint.
>
> **Workflow** :
> 1. Lire les entrees non cochees
> 2. `cd prospection && npm run dev` (localhost:3001)
> 3. Polish avec Next dev, commit sur `staging`
> 4. Cocher + deplacer en "Reviewed" quand termine

---

## A reviewer

_(vide — pas de livraison UI en attente)_

**Format entree** :

```markdown
### [YYYY-MM-DD] Nom page/composant
- **Contexte** : sprint P1.X, livre par teammate <nom>
- **URL dev** : http://localhost:3001/path
- **URL staging** : https://saas-prospection.staging.veridian.site/path
- **Fichiers** : `prospection/src/app/path/page.tsx`
- **A polish** :
  - [ ] Alignement / spacing
  - [ ] Cohérence couleurs Veridian
  - [ ] Loading / empty / error states
  - [ ] Responsive mobile
- **Notes agent** : ...
```

---

## Reviewed (archive)

_(rien encore reviewe)_
