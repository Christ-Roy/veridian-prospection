-- normalize_odh_contacts.sql — ÉTAPE DE PROPRETÉ post-ingestion ODH.
--
-- Contexte : ODH livre du BRUT (colonnes best_phone au format '0123456789',
-- best_email non normalisé). L'app prospection lit les colonnes CANONIQUES
-- normalisées : best_phone_e164 ('+33...') et best_email_normalized. Sans cette
-- normalisation, les fiches importées d'ODH sont invisibles dans le dashboard
-- (le filtre requirePhone/COLUMN_MAP lit best_phone_e164).
--
-- Règle : les colonnes _e164 / _normalized sont LA vérité (contrat app).
-- C'est la prospection qui raffine le brut ODH, pas ODH.
--
-- À LANCER APRÈS CHAQUE upsert ODH (upsert_prod.sql). Idempotent + non-destructif
-- (ne remplit QUE les colonnes canoniques vides, n'écrase jamais une valeur app).
-- Format téléphone : '0X########' (10 ch.) → '+33X########' ; '+33#########' gardé tel quel.

BEGIN;

-- Téléphone canonique depuis le brut ODH
UPDATE entreprises SET best_phone_e164 =
  CASE
    WHEN best_phone ~ '^0[1-9][0-9]{8}$'  THEN '+33' || substr(best_phone, 2)
    WHEN best_phone ~ '^\+33[0-9]{9}$'    THEN best_phone
  END
WHERE best_phone_e164 IS NULL
  AND best_phone IS NOT NULL
  AND (best_phone ~ '^0[1-9][0-9]{8}$' OR best_phone ~ '^\+33[0-9]{9}$');

-- Email canonique depuis le brut ODH
UPDATE entreprises SET best_email_normalized = lower(trim(best_email))
WHERE best_email_normalized IS NULL
  AND best_email IS NOT NULL
  AND best_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

-- Flags par défaut manquants sur les fiches ODH. Le filtre par défaut du
-- dashboard (DEFAULT_ENTREPRISES_WHERE = "is_registrar=false AND
-- COALESCE(ca_suspect,false)=false") EXCLUT les NULL (NULL != false en SQL).
-- ODH ne pose pas ces flags → les nouvelles fiches seraient invisibles. On pose
-- false explicite (ce sont des entreprises normales, pas des registrars ; ODH a
-- déjà exclu assos/admin/GE en amont). Non-destructif : ne touche que les NULL.
UPDATE entreprises SET is_registrar = false WHERE is_registrar IS NULL;
UPDATE entreprises SET ca_suspect   = false WHERE ca_suspect   IS NULL;

COMMIT;

-- Contrôle
SELECT
  count(*) FILTER (WHERE best_phone_e164 IS NOT NULL)      AS avec_tel_canonique,
  count(*) FILTER (WHERE best_email_normalized IS NOT NULL) AS avec_email_canonique
FROM entreprises;
