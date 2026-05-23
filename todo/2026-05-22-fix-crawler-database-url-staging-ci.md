# [PROSPECTION] Fix câblage crawler post-deploy staging — DATABASE_URL manquant

> **Type** : Dette CI / bug workflow
> **Sévérité** : 🟡 P1 — la CI staging affiche rouge sur le smoke crawler depuis
>   la migration helper Auth.js v5 (2026-05-22, commit `ce5b56f`), alors que
>   le déploiement et l'app sont réellement sains. Faux signal de fiabilité.
> **Owner** : agent Prospection
> **Créé** : 2026-05-22

## Symptôme

Depuis le push staging `8516810` (run https://github.com/Christ-Roy/veridian-prospection/actions/runs/26315553114), le job `Smoke test staging` → step `Run dashboard crawler (chromium only, post-deploy)` échoue toutes les tentatives (initial + 2 retries × 7 specs `dashboard-crawler.spec.ts`) avec :

```
Error: [e2e/auth] DATABASE_URL absent — impossible de seeder le compte canonique.
Le helper NE skippe PLUS en silence (cf migration Auth.js v5).
Exporte DATABASE_URL pointant sur la DB de l'app ciblée par PROSPECTION_URL.
   at helpers/auth.ts:87
```

## Cause

L'agent `e2e-fix` a réécrit `e2e/helpers/auth.ts` pour migrer de Supabase GoTrue (mort) vers Auth.js v5 + Prisma (commit `ce5b56f`). Le nouveau comportement, **voulu et documenté**, lève une exception si `DATABASE_URL` n'est pas posée — fini les `test.skip()` silencieux qui masquaient 11 specs E2E.

Mais le step crawler du workflow `prospection-deploy-staging.yml` (l.289-295) ne passe **pas** `DATABASE_URL`, il ne passe que les vieux secrets Supabase (`STAGING_SUPABASE_*`) qui ne servent plus à rien depuis la migration :

```yaml
- name: Run dashboard crawler (chromium only, post-deploy)
  env:
    PROSPECTION_URL: https://${{ env.STAGING_HOST }}
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}
  run: npx playwright test e2e/dashboard-crawler.spec.ts --project=chromium
```

## Difficulté

Le secret `STAGING_DATABASE_URL` (utilisé par le step `Run prisma migrate deploy`) pointe sur `postgres-staging:5432` (DNS Docker interne du réseau `staging-edge` sur dev-pub). **Non résolvable depuis le runner GitHub Actions** même avec le Tailscale connecté (le DNS Docker n'est pas exporté hors du host).

Donc on ne peut PAS juste ajouter `DATABASE_URL` au step crawler tel quel.

## Solutions possibles

**Option A — SSH dev-pub + container Playwright (recommandée)**
Faire tourner le crawler dans un container `mcr.microsoft.com/playwright` sur dev-pub, sur le réseau `staging-edge` (résout `postgres-staging` ET `http://ui-dev:3100` ou `prospection-staging:3000`). Modèle déjà utilisé par `e2e-fix` localement (cf `docker run --network staging-edge`). Plus rapide aussi (pas de Tailscale latency).

**Option B — Hostname public + exposer postgres-staging**
Exposer le port postgres-staging via Tailscale (déjà MagicDNS). Risque : exposition supplémentaire d'un service DB.

**Option C — Tunnel SSH local-forward sur le runner**
Le runner SSH dev-pub avec port-forward `5432:postgres-staging:5432`, puis utilise `DATABASE_URL=postgresql://...@localhost:5432/...`. Moins propre, dépend du timing.

**Reco : Option A.** Le pattern existe déjà côté Veridian (cf `e2e-fix` qui faisait exactement ça pour ses validations locales).

## Pourquoi P1 et pas P0

- L'app staging est **réellement déployée et saine** : `/api/health`, `/api/auth/providers`, `/login` → 200. Migration Prisma 0017 (welcome_plan) appliquée. SHA `85168106` actif.
- Le smoke pré-crawler du workflow lui-même est vert (les 3 checks HTTP basiques passent avant le crawler).
- Le crawler validait des invariants UI dashboard ; la couverture est complémentaire avec le pattern source-level introduit aujourd'hui par `tests-coverage` (commit `8516810`) qui exerce les mêmes composants en unit.
- Mais la CI rouge sur tous les pushs staging est un **faux signal** : on s'habitue au rouge et on rate le vrai rouge le jour où il arrive. À fixer rapidement.

## DoD

- [ ] Step `Run dashboard crawler` refactor en option A (SSH dev-pub + container Playwright sur staging-edge), avec `DATABASE_URL=postgresql://...@postgres-staging:5432/prospection?...`
- [ ] Push staging → run vert end-to-end (crawler inclus)
- [ ] Vieux secrets Supabase retirés du step (`NEXT_PUBLIC_SUPABASE_URL`, `*_ANON_KEY`, `SERVICE_ROLE_KEY`) — morts
- [ ] Ticket archivé dans `todo/done/`

## Lien

- Run en échec : https://github.com/Christ-Roy/veridian-prospection/actions/runs/26315553114
- Commit migration helper auth : `ce5b56f`
- Workflow concerné : `.github/workflows/prospection-deploy-staging.yml` l.289-295
