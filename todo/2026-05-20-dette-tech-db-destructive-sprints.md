# Dette technique — sprints DB destructifs restants (tier 💀)

> **Type** : Migrations Prisma DROP destructives
> **Sévérité** : 💀 CRITIQUE par règle §20 (DROP COLUMN / DROP TABLE)
> **Owner** : agent Prospection, **go explicite Robert obligatoire**
> **Créé** : 2026-05-20 (suite cleanup massif dette technique)
> **Référence parent** : `todo/done/2026-05-19-dette-technique-audit.md`

## Contexte

L'audit dette technique 2026-05-19 a été clôturé le 2026-05-20 à ~80%
(routes morts, code Supabase/Twenty/Claude+email legacy supprimés, ~5300
lignes nettes virées prod). Reste les sprints qui demandent une **migration
DB destructive** — par règle §20 CI-ARCHITECTURE ces actions sont tier
💀 et nécessitent un go explicite Robert.

## Sprints à valider — un par un

Chaque sprint = un commit séparé + une migration Prisma manuelle (la CI
prod n'applique pas `prisma migrate deploy` automatiquement, cf
[[project_prisma_migrate_pattern]] et [[project_promo_prod_pieges_2026_05_20]]).

### Sprint A — DROP TABLE `outreach_emails`

- **Pourquoi** : table vidée par cleanup Claude+email himalaya (commit
  `61427f9`), 0 rows en prod depuis toujours, plus aucun writer.
- **Effort** : 15 min (migration `DROP TABLE outreach_emails`)
- **Risque** : nul — table déjà retirée du schema Prisma, plus aucun
  consumer.
- **Tier** : 💀 par règle (DROP TABLE) mais risque réel = 🟢

### Sprint B — DROP COLUMN `subscription_id` (table `tenants`)

- **Pourquoi** : UUID jamais rempli (audit grep : 0 référence runtime
  côté Prospection, source de vérité Stripe est dans le Hub cf
  contrat §7.4). Confirmé 0 row `WHERE subscription_id IS NOT NULL`.
- **Effort** : 15 min
- **Risque** : nul si on confirme bien le grep avant
- **Tier** : 💀 → effectivement bas

### Sprint C — DROP COLUMN `prospection_plan` (table `tenants`)

- **Pourquoi** : legacy Supabase, fallback raw SQL `SELECT prospection_plan
  AS plan FROM tenants` encore présent dans `src/lib/supabase/tenant.ts:78`
  et `health/route.ts:90-99` au moment de l'audit. Cleanup Supabase
  2026-05-20 (`955f894`) a viré la majorité, à reverifier.
- **Action préalable** : grep `prospection_plan` après cleanup → confirmer
  0 reader en src/
- **Backfill prérequis** : `UPDATE tenants SET plan = COALESCE(plan, prospection_plan)`
  avant drop (au cas où certains rows n'ont que `prospection_plan` rempli)
- **Effort** : 30 min (backfill + migration)
- **Tier** : 💀 → réel risque 🟡

### Sprint D — DROP COLUMNS `twenty_*` (7) + `notifuse_*` (4)

- **Pourquoi** : intégrations CRM externes (Twenty supprimé entièrement
  2026-05-20, Notifuse géré côté Hub). 0 writer côté Prospection après
  cleanup. Quelques rows historiques abandonnées (5 twenty + 11 notifuse).
- **Décision business à confirmer** : on garde l'historique ou on vire
  sec ? Si on garde, alternative = déplacer dans `metadata` JSONB.
- **Effort** : 1h (décision + migration)
- **Tier** : 💀 → 🟡

### Sprint E — DROP tables Prisma orphelines (39 tables non-déclarées)

- **Pourquoi** : audit révèle 62 tables en DB prod vs 23 dans schema.prisma.
  Liste détaillée dans le ticket parent. Inclut tables Supabase Auth legacy
  (`email_verification`, `phone_verification`, `magic_links`, `mfa_codes`,
  `verification_tokens`), tables scraping (`staging_bodacc`, `staging_ca_trust`,
  etc.), vues matérialisées segments (`v_s01_*` à `v_s30_*`).
- **Action** : audit case par case — certaines vues ont valeur métier,
  d'autres sont des leftover Supabase à drop.
- **Effort** : 2-3h
- **Tier** : 💀 + 🟡 (perte historique possible)

## Pré-requis pour CHAQUE sprint

1. Re-vérifier le grep côté src/ après les cleanups récents (la surface a
   beaucoup changé)
2. **Backup DB prod avant** : `r2-sync` (cron 04:00 UTC ou manuel)
3. Tester sur staging clone prod (`dev-pub:postgres-staging`)
4. Migration Prisma générée localement + commit
5. Apply manuel prod via container node:22-alpine éphémère (pattern
   [[project_prisma_migrate_pattern]])
6. Smoke `/api/status` + `/api/health` + E2E headfull post-migration

## Pas urgent

Aucun de ces sprints n'est bloquant pour la prod. C'est du polish dette
qui peut attendre une fenêtre maintenance dédiée. Robert peut valider
1 sprint à la fois, pas besoin de tout faire d'un coup.
