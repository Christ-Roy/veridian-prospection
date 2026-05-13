# Prospection - infra/services/prospection

Compose Git-clean pour la stack Dokploy `compose-connect-redundant-firewall-l5fmki`.

Sprint GitOps Veridian (2026-05-13) : migration provider Raw -> Git. La stack Dokploy
deploie automatiquement ce compose a chaque push sur `main`.

## Layout

```
infra/services/prospection/
  docker-compose.yml   # Compose pinne (image @sha256:...) avec DEPLOY_ENV + healthcheck
  .env.example         # Variables a fournir dans Dokploy UI (Settings > Environment)
  README.md            # Ce fichier
```

## Variables d'environnement

Tous les secrets sont injectes via **Dokploy UI** (jamais commit dans le repo). La
liste exhaustive est dans `.env.example`. Pour ajouter une variable :

1. Editer `.env.example` avec un placeholder
2. Ajouter la cle reelle dans Dokploy stack `prospection` > Environment
3. Redeploy (push sur `main` ou bouton Deploy manuel)

### Cles critiques (rotation = downtime court)

| Variable | Origine | Rotation |
|---|---|---|
| `AUTH_SECRET` | `openssl rand -hex 32` | Manuelle (invalide toutes les sessions Auth.js) |
| `DATABASE_URL` | Postgres `code-prospection-saas-db-1` | Manuelle apres `ALTER USER` |
| `ANON_KEY` / `SERVICE_ROLE_KEY` | Supabase Hub (Dashboard) | Cf doc Supabase |
| `TENANT_API_SECRET` | Genere lors du provisioning Hub | Cf skill `cms-provision` / hub |

## Deploiement

### Production (auto, GitOps)

```bash
# Toute modification = PR -> merge main -> webhook GitHub -> Dokploy redeploy
git checkout -b feat/prospection-<sujet> origin/main
# ... edits ...
git push -u origin feat/prospection-<sujet>
gh pr create --fill && gh pr merge --auto --squash
```

Le webhook GitHub (configure sur la stack Dokploy `prospection`) declenche un
`docker compose up` zero-downtime si le healthcheck `/api/health` passe.

### Blue-green (Lane 2, gros chantier)

Cf `~/Bureau/cc-saas/prompts/applicatif/06-blue-green-procedure.md` (v4 GitOps) :

1. Branche `green/prospection-<feature>` push sur le repo
2. Stack Dokploy `prospection-green` (a creer si absente) pointe sur la branche green
   avec `DEPLOY_ENV=green` + `TRAEFIK_HOST=prospection.green.app.veridian.site`
3. Itere sur la branche green (push = redeploy auto green)
4. Merge la PR green -> main -> redeploy prod automatique
5. Rollback : `git revert -m 1 <merge-sha> && git push origin main`

## Image pinning

L'image `ghcr.io/christ-roy/prospection` est pinnee en SHA digest pour eviter le drift :

```yaml
image: ghcr.io/christ-roy/prospection@sha256:1e6edf83a0a22b...
```

Pour bumper :

1. Identifier le nouveau SHA :
   ```bash
   docker manifest inspect ghcr.io/christ-roy/prospection:staging | jq -r '.config.digest'
   # ou via Dependabot (auto)
   ```
2. Ouvrir une PR qui modifie `docker-compose.yml`
3. CI `prospection-security-cve.yml` valide qu'aucune CVE critical/high n'est introduite
4. Merge -> redeploy auto

## Healthcheck

`GET /api/health` doit retourner `200` en < 5s. Le healthcheck Docker tourne toutes
les 30s avec un grace period de 30s au demarrage. Si 3 echecs consecutifs, Docker
marque le container `unhealthy` (les zero-downtime swaps Dokploy s'arretent et le
swap est annule).

## Smoke test post-deploy

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sf -o /dev/null -w "%{http_code} " https://prospection.app.veridian.site/api/health
done; echo
```

## Liens

- Stack Dokploy : `https://dokploy.veridian.site` -> Project `prospection` ->
  Compose `prospection`
- Container prod actuel : `compose-connect-redundant-firewall-l5fmki-prospection-prod-1`
- DB prod (compose separe) : `code-prospection-saas-db-1`
- App URL : https://prospection.app.veridian.site
- Health : https://prospection.app.veridian.site/api/health
- Runbook GitOps : `runbooks/dokploy-gitops-pattern.md`
