# [PROSPECTION] Historique de migrations Prisma divergent — `migrate deploy` from-scratch casse

> **Sévérité** : 🟡 P1 (dette migration — bloque tout rebuild de DB from-scratch)
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Découvert** : en réparant la DB staging supprimée (cf done/2026-06-11-prospection-staging-unhealthy-recurrent.md)

## Le problème

`prisma migrate deploy` sur une **DB vide** plante à la 2ᵉ migration :

```
Migration 0002_add_tenant_id failed (P3018)
ERROR: column "tenant_id" of relation "outreach" already exists (42701)
```

Cause : **`0001_init/migration.sql` contient déjà `tenant_id`** sur les 12 tables
(16 occurrences), alors que **`0002_add_tenant_id`** essaie de les `ALTER TABLE … ADD
COLUMN "tenant_id"`. Les deux migrations sont incohérentes entre elles : `0001` a été
régénéré à un moment (snapshot incluant tenant_id) sans ajuster `0002`.

De plus : `0001_init` ne crée que **12 tables**, alors que `schema.prisma` déclare
**35 models**. L'historique de migrations ne reconstruit donc PAS le schéma réel —
la DB prod a été montée par un autre chemin (vraisemblablement `db push` à l'origine,
puis migrations ajoutées par-dessus). Tant que personne ne rejoue les migrations
from-scratch, ça ne se voit pas. Mais :

- **Tout nouvel environnement** (staging recréé, DB de test CI, dev local fresh)
  est cassé par `migrate deploy`.
- La CI staging (`prisma migrate deploy`) ne survit que parce que la DB existait
  déjà avec ses migrations marquées appliquées — un reset la casse (vécu 2026-06-16).

## Contournement appliqué le 2026-06-16 (staging recréé)

Pour remettre staging vert après suppression de `postgres-staging` :
1. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
2. `prisma db push` (matérialise les 35 models = schéma cible exact)
3. `prisma migrate resolve --applied <chaque migration>` (baseline : marque les 31
   comme appliquées → `migrate deploy` redevient idempotent / no-op)

→ `prisma migrate status` = "Database schema is up to date". Staging healthy.

C'est une **baseline**, pas un fix de l'historique. La dette reste.

## ⚠️ 2e couche de dette découverte le même jour : objets HORS-Prisma

En recréant la DB on a aussi découvert que `schema.prisma` ne déclare PAS tout le
schéma réel. Tables gérées partiellement hors Prisma (ETL INSEE/INPI + ALTER
manuels prod) → absentes d'un `db push` :
- 11 colonnes INPI sur `entreprises` + table `inpi_history` → `scripts/2026-04-06_inpi-v36-columns.sql`
- `segment_catalog` + 31 vues `v_*` → `scripts/2026-04-05_create-segments-views.sql`
- colonnes pipeline outreach (`real_value`, `upsell_estimated`, `last_interaction_at`)
  + `dirigeant_annee_naissance` → étaient ORPHELINES (jamais versionnées) →
  nouveau `scripts/2026-06-16_outreach-pipeline-value-columns.sql`

Ces scripts existaient mais **la CI ne les appliquait jamais** (elle ne faisait que
`prisma migrate deploy`). Corrigé 2026-06-16 : nouveau step CI applique les 3 scripts
hors-Prisma après migrate deploy (idempotent). Une DB recréée se répare désormais seule.

→ Le vrai fix (option A ci-dessous) devra **réconcilier Prisma ET les scripts
hors-Prisma** : soit tout ramener dans Prisma, soit documenter clairement la
frontière "Prisma vs ETL" et garder les 2 chemins. Aujourd'hui la frontière est
implicite et c'est ce qui a piégé.

## Le vrai fix (à froid)

Repartir d'un historique de migrations propre et **reproductible from-scratch** :

- **Option A (recommandée)** : squash l'historique. Supprimer les 31 migrations,
  générer une migration unique `0001_init` depuis `schema.prisma`
  (`prisma migrate diff --from-empty --to-schema-datamodel` ou `migrate dev` sur DB
  vide), valider qu'un `migrate deploy` from-scratch produit exactement les 35 models.
  Marquer cette migration baseline `--applied` sur prod + staging (DBs existantes).
- **Option B** : réparer `0001` ⇄ `0002` (retirer tenant_id de 0001 OU rendre 0002
  idempotent `ADD COLUMN IF NOT EXISTS`) + auditer les 29 suivantes pour combler
  l'écart 12→35 tables. Plus risqué, plus long, garde un historique pollué.

## DoD

- [ ] `prisma migrate deploy` sur DB vide → 35 models, 0 erreur
- [ ] Prod + staging : migrations baselinées `--applied` (pas de re-run destructif)
- [ ] CI staging reste verte (`migrate deploy` idempotent)
- [ ] Doc `schema.prisma` = source de vérité confirmée

## Pourquoi pas maintenant

Réparer l'historique = chantier dédié (squash + revalidation prod). Staging est
vert via baseline. À traiter à froid, hors du fix d'urgence staging.
