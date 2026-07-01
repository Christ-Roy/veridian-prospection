# Dashboards admin KPI cassés (signalé par Robert 2026-06-19)

## Symptôme rapporté
Robert : « j'ai l'impression que les dashboards admin ne marchent pas avec les KPI etc. »
(client AVSE — workspace `64e5b12f-7a88-4125-aadc-fecc48588405`, tenant `dd8231fa-e6e0-4648-ae9d-a6095309d138`).

## Contexte découvert pendant le déblocage AVSE (2026-06-19)
En provisionnant le workspace de Didier, **cause racine d'un autre bug trouvée** :
la prod Prospection tournait avec un **drift de schéma DB** — 7 migrations Prisma
(`0025_add_mail_provider` → `0031_add_user_openrouter_link`) **jamais appliquées**
alors que le code déployé les attendait.

Conséquence prouvée : `prisma.workspace.create()` plantait
(`The column mail_provider does not exist`) → **aucun workspace créable pour aucun
nouveau client**. L'erreur était *swallow* en best-effort côté `provision`
(`[provision] auto-admin upsert failed ... Invalid prisma.workspace.create()`).

### Correctif déjà appliqué (2026-06-19)
- Backup DB : `prod-pub:/tmp/prospection-backup-20260619-163836.sql.gz` (469 Mo).
- Audit des 7 migrations : **100 % additives** (ADD COLUMN IF NOT EXISTS / CREATE
  TABLE IF NOT EXISTS / CREATE INDEX), zéro DROP/DELETE exécutable. Vérifié.
- Appliquées via `cat <fichier hôte> | docker exec -i <db> psql` (le conteneur app
  prod n'a ni `npx` ni les fichiers de migration → `prisma migrate deploy`
  impossible depuis l'app). Lignes enregistrées dans `_prisma_migrations`
  (checksum sha256, finished_at). État : migrations jusqu'à 0031, 4 nouvelles
  tables (lead_orders, mail_outbox, tenant_mail_templates, user_openrouter_link),
  colonnes mail sur workspaces.

## Ce qu'il reste à investiguer sur les KPI
Le drift corrigé a **peut-être déjà réparé** les dashboards KPI (mêmes erreurs
Prisma silencieuses possibles). À VÉRIFIER en conditions réelles :

1. **Tester l'endpoint** `GET /api/admin/kpi?from=…&to=…` avec une session admin
   réelle (l'endpoint est gated `requireAdmin()`, pas testable en curl HMAC).
   Il agrège `outreach` / `callLog` / `followup` par workspace via `groupBy`.
2. **Page** `src/app/admin/kpi/page.tsx` — vérifier qu'elle affiche les agrégats
   (pas un état vide / spinner infini / erreur réseau).
3. Causes possibles si toujours cassé après le fix de drift :
   - KPI vides **légitimement** : un workspace fraîchement créé (cas AVSE) n'a
     ni outreach ni call ni followup → 0 partout = normal, pas un bug.
   - Bug d'affichage front (BigInt non sérialisé ? `_count` mal mappé ?).
   - Autre table/colonne manquante non couverte par 0025→0031.
4. **Reproduire** : se connecter en admin sur un tenant qui A de la data
   (pas AVSE qui est vierge) et regarder si les chiffres tombent.

## Méthode de root-cause infra (pour la prochaine fois)
Le drift de migrations Prisma est silencieux en prod (erreurs swallow). Réflexe :
comparer `SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC`
avec `ls prisma/migrations/` du repo. Si écart → appliquer le delta (additif =
sûr après audit). Ticket connexe : pourquoi le déploiement prod n'applique pas
`migrate deploy` automatiquement (l'image standalone Next ne contient pas la CLI
Prisma ni les fichiers de migration → à câbler dans le pipeline de déploiement,
sinon le drift se reproduira à chaque nouvelle migration).

## Priorité
P1 — touche la visibilité business de TOUS les clients Prospection (pas que AVSE).
Le drift est corrigé ; reste à confirmer que les KPI s'affichent et à câbler
l'auto-migration au déploiement pour éviter la récidive.

---

## ✅ Vérification 2026-07-01 (agent prospection) — SYMPTÔME RÉSOLU

Testé en conditions réelles : connecté admin sur le workspace **Veridian** (qui A
de la data), page `/admin/kpi` en prod. **Tous les KPI s'affichent correctement** :
- Base entreprises : 1 296 405 total · 615 063 tél (47%) · 543 957 email (42%) · 383 890 site (30%)
- Scoring : Diamond 1797 · Gold 35 752
- Certifications : RGE 50 172 · Qualiopi 58 968 · Bio 47 065 · EPV 1159 · BNI 2425
- Sections Plan & Quota, Santé financière INPI également rendues.

→ Le fix de drift du 19/06 a bien réparé les dashboards. Pas de bug d'affichage,
pas de BigInt cassé, pas de spinner infini. Le "KPI cassés" d'AVSE était très
probablement le workspace VIERGE (0 data = 0 partout, normal) + le drift qui
plantait sa création. Les deux corrigés.

## Reste : PRÉVENTION (le vrai P1 restant)
Câbler l'auto-migration Prisma au déploiement PROD. Aujourd'hui la CI prod
**n'applique PAS** `prisma migrate deploy` (cf CLAUDE.md Prospection : "appliquer
manuellement") → chaque nouvelle migration crée un drift silencieux jusqu'à ce
qu'un client casse. L'image standalone Next ne contient ni la CLI Prisma ni les
fichiers de migration → même pattern que le fix staging (container node:22-alpine
éphémère sur le réseau prod qui applique le delta). À câbler dans le pipeline
prod pour tuer la récidive. Sévérité : 🔴 (touche le déploiement).
