# [PROSPECTION] Mega battery doit tourner sur dev-pub container, pas en local

> **Type** : Bug script DevOps E2E (suite du ticket DATABASE_URL)
> **Sévérité** : 🟡 P1 — non bloquant si on accepte de ne pas runner localement, mais à corriger pour CI/automation
> **Owner** : agent Prospection à spawner
> **Créé** : 2026-05-25 par team-lead après mega battery post-fix DATABASE_URL
> **Découvert par** : team-lead, mega battery #2 post-fix FIX-STG-FULL

## Symptôme

Après le fix FIX-STG-FULL (6417517) qui exporte `DATABASE_URL` récupéré via SSH dev-pub, on a maintenant :

```
PrismaClientInitializationError:
Can't reach database server at `postgres-staging:5432`
```

Le `DATABASE_URL` exporté est `postgresql://postgres:...@postgres-staging:5432/prospection?...` — ce hostname `postgres-staging` est **résolvable uniquement depuis le réseau Docker `staging-edge` sur dev-pub**, pas depuis la machine locale Robert.

## Root cause

Le helper E2E (`e2e/helpers/auth.ts`) fait un `prisma.user.upsert()` direct via Prisma client. Pour que ça marche, il faut que le process Node qui exécute Prisma soit **dans le même réseau Docker que postgres-staging**.

Quand on lance `bash scripts/e2e/staging-full.sh` depuis la machine locale Robert :
- Le helper a bien `DATABASE_URL=...postgres-staging:5432` (récupéré par SSH)
- Mais Node tourne en local → ne peut pas résoudre `postgres-staging:5432` (pas dans Docker network)

## Fix proposé

**Option A** : Wrap la mega battery dans un container Playwright lancé sur dev-pub
```bash
# patch staging-full.sh pour SSH dev-pub + run le container Playwright là-bas
ssh dev-pub 'docker run --rm --network staging-edge \
  -v /tmp/prosp-megabattery:/work -w /work \
  -e DATABASE_URL="postgresql://...@postgres-staging:5432/..." \
  -e STAGING_URL="..." \
  mcr.microsoft.com/playwright:v1.60.0-jammy \
  bash -c "npm ci --no-audit --no-fund && xvfb-run npx playwright test --config=playwright.staging-full.config.ts"'
```

C'est le pattern utilisé pour la promo prod historique (cf `project_prisma_migrate_pattern.md` memory).

**Option B** : Mapper postgres-staging via tunnel SSH
```bash
ssh -L 5433:postgres-staging:5432 dev-pub
DATABASE_URL=postgresql://...@localhost:5433/...
```
Plus simple mais nécessite SSH actif en parallèle.

**Option C** : Faire le seed user via HTTP API exposée par le container Prospection
- Ajouter route `/api/internal/seed-e2e-user` protégée par HMAC
- Helper `loginAsE2EUser` call cette route au lieu de Prisma direct
- Plus propre mais nécessite ajout backend

## Recommendation

**Option A** (container Playwright sur dev-pub) est la plus pragmatique et déjà utilisée historiquement pour les promo prod tests. Le script `staging-full.sh` doit être étendu pour wrapper sur dev-pub.

## Definition of done

- [ ] Script `staging-full.sh` ou nouveau `staging-full-devpub.sh` qui wrap dans container dev-pub
- [ ] Mega battery passe 90+/96 specs (les 11 fails restants sont à diagnostiquer après ce fix)
- [ ] Doc mise à jour

## Estimation

~1-2h (réécriture script avec pattern SSH + docker run + rsync code source vers dev-pub).
