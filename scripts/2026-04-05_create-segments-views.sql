-- Create 30 segment VIEWs + segment_catalog on the new `entreprises` table.
-- Source: open-data-hub/scripts/enrich_prestaging.py step_segments()
-- Adapted for PG: best_phone → best_phone_e164, added ca_suspect filter.
-- Idempotent: drops + recreates.

BEGIN;

-- Segment catalog (metadata table, used by dashboard for the segment picker)
CREATE TABLE IF NOT EXISTS segment_catalog (
  segment_id   VARCHAR PRIMARY KEY,
  view_name    VARCHAR NOT NULL,
  description  TEXT NOT NULL,
  volume       INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Clean previous state
TRUNCATE segment_catalog;

-- S01: RGE sans site web + phone (BTP artisans)
DROP VIEW IF EXISTS v_s01_rge_sans_site CASCADE;
CREATE VIEW v_s01_rge_sans_site AS
  SELECT * FROM entreprises
  WHERE est_rge = true AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S02: RGE site éclaté
DROP VIEW IF EXISTS v_s02_rge_site_eclate CASCADE;
CREATE VIEW v_s02_rge_site_eclate AS
  SELECT * FROM entreprises
  WHERE est_rge = true AND web_domain IS NOT NULL AND best_phone_e164 IS NOT NULL
    AND web_eclate_score >= 1 AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S03: PME CA>500K sans site + phone
DROP VIEW IF EXISTS v_s03_pme_ca500k_sans_site CASCADE;
CREATE VIEW v_s03_pme_ca500k_sans_site AS
  SELECT * FROM entreprises
  WHERE chiffre_affaires >= 500000 AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S04: PME 1M+ CA 10-50 effectifs + site éclaté
DROP VIEW IF EXISTS v_s04_pme_1m_site_eclate CASCADE;
CREATE VIEW v_s04_pme_1m_site_eclate AS
  SELECT * FROM entreprises
  WHERE chiffre_affaires >= 1000000 AND tranche_effectifs IN ('11','12','21')
    AND web_domain IS NOT NULL AND best_phone_e164 IS NOT NULL
    AND (web_tech_score < 30 OR web_has_responsive = false)
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S05: 3+ marchés publics, sans site + phone
DROP VIEW IF EXISTS v_s05_decp_sans_site CASCADE;
CREATE VIEW v_s05_decp_sans_site AS
  SELECT * FROM entreprises
  WHERE nb_marches_publics >= 3 AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S06: Jeunes RGE 2022+ sans site + phone
DROP VIEW IF EXISTS v_s06_jeunes_rge_sans_site CASCADE;
CREATE VIEW v_s06_jeunes_rge_sans_site AS
  SELECT * FROM entreprises
  WHERE est_rge = true AND date_creation >= '2022-01-01'
    AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S07: Qualiopi + phone sans site
DROP VIEW IF EXISTS v_s07_qualiopi_sans_site CASCADE;
CREATE VIEW v_s07_qualiopi_sans_site AS
  SELECT * FROM entreprises
  WHERE est_qualiopi = true AND best_phone_e164 IS NOT NULL AND web_domain IS NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S08: EPV + phone
DROP VIEW IF EXISTS v_s08_epv_phone CASCADE;
CREATE VIEW v_s08_epv_phone AS
  SELECT * FROM entreprises
  WHERE est_epv = true AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S09: Double certif RGE+Qualiopi
DROP VIEW IF EXISTS v_s09_double_certif_rge_qualiopi CASCADE;
CREATE VIEW v_s09_double_certif_rge_qualiopi AS
  SELECT * FROM entreprises
  WHERE est_rge = true AND est_qualiopi = true
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S10: Restos/hotels/cafés sans site + phone (horeca)
DROP VIEW IF EXISTS v_s10_horeca_sans_site CASCADE;
CREATE VIEW v_s10_horeca_sans_site AS
  SELECT * FROM entreprises
  WHERE (code_naf LIKE '56.%' OR code_naf LIKE '55.%')
    AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S11: BTP créés 2020+ CA connu sans site
DROP VIEW IF EXISTS v_s11_btp_recent_sans_site CASCADE;
CREATE VIEW v_s11_btp_recent_sans_site AS
  SELECT * FROM entreprises
  WHERE (code_naf LIKE '41.%' OR code_naf LIKE '43.%')
    AND date_creation >= '2020-01-01' AND chiffre_affaires IS NOT NULL
    AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S12: Commerces détail 47.x sans site + phone
DROP VIEW IF EXISTS v_s12_commerce_47_sans_site CASCADE;
CREATE VIEW v_s12_commerce_47_sans_site AS
  SELECT * FROM entreprises
  WHERE code_naf LIKE '47.%' AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S13: PME industrie 10-50 sans site
DROP VIEW IF EXISTS v_s13_industrie_pme_sans_site CASCADE;
CREATE VIEW v_s13_industrie_pme_sans_site AS
  SELECT * FROM entreprises
  WHERE (code_naf LIKE '10.%' OR code_naf LIKE '25.%' OR code_naf LIKE '28.%')
    AND tranche_effectifs IN ('11','12')
    AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S14: Coiffeurs/beauté sans site + phone
DROP VIEW IF EXISTS v_s14_coiffeurs_sans_site CASCADE;
CREATE VIEW v_s14_coiffeurs_sans_site AS
  SELECT * FROM entreprises
  WHERE code_naf LIKE '96.02%' AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S15: Boulangeries sans site + phone
DROP VIEW IF EXISTS v_s15_boulangeries_sans_site CASCADE;
CREATE VIEW v_s15_boulangeries_sans_site AS
  SELECT * FROM entreprises
  WHERE code_naf LIKE '10.71%' AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S16: Garages auto sans site + phone
DROP VIEW IF EXISTS v_s16_garages_sans_site CASCADE;
CREATE VIEW v_s16_garages_sans_site AS
  SELECT * FROM entreprises
  WHERE code_naf LIKE '45.20%' AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S17: Pharmacies sans site + phone
DROP VIEW IF EXISTS v_s17_pharmacies_sans_site CASCADE;
CREATE VIEW v_s17_pharmacies_sans_site AS
  SELECT * FROM entreprises
  WHERE code_naf LIKE '47.73%' AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S18: BNI membres actifs
DROP VIEW IF EXISTS v_s18_bni_actifs CASCADE;
CREATE VIEW v_s18_bni_actifs AS
  SELECT * FROM entreprises
  WHERE est_bni = true AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S19: LBC Pro (budget marketing)
DROP VIEW IF EXISTS v_s19_lbc_pro CASCADE;
CREATE VIEW v_s19_lbc_pro AS
  SELECT * FROM entreprises
  WHERE est_sur_lbc = true AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S20: Site Flash/old HTML + CA>500K
DROP VIEW IF EXISTS v_s20_site_flash_ca500k CASCADE;
CREATE VIEW v_s20_site_flash_ca500k AS
  SELECT * FROM entreprises
  WHERE chiffre_affaires >= 500000
    AND (web_has_flash = true OR web_has_old_html = true OR web_has_layout_tables = true)
    AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S21: Page recrutement + site éclaté
DROP VIEW IF EXISTS v_s21_recrutement_eclate CASCADE;
CREATE VIEW v_s21_recrutement_eclate AS
  SELECT * FROM entreprises
  WHERE web_has_recruiting_page = true AND web_eclate_score >= 1 AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S22: Multi-domaines 2-10 chaînes PME
DROP VIEW IF EXISTS v_s22_multi_domaines CASCADE;
CREATE VIEW v_s22_multi_domaines AS
  SELECT * FROM entreprises
  WHERE web_domain_count BETWEEN 2 AND 10 AND is_registrar = false AND best_phone_e164 IS NOT NULL
    AND COALESCE(ca_suspect, false) = false;

-- S23: Gold RGE prêt à closer
DROP VIEW IF EXISTS v_s23_gold_rge CASCADE;
CREATE VIEW v_s23_gold_rge AS
  SELECT * FROM entreprises
  WHERE est_rge = true AND best_phone_e164 IS NOT NULL AND chiffre_affaires IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S24: Tout en or (RGE+Qualiopi+CA+phone)
DROP VIEW IF EXISTS v_s24_tout_en_or CASCADE;
CREATE VIEW v_s24_tout_en_or AS
  SELECT * FROM entreprises
  WHERE est_rge = true AND est_qualiopi = true AND chiffre_affaires IS NOT NULL
    AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S25: Parfait prospect CA+certif+phone+sans site
DROP VIEW IF EXISTS v_s25_parfait_prospect CASCADE;
CREATE VIEW v_s25_parfait_prospect AS
  SELECT * FROM entreprises
  WHERE chiffre_affaires >= 500000
    AND (est_rge = true OR est_qualiopi = true OR est_bio = true OR est_sur_lbc = true OR est_bni = true)
    AND best_phone_e164 IS NOT NULL AND web_domain IS NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S27: Multi-signaux 3+ avec phone (NOTE: S26 skipped — needs rebonds_pool table not yet in PG)
DROP VIEW IF EXISTS v_s27_multi_signaux CASCADE;
CREATE VIEW v_s27_multi_signaux AS
  SELECT * FROM entreprises
  WHERE signal_count >= 3 AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S28: Rentables (marge>10%) sans site
DROP VIEW IF EXISTS v_s28_rentables_sans_site CASCADE;
CREATE VIEW v_s28_rentables_sans_site AS
  SELECT * FROM entreprises
  WHERE chiffre_affaires >= 200000 AND resultat_net > 0 AND marge_ebe >= 10
    AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S29: Déficitaires 500K+ CA avec site
DROP VIEW IF EXISTS v_s29_deficit_avec_site CASCADE;
CREATE VIEW v_s29_deficit_avec_site AS
  SELECT * FROM entreprises
  WHERE resultat_net < 0 AND chiffre_affaires >= 500000
    AND web_domain IS NOT NULL AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- S30: Croissance saine (recrute + site propre)
DROP VIEW IF EXISTS v_s30_croissance_saine CASCADE;
CREATE VIEW v_s30_croissance_saine AS
  SELECT * FROM entreprises
  WHERE web_has_recruiting_page = true AND web_eclate_score = 0 AND chiffre_affaires IS NOT NULL
    AND best_phone_e164 IS NOT NULL
    AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- Bonus VIEWs for the scoring buckets
DROP VIEW IF EXISTS v_top_diamond CASCADE;
CREATE VIEW v_top_diamond AS
  SELECT * FROM entreprises
  WHERE prospect_score >= 80 AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

DROP VIEW IF EXISTS v_top_gold CASCADE;
CREATE VIEW v_top_gold AS
  SELECT * FROM entreprises
  WHERE prospect_score >= 60 AND is_registrar = false AND COALESCE(ca_suspect, false) = false;

-- Populate segment_catalog with volumes (one row per view)
INSERT INTO segment_catalog (segment_id, view_name, description, volume)
SELECT 'S01', 'v_s01_rge_sans_site',          'RGE sans site web + phone (BTP artisans)',     (SELECT COUNT(*) FROM v_s01_rge_sans_site) UNION ALL
SELECT 'S02', 'v_s02_rge_site_eclate',        'RGE site éclaté',                               (SELECT COUNT(*) FROM v_s02_rge_site_eclate) UNION ALL
SELECT 'S03', 'v_s03_pme_ca500k_sans_site',   'PME CA>500K sans site + phone',                 (SELECT COUNT(*) FROM v_s03_pme_ca500k_sans_site) UNION ALL
SELECT 'S04', 'v_s04_pme_1m_site_eclate',     'PME 1M+ CA 10-50 effectifs + site éclaté',      (SELECT COUNT(*) FROM v_s04_pme_1m_site_eclate) UNION ALL
SELECT 'S05', 'v_s05_decp_sans_site',         '3+ marchés publics, sans site + phone',         (SELECT COUNT(*) FROM v_s05_decp_sans_site) UNION ALL
SELECT 'S06', 'v_s06_jeunes_rge_sans_site',   'Jeunes RGE 2022+ sans site + phone',            (SELECT COUNT(*) FROM v_s06_jeunes_rge_sans_site) UNION ALL
SELECT 'S07', 'v_s07_qualiopi_sans_site',     'Qualiopi + phone sans site',                    (SELECT COUNT(*) FROM v_s07_qualiopi_sans_site) UNION ALL
SELECT 'S08', 'v_s08_epv_phone',              'EPV + phone',                                   (SELECT COUNT(*) FROM v_s08_epv_phone) UNION ALL
SELECT 'S09', 'v_s09_double_certif_rge_qualiopi', 'Double certif RGE+Qualiopi',                (SELECT COUNT(*) FROM v_s09_double_certif_rge_qualiopi) UNION ALL
SELECT 'S10', 'v_s10_horeca_sans_site',       'Restos/hotels/cafés sans site + phone',         (SELECT COUNT(*) FROM v_s10_horeca_sans_site) UNION ALL
SELECT 'S11', 'v_s11_btp_recent_sans_site',   'BTP créés 2020+ CA connu sans site',            (SELECT COUNT(*) FROM v_s11_btp_recent_sans_site) UNION ALL
SELECT 'S12', 'v_s12_commerce_47_sans_site',  'Commerces détail 47.x sans site + phone',       (SELECT COUNT(*) FROM v_s12_commerce_47_sans_site) UNION ALL
SELECT 'S13', 'v_s13_industrie_pme_sans_site','PME industrie 10-50 sans site',                 (SELECT COUNT(*) FROM v_s13_industrie_pme_sans_site) UNION ALL
SELECT 'S14', 'v_s14_coiffeurs_sans_site',    'Coiffeurs/beauté sans site + phone',            (SELECT COUNT(*) FROM v_s14_coiffeurs_sans_site) UNION ALL
SELECT 'S15', 'v_s15_boulangeries_sans_site', 'Boulangeries sans site + phone',                (SELECT COUNT(*) FROM v_s15_boulangeries_sans_site) UNION ALL
SELECT 'S16', 'v_s16_garages_sans_site',      'Garages auto sans site + phone',                (SELECT COUNT(*) FROM v_s16_garages_sans_site) UNION ALL
SELECT 'S17', 'v_s17_pharmacies_sans_site',   'Pharmacies sans site + phone',                  (SELECT COUNT(*) FROM v_s17_pharmacies_sans_site) UNION ALL
SELECT 'S18', 'v_s18_bni_actifs',             'BNI membres actifs',                            (SELECT COUNT(*) FROM v_s18_bni_actifs) UNION ALL
SELECT 'S19', 'v_s19_lbc_pro',                'LBC Pro (budget marketing)',                    (SELECT COUNT(*) FROM v_s19_lbc_pro) UNION ALL
SELECT 'S20', 'v_s20_site_flash_ca500k',      'Site Flash/old HTML + CA>500K',                 (SELECT COUNT(*) FROM v_s20_site_flash_ca500k) UNION ALL
SELECT 'S21', 'v_s21_recrutement_eclate',     'Page recrutement + site éclaté',                (SELECT COUNT(*) FROM v_s21_recrutement_eclate) UNION ALL
SELECT 'S22', 'v_s22_multi_domaines',         'Multi-domaines 2-10 chaînes PME',               (SELECT COUNT(*) FROM v_s22_multi_domaines) UNION ALL
SELECT 'S23', 'v_s23_gold_rge',               'Gold RGE prêt à closer',                        (SELECT COUNT(*) FROM v_s23_gold_rge) UNION ALL
SELECT 'S24', 'v_s24_tout_en_or',             'RGE+Qualiopi+CA+phone',                         (SELECT COUNT(*) FROM v_s24_tout_en_or) UNION ALL
SELECT 'S25', 'v_s25_parfait_prospect',       'Parfait prospect CA+certif+phone+sans site',    (SELECT COUNT(*) FROM v_s25_parfait_prospect) UNION ALL
SELECT 'S27', 'v_s27_multi_signaux',          'Multi-signaux 3+ avec phone',                   (SELECT COUNT(*) FROM v_s27_multi_signaux) UNION ALL
SELECT 'S28', 'v_s28_rentables_sans_site',    'Rentables (marge>10%) sans site',               (SELECT COUNT(*) FROM v_s28_rentables_sans_site) UNION ALL
SELECT 'S29', 'v_s29_deficit_avec_site',      'Déficitaires 500K+ CA avec site',               (SELECT COUNT(*) FROM v_s29_deficit_avec_site) UNION ALL
SELECT 'S30', 'v_s30_croissance_saine',       'Croissance saine (recrute + site propre)',      (SELECT COUNT(*) FROM v_s30_croissance_saine) UNION ALL
SELECT 'DIAMOND', 'v_top_diamond', 'Score ≥80 (diamond prospects)',                            (SELECT COUNT(*) FROM v_top_diamond) UNION ALL
SELECT 'GOLD',    'v_top_gold',    'Score ≥60 (gold prospects)',                                (SELECT COUNT(*) FROM v_top_gold);

COMMIT;

-- Verification
SELECT segment_id, view_name, volume FROM segment_catalog ORDER BY volume DESC;
