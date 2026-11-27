# [PROSPECTION] Schéma de filtres complet + opérateurs (exposer tout COLUMN_MAP à l'IA)

> **Sévérité** : 🟡 P1
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Dépend de** : -06 (audit), va de pair avec -01.

## But

Le schéma ICP actuel (`RefillIcpFiltersSchema`) ne couvre que ~7 dimensions.
`COLUMN_MAP` en expose ~80. L'IA doit pouvoir exploiter TOUTE la richesse de la
base (sinon elle source à l'aveugle). Ce ticket = étendre le schéma de filtres
en gardant l'archi sûre (JSON validé → SQL paramétré).

## Le gap (ce qui manque au schéma ICP actuel)

Présent dans `COLUMN_MAP` mais PAS exposé en filtre structuré :
- **Signaux web** (~30) : has_https, has_ecommerce, has_responsive, web_tech_score,
  web_obsolescence_score, web_eclate_score, copyright_year, has_old_html, has_flash…
  → essentiel pour cibler "boîtes avec site pourri" (ton use case site vitrine).
- **Contact fin** : email_type, phone_type, requirePhone/requireEmail, mobileOnly.
- **Scoring** : prospect_score, prospect_tier, small_biz_score, data_completeness,
  signal_count.
- **Certifications** : est_rge, est_qualiopi, est_bio, est_epv, est_finess, est_ess,
  est_bni, est_sur_lbc, qualiopi_specialite.
- **Marchés publics** : nb_marches_publics, montant_marches_publics, decp_2024_plus.
- **Flags** : is_auto_entrepreneur, bodacc_status.
- **Web présence** : hasWebsite (with/without) — clé pour le ciblage "sans site".
- **Social** : présence linkedin/facebook/instagram/twitter.

## Conception

1. **Schéma de filtres composable** (Zod), opérateurs explicites :
   ```jsonc
   {
     "all": [                          // AND
       { "field": "ca", "op": "between", "min": 80000, "max": 300000 },
       { "field": "secteur_final", "op": "in", "values": ["coiffure","esthetique"] },
       { "field": "departement", "op": "in", "values": ["69","01","38"] },
       { "field": "hasWebsite", "op": "eq", "value": "without" },
       { "field": "age_dirigeant", "op": "gte", "value": 55 },
       { "field": "requirePhone", "op": "eq", "value": true }
     ],
     "any": [ /* OR optionnel */ ]
   }
   ```
   Opérateurs : `eq, neq, gte, lte, between, in, exists, contains` (ILIKE borné).
2. **Validation stricte** : `field` ∈ whitelist `COLUMN_MAP` (réutiliser
   `resolveColumn`), type/op cohérents (pas de `contains` sur un booléen),
   bornes numériques anti-overflow (déjà fait dans RefillIcp — reprendre).
3. **Traducteur** : `buildSearchWhereSql(filters)` → SQL **paramétré**
   (placeholders `$1…`), JAMAIS d'interpolation de `field`/`value`. Étendre
   `buildIcpWhereSql` ou le généraliser.
4. **Rétro-compat** : garder `RefillIcpFiltersSchema` pour l'UI refill existante,
   OU faire de l'ICP un sous-cas du nouveau schéma (à trancher au banc).
5. **Catalogue de champs auto-documenté** : exposer un `GET /api/search/fields`
   (field, type, opérateurs valides, description, exemple) pour que l'IA SACHE
   ce qu'elle peut filtrer sans deviner. ← très important pour l'autonomie IA.

## Pièges
- Les `CASE WHEN bool THEN 1 ELSE 0` de COLUMN_MAP : pour un `op:eq true`, traduire
  en `e.col = true`, pas `(CASE…) = 1` (perf/index). Revoir le mapping pour le path booléen.
- Colonnes JSONB (`web_domains_all`) : opérateurs spécifiques.
- `secteur_final` vs `code_naf` : presets de secteurs existants (SECTOR_PRESETS) —
  réutiliser, ne pas refaire.

## DoD
- [ ] Schéma Zod composable couvrant tout COLUMN_MAP, opérateurs validés.
- [ ] `buildSearchWhereSql` paramétré, testé (injection impossible).
- [ ] `GET /api/search/fields` (catalogue auto-doc pour l'IA).
- [ ] Recoupé sur vraie data : chaque opérateur fait ce qu'il dit.
- [ ] Tests unitaires : validation rejette champs/ops invalides + cas injection.
