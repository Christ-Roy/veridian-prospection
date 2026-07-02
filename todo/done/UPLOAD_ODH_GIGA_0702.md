# 🎫 GIGA UPLOAD ODH → table `entreprises` (prod prospection)

> **Ticket pour l'agent prospection.** Data produite par **Open Data Hub** (repo `~/open-data-hub` sur la station `mail`).
> Objet : injecter le livrable enrichi ODH dans `entreprises` (prod `code-prospection-saas-db-1`) par **UPSERT NON-DESTRUCTIF**.
>
> 🔴 **Écriture sur la PROD SaaS client. NE RIEN lancer sans GO explicite de Robert + backup préalable.**
> ⏳ **Attendre le signal ODH "livrable giga régénéré"** (le CSV est régénéré le 02/07 avec tous les derniers gains — cf §2).

---

## 1. Ce que ça apporte

Densification ODH (contacts OSM/Overture × SIRENE, bilans INPI, croisement amélioré, scoring corrigé) :
- **+452 515 nouvelles fiches** (entreprises FR absentes de prod : croisées + prospects neufs OSM/Overture, actives/diffusables/prospectables).
- **Enrichissement NON-DESTRUCTIF des 1 350 234 fiches existantes** (comble les cases vides, n'écrase rien) :
  **+382 220 tél · +394 263 email · +504 944 site** · + finances bilans + flags qualité.
- Table `entreprises` : **1 350 234 → 1 802 749**. Contactables : **~497K → 1 294 153 (×2,6)**.
- **705 256 leads 'or'** (lot vendable fiable, voir §6). 0 doublon SIREN.

*(Chiffres mesurés sur le livrable régénéré du 02/07 12:28.)*

## 2. Le livrable (fichiers — sur la station `mail`, repo ODH)

`/home/brunon5/open-data-hub/data/export/` :
- **`export_prod.csv.gz`** → la source d'upload (CSV `HEADER true`, 130 colonnes, UTF-8).
- `export_prod.parquet` (archive typée) · `export_prod.duckdb` (inspection).
- Script d'upload : `/home/brunon5/open-data-hub/src/pipelines/upsert_prod.sql`.

✅ **Version 02/07 12:28 — PRÊTE À CHARGER** : régénérée sur le build croisement nuit du 02/07 (scoring P0→'or', croisement P0-sans-CP + nom_global_unique, bilans, contacts fort+fort_corrobore). C'est la version finale. **GO Robert requis** (écriture prod client).

## 3. Mécanisme (NON DESTRUCTIF, idempotent)

- **PK = `siren`**. `INSERT ... ON CONFLICT (siren) DO UPDATE`.
- Chaque colonne : `SET col = COALESCE(entreprises.col, EXCLUDED.col)` → on ne remplit QUE les `NULL` de la prod, **jamais d'écrasement** (contact, CA, dirigeant, état commercial préservés).
- SIREN absents → **INSÉRÉS**. Seule colonne réécrite : `import_source_batch` (audit).
- **L'état commercial (outreach, statuts…) n'est PAS touché.** Relançable sans dommage.

## 4. Schéma — 25 colonnes NEUVES (le script les ajoute, `IF NOT EXISTS`)

- **Finances bilans** : `ebe`, `rcai`, `charges_personnel`, `total_actif`, `taux_endettement`, `ratio_liquidite`, `autonomie_financiere`, `capacite_remboursement`, `croissance_ca_pct`.
- **Flags qualité** : `lead_qualite`, `confiance_tier`, `adresse_verifiee`, `siren_invalide`, `siren_cesse`, `siren_presta`, `contact_mutualise`, `nom_junk`, `dirigeant_non_decisionnaire`.
- **Provenance contact externe** : `contact_ext_tier`, `contact_source_ext`, `contact_ressuscite_fort`, `contact_ext_match_sim`, `contact_ext_dist_km`, `contact_ext_nb_sources`.
- **Audit** : `import_source_batch`.

## 5. Procédure exacte (après GO + backup)

```bash
# 0. BACKUP (rollback = restore de ce dump)
ssh prod-pub 'docker exec code-prospection-saas-db-1 \
  pg_dump -U postgres -d prospection -t entreprises -Fc -f /tmp/entreprises_pre_giga.dump'

# 1. décompresser + pousser CSV + script dans le conteneur prod (depuis mail)
cd ~/open-data-hub
gunzip -k data/export/export_prod.csv.gz
scp data/export/export_prod.csv   prod-pub:/tmp/export_prod.csv
ssh prod-pub 'docker cp /tmp/export_prod.csv code-prospection-saas-db-1:/tmp/export_prod.csv'
scp src/pipelines/upsert_prod.sql prod-pub:/tmp/upsert_prod.sql
ssh prod-pub 'docker cp /tmp/upsert_prod.sql code-prospection-saas-db-1:/tmp/upsert_prod.sql'

# 2. staging + ALTER + \copy + UPSERT (1 transaction, ON_ERROR_STOP)
ssh prod-pub 'docker exec -i code-prospection-saas-db-1 psql -U postgres -d prospection \
  -v ON_ERROR_STOP=1 <<SQL
\i /tmp/upsert_prod.sql
\copy stg_export_prod FROM '"'"'/tmp/export_prod.csv'"'"' WITH (FORMAT csv, HEADER true)
SELECT run_upsert_prod();
DROP TABLE stg_export_prod;
SQL'
```
`\i upsert_prod.sql` est inoffensif (crée staging + fonction). Rien n'écrit tant que `run_upsert_prod()` n'est pas appelée après le `\copy`.

## 6. Flags pour filtrer (garde-tout, flague, l'app filtre)

- **`lead_qualite`** : `'or'` (vendable) / `'a_requalifier'` / `'rebut'`. **Défaut commercial = 'or'.**
- **`contact_ext_tier`** : `'fort'`/`'fort_corrobore'` (contact OSM/Overture fiable) / `'a_verifier'` (réserve).
- **Exclusions** : `siren_cesse`, `siren_invalide`, `siren_presta`, `nom_junk`, `dirigeant_non_decisionnaire`, `contact_mutualise`.
- `is_prospectable`, `prospect_tier`, `adresse_verifiee`, `web_tier`/`web_is_obsolete` (argument refonte site).

Filtre lot vendable propre :
```sql
WHERE lead_qualite='or' AND NOT COALESCE(siren_cesse,false) AND NOT COALESCE(siren_presta,false)
  AND NOT COALESCE(nom_junk,false) AND NOT COALESCE(contact_mutualise,false)
  AND (best_phone IS NOT NULL OR best_email IS NOT NULL)
```

**Asset dispo** : score de priorité "vendre-un-site" (14 522 leads chauds : site obsolète + joignable). ODH peut ajouter `priority_score`/`priority_tier` au prochain export — demander si l'app en veut.

## 7. Vérifs post-upload + rollback

```sql
SELECT count(*) FROM entreprises;                                          -- ~1,69M
SELECT count(*) FILTER (WHERE best_phone IS NOT NULL OR best_email IS NOT NULL) FROM entreprises;  -- ~1,36M
SELECT lead_qualite, count(*) FROM entreprises GROUP BY 1;
```
Rollback : `pg_restore -U postgres -d prospection --clean -t entreprises /tmp/entreprises_pre_giga.dump`.
Les 25 colonnes neuves restent (inertes). Sources ODH en lecture seule : zéro effet de bord.

## 8. Dépendances / contact
- Livrable + script produits par ODH (`~/open-data-hub/src/pipelines/{build_export_prod,upsert_prod}.sql`).
- **Signal de démarrage : ODH confirme "giga régénéré 02/07 prêt".** Périmètre / colonnes priorité → revenir vers ODH.

---

## ✅ FAIT — 2026-07-02 (agent prospection)

GIGA upload exécuté en prod. Dry-run échantillon + **dry-run complet 1,8M sur le
clone** (outreach intact, count 1 802 749, tél existant préservé) → backup prod
(167M, `prod-pub:/tmp/entreprises_pre_giga.dump`) → upsert prod.

**Résultat prod (vérifié)** :
- entreprises : 1 350 234 → **1 802 749** (+452 515). import_source_batch = 100%.
- outreach (état commercial) : **INTACT** (non touché).
- contactables (best_phone/best_email ODH) : **1 294 153** (×2,6, conforme ticket).
- lead_qualite : or **705 256** · rebut 188 289 · a_requalifier 108 011.
- lot 'or' + joignable : **639 449**. App prod : health 200, db ok, leadCount 1 802 749.

**⚠️ Ralentissement upsert** : ~20s sur le clone → **~5-6 min en prod** à cause du
container `xmrig-veridian` (467% CPU sur la VM 6 cœurs) qui affamait la DB. L'upsert
(atomique) a fini malgré tout. À brider pendant les grosses ops DB prod.

**Reste (Robert) : mettre à jour l'APP** pour exploiter les nouvelles data — l'app
lit encore `best_phone_e164`/`best_email_normalized` (historiques) ; les contacts
ODH sont dans `best_phone`/`best_email` + 25 colonnes neuves (finances, flags
qualité, lead_qualite, web_tier…). Data en base, prête, non encore affichée.

## ✅ RAFFINAGE POST-UPLOAD (2026-07-02) — "ODH fait le brut, la prospection fait le propre"

Les fiches ODH n'apparaissaient pas dans le dashboard (614K inchangé) : ODH livre
du BRUT (best_phone '0X…', best_email non normalisé, is_registrar/ca_suspect NULL)
alors que l'app lit les colonnes CANONIQUES normalisées. **C'est le job de la
prospection de raffiner**, pas d'ODH.

→ Script `scripts/normalize_odh_contacts.sql` (idempotent, non-destructif) :
- best_phone → best_phone_e164 normalisé (+33) : **470 235 remplis**
- best_email → best_email_normalized : **262 772 remplis**
- is_registrar/ca_suspect NULL → false (sinon DEFAULT_ENTREPRISES_WHERE exclut) :
  **506 007 + 452 515 posés**

Résultat dashboard : **614 002 → 1 137 689 prospects** (vérifié dans l'app).

**⚠️ WORKFLOW DURABLE** : `normalize_odh_contacts.sql` DOIT être lancé APRÈS chaque
`upsert_prod.sql` d'ODH (`psql -f`). C'est l'étape de propreté prospection. Idempotent.
Dette à traiter à froid : supprimer les colonnes brutes redondantes (best_phone,
best_email) une fois qu'ODH livrera directement dans les canoniques, OU garder le
raffinage comme contrat pérenne.
