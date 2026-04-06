-- Seed DB for CI e2e tests
-- Must match the schema expected by dashboard queries
-- Updated: 2026-03-26 — replaced Or/Argent/Bronze tiers with sectorial presets

CREATE TABLE IF NOT EXISTS results (
  domain TEXT PRIMARY KEY, nom_entreprise TEXT, email_principal TEXT,
  phone_principal TEXT, phones TEXT, emails TEXT, cms TEXT,
  copyright_year INTEGER, has_responsive INTEGER, has_https INTEGER,
  niveau TEXT, enriched_via TEXT, enriched INTEGER DEFAULT 0,
  best_adresse TEXT, best_ville TEXT, best_cp TEXT, dept_computed TEXT,
  api_effectifs TEXT, api_ca INTEGER, api_code_naf TEXT, api_forme_juridique TEXT,
  api_categorie TEXT, api_dirigeant_prenom TEXT, api_dirigeant_nom TEXT,
  api_dirigeant_qualite TEXT, api_dirigeant_annee_naissance TEXT,
  siret TEXT, siren TEXT, societe_name TEXT, api_nom_complet TEXT,
  address TEXT, api_adresse TEXT, api_ville TEXT, api_code_postal TEXT,
  code_postal TEXT, ville_mentionnee TEXT, code_naf TEXT, forme_juridique TEXT,
  generator TEXT, platform_name TEXT, jquery_version TEXT, php_version TEXT,
  social_linkedin TEXT, social_facebook TEXT, social_instagram TEXT, social_twitter TEXT,
  final_url TEXT, title TEXT, meta_description TEXT, tva_intracom TEXT,
  cnb_nom TEXT, cnb_prenom TEXT, cnb_tel TEXT, cnb_barreau TEXT,
  cnb_specialite1 TEXT, cnb_specialite2 TEXT, cnb_date_serment TEXT,
  cnb_raison_sociale TEXT, est_encore_avocat INTEGER, obsolescence_score INTEGER,
  -- Columns needed for tech_score / eclate_score / lead_flags computation
  has_old_html INTEGER DEFAULT 0,
  has_flash INTEGER DEFAULT 0,
  has_layout_tables INTEGER DEFAULT 0,
  has_mixed_content INTEGER DEFAULT 0,
  has_phpsessid INTEGER DEFAULT 0,
  has_ie_polyfills INTEGER DEFAULT 0,
  has_meta_keywords INTEGER DEFAULT 0,
  has_viewport_no_scale INTEGER DEFAULT 0,
  has_lorem_ipsum INTEGER DEFAULT 0,
  has_favicon INTEGER DEFAULT 1,
  has_modern_images INTEGER DEFAULT 1,
  has_minified_assets INTEGER DEFAULT 1,
  has_compression INTEGER DEFAULT 1,
  has_cdn INTEGER DEFAULT 0,
  has_lazy_loading INTEGER DEFAULT 0,
  has_old_images INTEGER DEFAULT 0,
  http_status INTEGER DEFAULT 200,
  api_etat TEXT,
  api_est_asso INTEGER DEFAULT 0,
  bodacc_procedure TEXT,
  api_departement TEXT,
  -- Materialized columns (computed by db.ts migrations, seeded here for safety)
  tech_score INTEGER DEFAULT 0,
  eclate_score INTEGER DEFAULT 0,
  lead_flags TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS email_verification (
  domain TEXT PRIMARY KEY, dirigeant_email TEXT, dirigeant_emails_all TEXT,
  aliases_found TEXT, is_catch_all INTEGER, mail_provider TEXT
);
CREATE TABLE IF NOT EXISTS phone_verification (
  domain TEXT PRIMARY KEY, phone TEXT, formatted TEXT,
  is_valid INTEGER, phone_type TEXT, carrier TEXT,
  is_test_number INTEGER, is_shared INTEGER
);
CREATE TABLE IF NOT EXISTS outreach (
  domain TEXT PRIMARY KEY, status TEXT DEFAULT 'a_contacter',
  notes TEXT, contacted_date TEXT, contact_method TEXT,
  qualification REAL, last_visited TEXT, updated_at TEXT, position INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pipeline_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pj_leads (pj_id TEXT PRIMARY KEY, matched_domain TEXT, website_domain TEXT, name TEXT, phone_principal TEXT, phones TEXT, ville TEXT, departement TEXT, code_postal TEXT, address_full TEXT, website_url TEXT, pj_url TEXT, activites_pj TEXT, description TEXT, rating_pj TEXT, nb_avis_pj INTEGER, is_solocal INTEGER, solocal_tier TEXT, honeypot_score INTEGER, honeypot_flag TEXT, honeypot_reasons TEXT, api_nom_complet TEXT, api_dirigeant TEXT, api_effectifs TEXT, api_ca INTEGER, api_code_naf TEXT, api_forme_juridique TEXT, api_categorie TEXT, siret TEXT, siren TEXT, matched_via TEXT);
CREATE TABLE IF NOT EXISTS claude_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, activity_type TEXT, title TEXT, content TEXT, metadata TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS followups (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, scheduled_at TEXT, status TEXT DEFAULT 'pending', note TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS lead_segments (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, segment TEXT);
CREATE TABLE IF NOT EXISTS outreach_emails (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, subject TEXT, body TEXT, sent_at TEXT);
CREATE TABLE IF NOT EXISTS domains (domain TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS call_log (id INTEGER PRIMARY KEY AUTOINCREMENT, direction TEXT, provider TEXT, from_number TEXT, to_number TEXT, domain TEXT, status TEXT DEFAULT 'initiated', started_at TEXT, ended_at TEXT, duration_seconds INTEGER, recording_path TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS ovh_monthly_destinations (month TEXT NOT NULL, destination TEXT NOT NULL, call_count INTEGER DEFAULT 1, first_called_at TEXT, PRIMARY KEY (month, destination));

-- =====================================================================
-- Test data: existing leads (backward compat)
-- =====================================================================

-- Lead 1: fully enriched, backward-compat (kept from original seed)
INSERT OR IGNORE INTO results (
  domain, nom_entreprise, email_principal, phone_principal, phones, emails,
  cms, has_https, has_responsive, best_ville, best_cp, dept_computed,
  api_nom_complet, societe_name, siret, siren,
  api_dirigeant_prenom, api_dirigeant_nom, api_dirigeant_qualite,
  api_effectifs, api_code_naf, api_forme_juridique,
  final_url, title, enriched, enriched_via, api_etat,
  http_status, has_favicon, has_modern_images, has_minified_assets, has_compression,
  copyright_year, has_old_html,
  eclate_score, tech_score, lead_flags
) VALUES (
  'test-e2e.fr', 'Test E2E SAS', 'contact@test-e2e.fr', '0612345678',
  '["0612345678","0198765432"]', '["contact@test-e2e.fr","info@test-e2e.fr"]',
  'wordpress', 1, 1, 'Lyon', '69001', '69',
  'Test E2E SAS', 'Test E2E SAS', '12345678900010', '123456789',
  'Jean', 'Dupont', 'President',
  '11', '62.01Z', 'SAS',
  'https://test-e2e.fr', 'Test E2E - Site officiel', 1, 'siren', 'A',
  200, 1, 1, 1, 1,
  2022, 0,
  0, 0, 'has_phone,has_email,has_name,has_address,enriched,'
);

-- Lead 2: minimal, not enriched (backward compat)
INSERT OR IGNORE INTO results (
  domain, nom_entreprise, email_principal, societe_name,
  best_ville, best_cp, dept_computed, enriched,
  http_status, has_favicon, has_modern_images, has_minified_assets, has_compression,
  has_responsive, has_https
) VALUES (
  'minimal.fr', 'Minimal SARL', 'hello@minimal.fr', 'Minimal SARL',
  'Paris', '75001', '75', 0,
  200, 1, 1, 1, 1,
  1, 1
);

-- =====================================================================
-- New leads for /prospects page preset tests
-- =====================================================================

-- Lead 3: "top_prospects" preset
-- Requirements: eclate_score >= 2, phone, enriched=1, api_etat='A', active, not asso
INSERT OR IGNORE INTO results (
  domain, nom_entreprise, email_principal, phone_principal, phones, emails,
  cms, societe_name, api_nom_complet, siret, siren,
  api_dirigeant_prenom, api_dirigeant_nom, api_dirigeant_qualite,
  api_effectifs, api_code_naf, api_forme_juridique, api_categorie,
  best_ville, best_cp, dept_computed, api_etat, api_departement,
  enriched, enriched_via, final_url, title,
  http_status, has_responsive, has_https, copyright_year,
  has_old_html, has_flash, has_layout_tables, has_favicon,
  has_modern_images, has_minified_assets, has_compression,
  eclate_score, tech_score, lead_flags
) VALUES (
  'top-prospect-btp.fr', 'Durand Construction', 'contact@top-prospect-btp.fr', '0678901234',
  '["0678901234"]', '["contact@top-prospect-btp.fr"]',
  'wordpress', 'Durand Construction SARL', 'Durand Construction SARL', '98765432100011', '987654321',
  'Pierre', 'Durand', 'Gerant',
  '03', '43.21A', 'SARL', 'PME',
  'Villeurbanne', '69100', '69', 'A', '69',
  1, 'siren', 'http://top-prospect-btp.fr', 'Durand Construction - Maconnerie Lyon',
  200, 0, 0, 2017,
  1, 0, 0, 0,
  0, 0, 0,
  3, 52, 'has_phone,has_email,has_name,has_address,enriched,'
);

-- Lead 4: "btp_artisans" preset
-- Requirements: NAF 43.xx or 41.xx, enriched=1, api_etat='A'
INSERT OR IGNORE INTO results (
  domain, nom_entreprise, email_principal, phone_principal, phones, emails,
  cms, societe_name, api_nom_complet, siret, siren,
  api_dirigeant_prenom, api_dirigeant_nom, api_dirigeant_qualite,
  api_effectifs, api_code_naf, api_forme_juridique, api_categorie,
  best_ville, best_cp, dept_computed, api_etat, api_departement,
  enriched, enriched_via, final_url, title,
  http_status, has_responsive, has_https, copyright_year,
  has_old_html, has_favicon, has_modern_images, has_minified_assets, has_compression,
  eclate_score, tech_score, lead_flags
) VALUES (
  'plombier-lyon.fr', 'Plomberie Martin', 'info@plombier-lyon.fr', '0456789012',
  '["0456789012"]', '["info@plombier-lyon.fr"]',
  NULL, 'Plomberie Martin', 'Plomberie Martin SAS', '11223344500022', '112233445',
  'Marc', 'Martin', 'President',
  '02', '43.22A', 'SAS', 'PME',
  'Lyon', '69003', '69', 'A', '69',
  1, 'siren', 'https://plombier-lyon.fr', 'Plomberie Martin - Plombier Lyon',
  200, 1, 1, 2019,
  0, 1, 1, 1, 1,
  1, 5, 'has_phone,has_email,has_name,has_address,enriched,'
);

-- Lead 5: "sante_droit" preset
-- Requirements: NAF 86.xx or 69.xx or 71.xx, enriched=1, api_etat='A'
INSERT OR IGNORE INTO results (
  domain, nom_entreprise, email_principal, phone_principal, phones, emails,
  cms, societe_name, api_nom_complet, siret, siren,
  api_dirigeant_prenom, api_dirigeant_nom, api_dirigeant_qualite,
  api_effectifs, api_code_naf, api_forme_juridique, api_categorie,
  best_ville, best_cp, dept_computed, api_etat, api_departement,
  enriched, enriched_via, final_url, title,
  http_status, has_responsive, has_https, copyright_year,
  has_favicon, has_modern_images, has_minified_assets, has_compression,
  eclate_score, tech_score, lead_flags
) VALUES (
  'cabinet-avocat-paris.fr', 'Cabinet Lefevre Avocats', 'contact@cabinet-avocat-paris.fr', '0145678901',
  '["0145678901"]', '["contact@cabinet-avocat-paris.fr"]',
  'wordpress', 'Cabinet Lefevre', 'Cabinet Lefevre AARPI', '33445566700033', '334455667',
  'Anne', 'Lefevre', 'Avocate associee',
  '02', '69.10Z', 'AARPI', 'PME',
  'Paris', '75008', '75', 'A', '75',
  1, 'siren', 'https://cabinet-avocat-paris.fr', 'Cabinet Lefevre - Avocats Paris 8',
  200, 1, 1, 2020,
  1, 1, 1, 1,
  0, 2, 'has_phone,has_email,has_name,has_address,enriched,'
);

-- Lead 6: "commerce_services" preset
-- Requirements: NAF 56.xx (restauration), enriched=1, api_etat='A'
INSERT OR IGNORE INTO results (
  domain, nom_entreprise, email_principal, phone_principal, phones, emails,
  cms, societe_name, api_nom_complet, siret, siren,
  api_dirigeant_prenom, api_dirigeant_nom, api_dirigeant_qualite,
  api_effectifs, api_code_naf, api_forme_juridique, api_categorie,
  best_ville, best_cp, dept_computed, api_etat, api_departement,
  enriched, enriched_via, final_url, title,
  http_status, has_responsive, has_https, copyright_year,
  has_favicon, has_modern_images, has_minified_assets, has_compression,
  eclate_score, tech_score, lead_flags
) VALUES (
  'restaurant-grenoble.fr', 'Restaurant Le Petit Bistrot', 'contact@restaurant-grenoble.fr', '0476123456',
  '["0476123456"]', '["contact@restaurant-grenoble.fr"]',
  'wix', 'Le Petit Bistrot', 'Le Petit Bistrot SARL', '55667788900044', '556677889',
  'Sophie', 'Petit', 'Gerante',
  '01', '56.10A', 'SARL', 'TPE',
  'Grenoble', '38000', '38', 'A', '38',
  1, 'siren', 'https://restaurant-grenoble.fr', 'Le Petit Bistrot - Restaurant Grenoble',
  200, 1, 1, 2023,
  1, 1, 1, 1,
  0, 2, 'has_phone,has_email,has_name,has_address,enriched,'
);

-- Lead 7: "historique" preset (has outreach.last_visited set)
INSERT OR IGNORE INTO results (
  domain, nom_entreprise, email_principal, phone_principal,
  societe_name, api_nom_complet, siret, siren,
  api_code_naf, api_forme_juridique,
  best_ville, best_cp, dept_computed, api_etat, api_departement,
  enriched, enriched_via,
  http_status, has_responsive, has_https,
  has_favicon, has_modern_images, has_minified_assets, has_compression,
  eclate_score, tech_score, lead_flags
) VALUES (
  'historique-deja-vu.fr', 'Cabinet Leroy', 'contact@historique-deja-vu.fr', '0634567890',
  'Cabinet Leroy', 'Cabinet Leroy SAS', '99887766500044', '998877665',
  '69.10Z', 'SAS',
  'Marseille', '13001', '13', 'A', '13',
  1, 'siren',
  200, 1, 1,
  1, 1, 1, 1,
  0, 0, 'has_phone,has_email,has_name,has_address,enriched,'
);

-- Outreach entry for historique lead (marks it as visited)
INSERT OR IGNORE INTO outreach (domain, status, last_visited, updated_at)
VALUES ('historique-deja-vu.fr', 'contact_initial', '2026-03-20 14:30:00', '2026-03-20 14:30:00');

-- =====================================================================
-- Indexes matching what db.ts creates (needed for queries)
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_results_departement ON results(api_departement);
CREATE INDEX IF NOT EXISTS idx_results_naf ON results(api_code_naf);
CREATE INDEX IF NOT EXISTS idx_results_dept_computed ON results(dept_computed);
CREATE INDEX IF NOT EXISTS idx_results_enriched ON results(enriched);
CREATE INDEX IF NOT EXISTS idx_results_eclate ON results(eclate_score DESC);
CREATE INDEX IF NOT EXISTS idx_results_lead_flags ON results(lead_flags);
