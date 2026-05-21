# Sprint E — Audit tables Prisma orphelines (résultats)

> **Type** : Audit lecture seule + recommandations
> **Owner** : team-lead (sprint v1.5)
> **Créé** : 2026-05-21
> **Réfère** : `todo/2026-05-20-dette-tech-db-destructive-sprints.md` (Sprint E parent)

## TL;DR

Ticket parent annonçait 39 tables orphelines. Audit réel = **12 tables**
(audit déjà progressé silencieusement). Sur ces 12 :

- **5 tables LEGACY VIDES** (0 rows) → DROP safe immédiat
- **5 tables ENRICHISSEMENT SCRAPING** (volume massif, 1M-3.5M rows) → décision business Robert
- **2 tables ACTIVES** (438K + 31 rows) → bug schema Prisma, à déclarer

## Audit détaillé (volumes + colonnes)

| Table | Rows | Catégorie | Reco |
|---|---:|---|---|
| `email_verification` | 0 | 🔴 Supabase legacy | DROP |
| `phone_verification` | 0 | 🔴 Supabase legacy | DROP |
| `outreach_emails` | 0 | 🔴 Claude+email legacy | DROP (couvert Sprint A T9) |
| `ovh_monthly_destinations` | 0 | 🔴 Telnyx ou OVH legacy | DROP |
| `pj_leads` | 0 | 🔴 PagesJaunes scraper legacy | DROP |
| `staging_bodacc` | 9 485 | 🟡 Scraping BODACC procédures | À conserver ou archiver ? |
| `staging_ca_trust` | 547 247 | 🟡 Scraping CA Trust | À conserver ou archiver ? |
| `staging_master_enrich` | 996 657 | 🟡 Master enrich entreprises | À conserver ou archiver ? |
| `staging_sirene_src` | 996 657 | 🟡 Sirene source brute | À conserver ou archiver ? |
| `inpi_history` | 3 529 274 | 🟡 INPI bilans historiques | À conserver (valeur métier forte ?) |
| `results` | 438 358 | 🟢 PROD ACTIVE | Déclarer dans Prisma |
| `segment_catalog` | 31 | 🟢 PROD ACTIVE | Déclarer dans Prisma |

## Recommandations par catégorie

### 🔴 5 tables vides — Sprint E.1 (safe)

DROP en 1 migration :
- `email_verification`, `phone_verification` — leftover Supabase auth (déjà migré Auth.js v5)
- `outreach_emails` — déjà couvert Sprint A (T9)
- `ovh_monthly_destinations` — investiguer si OVH téléphonie legacy ou si feature à ré-armer
- `pj_leads` — leftover scraper PagesJaunes (mort depuis pivot enrichissement)

**Tier 💀 par règle §20, risque réel 🟢** (0 rows partout).

### 🟡 5 tables enrichissement massif — décision business

`staging_*` (1.5M+ rows chacune) + `inpi_history` (3.5M) = 5.5M rows total.

**Questions à arbitrer** :
1. Sont-elles encore alimentées (cron scraper toujours actif) ?
2. Si oui, par quel job ? Cron sur dev-pub ? Container scraping ?
3. Si non, peut-on les archiver vers R2 + DROP ? Économie disque ~5-10 GB.
4. `inpi_history` 3.5M rows — vraie source de vérité bilans INPI ou cache régénérable ?

**Pas d'action sans réponse Robert.**

### 🟢 2 tables actives — bug schema Prisma

`results` et `segment_catalog` sont en prod ET utilisées (438K + 31 rows non nuls). Elles ne sont **pas déclarées dans `prisma/schema.prisma`** — c'est une dette de schéma silencieuse.

**Conséquences** :
- Le code ne peut PAS les lire via `prisma.results.findMany()` — accès uniquement via `$queryRaw`
- Aucun typing TypeScript
- Aucune migration Prisma ne peut les modifier (drift silencieux)

**Action recommandée** : `npx prisma db pull` pour les introspect, puis valider/ajuster le schéma. Tier 🟡 MOYEN (additif au schema, pas de DDL).

Grep recommandé avant : `grep -rn "results\|segment_catalog" src/` pour identifier qui lit en `$queryRaw`.

## Prochaines étapes proposées

1. **Sprint E.1** (immédiat, safe) — DROP les 5 tables vides en 1 migration tier 💀 mais risque 🟢. Effort 30 min. Peut être délégué à un agent.

2. **Sprint E.2** (préalable décision) — Audit usage tables enrichissement avec Robert. Réponses business attendues.

3. **Sprint E.3** (à ouvrir séparément) — `prisma db pull` pour `results` + `segment_catalog`, ajouter au schema, vérifier que le code TypeScript s'aligne.

## Status

- Sprint A (DROP `outreach_emails`) : ✅ staging via T9
- Sprint B (DROP `tenants.subscription_id`) : 🟡 en cours T11
- Sprint C (DROP `tenants.prospection_plan`) : 🟡 en cours T12 (cleanup readers Phase 1 d'abord)
- Sprint D (DROP `twenty_*` + `notifuse_*`) : ⏳ pas commencé
- Sprint E (39 tables orphelines) : **réduit à 12 tables, audit terminé ci-dessus**
