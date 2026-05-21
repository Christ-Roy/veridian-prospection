-- Sprint B dette tech : DROP COLUMN tenants.subscription_id
-- Colonne UUID jamais remplie (0 rows non-null staging + prod 2026-05-21).
-- Source de vérité Stripe = Hub (contrat §7.4). Prospection ne tracke
-- pas de subscription locale.
ALTER TABLE tenants DROP COLUMN IF EXISTS subscription_id;
