\set ON_ERROR_STOP on
BEGIN;
-- colonnes claires pour le filtre commercial "site éclaté"
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS web_tier TEXT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS web_is_obsolete BOOLEAN;
CREATE INDEX IF NOT EXISTS idx_ent_web_tier ON entreprises(web_tier) WHERE web_tier IS NOT NULL;

CREATE TEMP TABLE _w (siren TEXT, web_score INT, web_tier TEXT, is_obsolete BOOLEAN, has_https BOOLEAN, has_responsive BOOLEAN) ON COMMIT DROP;
\copy _w FROM '/tmp/web_enrich.csv' WITH (FORMAT CSV, HEADER true);
-- filtre SIREN valides (9 chiffres, pas que des zéros)
DELETE FROM _w WHERE siren !~ '^[0-9]{9}$' OR siren = '000000000';

-- UPDATE non-destructif : remplit web_tier/is_obsolete (neuf), complète has_https/responsive NULL,
-- complète web_tech_score NULL (ne PAS écraser le legacy existant)
UPDATE entreprises e SET
  web_tier = w.web_tier,
  web_is_obsolete = w.is_obsolete,
  web_has_https = COALESCE(e.web_has_https, w.has_https),
  web_has_responsive = COALESCE(e.web_has_responsive, w.has_responsive),
  web_tech_score = COALESCE(e.web_tech_score, w.web_score)
FROM _w w WHERE e.siren = w.siren;
COMMIT;

SELECT 'fiches avec web_tier' m, to_char(count(*),'FM999G999G999') v FROM entreprises WHERE web_tier IS NOT NULL
UNION ALL SELECT 'sites obsolètes', to_char(count(*),'FM999G999G999') FROM entreprises WHERE web_is_obsolete=true
UNION ALL SELECT 'outreach intact', to_char(count(*),'FM999G999G999') FROM outreach;
