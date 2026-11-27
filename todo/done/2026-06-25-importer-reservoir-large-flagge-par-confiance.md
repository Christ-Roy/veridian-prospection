# [PROSPECTION] Importer le réservoir large (2,34M) flaggé par confiance + filtres pour itérer

> **Sévérité** : 🟡 P1 (chantier data prod — gros levier business)
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-25
> **Décideur** : Robert. Verbatim : *"j'aimerais bien tout avoir et avoir des filtres
> pour itérer rapidement et avoir un vrai retour terrain"* + *"peut-être avec tel pour
> l'instant et plus tard on adaptera"*.

## Le besoin

Aujourd'hui la prod a 996K entreprises mais n'en affiche ~400K (= celles avec un site
web). Robert veut le **réservoir complet flaggé par fiabilité** (doctrine "garde tout,
flague la certitude"), avec des **filtres pour itérer vite** et avoir un retour terrain
réel des commerciaux. Point de départ d'usage : les fiches **avec téléphone** (cold call).

## Le réservoir disponible (ODH, mesuré 2026-06-25 sur datahub.duckdb `niveau_0`)

| tier | total | avec tél | avec email | avec contact |
|---|---|---|---|---|
| `fr_dur` (rattachement SIREN sûr) | 614 516 | 138 826 | 527 815 | 551 203 |
| `fr_corrobore` (FR corroboré, multi-candidats) | 1 512 364 | 228 039 | 1 114 055 | 1 186 005 |
| `gris_geo` (FR probable, géo seule) | 213 512 | 8 065 | 209 559 | 211 397 |
| **TOTAL** | **2 340 392** | **374 930** | 1,85M | 1,95M |

Impact volume prod : table `entreprises` = 782 MB / 996K → +2,34M ≈ 2,5-3 GB. Prod a 44 GB
libres (55%). OK. (Dédup vs les 996K déjà présents à faire côté ODH avant export.)

## Ce qu'il faut côté PROSPECTION (ce ticket)

### 1. Colonne de confiance du rattachement (la pièce manquante)
La prod a `prospect_tier` (bronze/silver/gold = qualité COMMERCIALE) mais AUCUNE colonne
de **fiabilité du rattachement SIREN↔site**. L'ajouter (script hors-Prisma, convention
`scripts/2026-*.sql`, idempotent `ADD COLUMN IF NOT EXISTS`) :
```sql
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS fiche_confiance TEXT;
-- valeurs : 'fr_dur' | 'fr_corrobore' | 'gris_geo' | 'haute' | 'moyenne' | 'a_verifier'
CREATE INDEX IF NOT EXISTS idx_ent_fiche_confiance ON entreprises(fiche_confiance);
```
(aligner les valeurs EXACTES sur ce que l'ODH produit — cf ticket ODH ci-dessous.)

### 2. Exposer fiche_confiance dans les filtres
- **Moteur IA `/api/search`** : ajouter au catalogue `src/lib/search/fields.ts` (type enum,
  pattern identique à `ca_trend_3y`). → l'IA peut filtrer `fiche_confiance IN (fr_dur, fr_corrobore)`.
- **Dashboard prospection** : ajouter le filtre confiance dans l'UI prospects (à côté de
  hasWebsite / requirePhone). Les filtres contact `requirePhone`/`requireEmail` EXISTENT
  déjà (`src/lib/queries/prospects.ts:344-352`) → rien à coder côté contact.

### 3. Import non-destructif (staging d'abord — RÈGLE D'OR)
- UPSERT par SIREN : `INSERT ... ON CONFLICT (siren) DO NOTHING` (ne PAS écraser l'existant
  ni l'état `outreach`). Les nouveaux arrivent avec leur `fiche_confiance`.
- Tester sur la DB staging clone (banc search-dev / clone prod), vérifier :
  - l'état `outreach` intact, l'app marche, le moteur `/api/search` filtre bien la confiance
  - perf : la table passe à ~3,3M → re-vérifier les EXPLAIN du moteur (les index tiennent ?)
- PUIS prod avec backup préalable.

### 4. Garde-fou affichage (important pour le retour terrain)
Le dashboard ne doit PAS noyer les commerciaux sous le `gris_geo`. Défaut d'affichage
proposé : filtrer sur `fiche_confiance IN (fr_dur, fr_corrobore)` + `requirePhone` au départ,
MAIS laisser le commercial élargir (curseur de confiance). C'est ça "itérer vite + retour terrain".

## Découpage d'usage (ce que Robert veut tester empiriquement)
- **Phase 1** : exploiter les ~375K avec téléphone (cold call), tous tiers, filtrables par confiance.
- **Phase 2** : ouvrir aux emails / élargir selon le retour terrain.
- Plus tard : enrichir (re-scan sites, scoring web) au fur et à mesure de l'avancée ODH.

## Dépendance
Bloqué par le ticket ODH : `open-data-hub/todo/etapes/5-stockage-master/` (ou 6-scoring) —
ODH produit le batch `niveau_0` dédupliqué, au format `entreprises` prod, avec `fiche_confiance`
rempli. Ce ticket-ci = réception + colonne + filtres + import.

## DoD
- [ ] Colonne `fiche_confiance` + index (staging puis prod, non-destructif)
- [ ] Filtre confiance exposé dans `/api/search` (fields.ts) + dashboard
- [ ] Import UPSERT testé staging : outreach intact, app OK, moteur filtre, perf OK sur ~3,3M
- [ ] Défaut d'affichage qui ne noie pas (confiance + tel par défaut, élargissable)
- [ ] Import prod avec backup, monitoring post-deploy
