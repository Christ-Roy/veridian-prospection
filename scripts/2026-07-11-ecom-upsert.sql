-- 2026-07-11-ecom-upsert.sql — UPSERT NON-DESTRUCTIF des signaux e-commerce ODH
-- dans les colonnes fines de `entreprises` (voir 2026-07-11-ecom-columns.sql).
--
-- Contexte : le détecteur ecom_signals v13 (ODH, 2026-07-06) exporte un CSV par
-- NIVEAU (leads_ecom_boutique_0706.csv, leads_ecom_catalogue_0706.csv). Ce
-- script charge UN CSV et fixe UN niveau via la variable psql :ecom_level.
--
-- ⭐ RÈGLE QUALITÉ (QA ODH, non négociable) :
--    Le VRAI filtre de fiabilité = ecom_platform renseigné (248K boutiques HAUTE
--    CONF). ecom_level='catalogue' = signal LÂCHE ("potentiel"). has_payment est
--    SOUS-DÉTECTÉ (9K lignes) → on le stocke pour info mais on ne l'utilise JAMAIS
--    comme filtre qualité.
--
-- NON-DESTRUCTIF (COALESCE partout) : on ne remplit QUE les trous, on n'écrase
-- jamais une valeur déjà posée. Ces SIREN EXISTENT DÉJÀ en prod (livrés par le
-- GIGA upload ODH) → on UPDATE, on N'INSÈRE PAS de nouvelle ligne entreprise.
--
-- Idempotent : re-lançable, les COALESCE rendent le 2e passage no-op.
--
-- USAGE (le lead lance, un CSV = un niveau) :
--   psql "$DATABASE_URL" \
--     -v ecom_level=boutique \
--     -c "\copy stg_ecom FROM 'leads_ecom_boutique_0706.csv' WITH (FORMAT csv, HEADER true)" ...
--   → plus simple : décommenter les 2 lignes \set + \copy ci-dessous et lancer -f.
--
--   Header CSV attendu (ordre EXACT, niveau boutique) :
--   domain,ecom_platform,has_payment,ecom_keyword_score,siren,siret,nom,
--   nom_sirene,email_principal,phone_principal,phones,code_postal,
--   departement,ville_mentionnee
--
-- 🔴 PIÈGE VÉRIFIÉ (lead 2026-07-11) : le CSV CATALOGUE a un header DIFFÉRENT
--    (10 colonnes, PAS de ecom_platform/has_payment, SIREN en 3e position) :
--      domain,ecom_keyword_score,siren,siret,nom,email_principal,
--      phone_principal,phones,code_postal,departement
--    → NE PAS charger le catalogue dans stg_ecom (14 col) : les colonnes se
--      décaleraient et corrompraient les données. Pour le catalogue, utiliser
--      la table stg_ecom_catalogue + le bloc CATALOGUE dédié en bas de fichier.
--    Le catalogue n'a PAS de plateforme (par définition : signal lâche) — on ne
--    pose donc que ecom_level='catalogue' + ecom_keyword_score.

\set ON_ERROR_STOP on

-- Niveau du lot chargé. Le lead surcharge via -v ecom_level=catalogue si besoin.
-- (Sur psql, une var passée en -v prend le pas ; ce \set n'est qu'un défaut.)
\set ecom_level 'boutique'

BEGIN;

-- Table de staging éphémère : UNLOGGED (pas de WAL → rapide), tout en text
-- (on caste au moment de l'UPDATE). Ordre des colonnes = header CSV ci-dessus.
CREATE UNLOGGED TABLE IF NOT EXISTS stg_ecom (
  domain             text,
  ecom_platform      text,
  has_payment        text,
  ecom_keyword_score text,
  siren              text,
  siret              text,
  nom                text,
  nom_sirene         text,
  email_principal    text,
  phone_principal    text,
  phones             text,
  code_postal        text,
  departement        text,
  ville_mentionnee   text
);

-- Repartir propre à chaque run (idempotence du chargement).
TRUNCATE stg_ecom;

-- \copy du CSV → stg_ecom. Chargé par le lead (un CSV = un niveau). Exemple :
-- \copy stg_ecom FROM '/chemin/leads_ecom_boutique_0706.csv' WITH (FORMAT csv, HEADER true)

-- UPSERT non-destructif par siren. COALESCE(e.col, source) = on ne remplit que
-- les trous ; jamais d'écrasement d'une valeur app déjà présente.
--   - ecom_level      : le niveau du lot (:'ecom_level'), posé si absent.
--   - ecom_platform   : ⭐ filtre qualité — plateforme identifiée = e-com confirmé.
--   - ecom_has_payment: stocké pour info, NON fiable comme filtre (sous-détecté).
--   - web_has_ecommerce (legacy) : on ne le "répare" QUE pour une boutique et
--     seulement s'il est NULL — on ne contredit jamais une valeur legacy posée.
-- Le garde s.siren ~ '^[0-9]{9}$' écarte les SIREN malformés du CSV.
UPDATE entreprises e SET
  ecom_level              = COALESCE(e.ecom_level, :'ecom_level'),
  ecom_platform           = COALESCE(e.ecom_platform, NULLIF(s.ecom_platform, '')),
  ecom_has_payment        = COALESCE(e.ecom_has_payment, NULLIF(s.has_payment, '')::boolean),
  ecom_keyword_score      = COALESCE(e.ecom_keyword_score, NULLIF(s.ecom_keyword_score, '')::int),
  web_has_ecommerce       = COALESCE(
                              e.web_has_ecommerce,
                              CASE WHEN :'ecom_level' = 'boutique' THEN true ELSE e.web_has_ecommerce END
                            )
FROM stg_ecom s
WHERE e.siren = s.siren
  AND s.siren ~ '^[0-9]{9}$';

COMMIT;

-- Contrôle : répartition par niveau + volume avec plateforme (= HAUTE CONF).
SELECT
  count(*) FILTER (WHERE ecom_level = 'boutique')        AS boutiques,
  count(*) FILTER (WHERE ecom_level = 'catalogue')       AS catalogues,
  count(*) FILTER (WHERE ecom_platform IS NOT NULL)      AS avec_plateforme_haute_conf
FROM entreprises;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOC CATALOGUE (header CSV DIFFÉRENT — cf PIÈGE en tête de fichier).
-- À lancer SÉPARÉMENT pour leads_ecom_catalogue_0706.csv. Ne PAS mélanger avec
-- le bloc boutique ci-dessus (staging table différente).
-- ════════════════════════════════════════════════════════════════════════════
--
-- BEGIN;
-- CREATE UNLOGGED TABLE IF NOT EXISTS stg_ecom_catalogue (
--   domain             text,
--   ecom_keyword_score text,
--   siren              text,
--   siret              text,
--   nom                text,
--   email_principal    text,
--   phone_principal    text,
--   phones             text,
--   code_postal        text,
--   departement        text
-- );
-- TRUNCATE stg_ecom_catalogue;
-- \copy stg_ecom_catalogue FROM '/chemin/leads_ecom_catalogue_0706.csv' WITH (FORMAT csv, HEADER true)
--
-- -- Catalogue = "potentiel e-commerce" : PAS de plateforme, on pose juste le
-- -- niveau + le score. NON-DESTRUCTIF (ne pose ecom_level que s'il est NULL, et
-- -- ne dégrade JAMAIS une 'boutique' déjà posée en 'catalogue').
-- UPDATE entreprises e SET
--   ecom_level         = COALESCE(e.ecom_level, 'catalogue'),
--   ecom_keyword_score = COALESCE(e.ecom_keyword_score, NULLIF(s.ecom_keyword_score, '')::int)
-- FROM stg_ecom_catalogue s
-- WHERE e.siren = s.siren
--   AND s.siren ~ '^[0-9]{9}$';
-- COMMIT;
