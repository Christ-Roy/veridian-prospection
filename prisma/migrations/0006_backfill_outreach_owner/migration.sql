-- Migration 0006: Backfill outreach.user_id sur les lignes legacy.
--
-- Contexte : avant l'introduction du multi-membre (cf
-- todo/2026-05-19-audit-bugs-prospect-status-cross-membre.md), les outreach
-- étaient créés sans user_id. Tous appartenaient implicitement au seul user
-- du tenant. Maintenant qu'on bascule en mode "visibility par owner" pour
-- éviter les doubles appels entre commerciaux, ces lignes orphelines
-- doivent être attribuées explicitement à l'owner du tenant.
--
-- Sans cette migration, les outreach historiques (status != 'a_contacter')
-- réapparaîtraient dans /prospects pour tous les nouveaux membres du
-- workspace — chaos.
--
-- Idempotent : ne touche que les lignes user_id IS NULL.
-- Audit avant lancement (prod 2026-05-19) : 189 lignes orphelines, toutes
-- sur le tenant 359b76d5-bab7-4773-a889-cf4cf0248869 (Robert).

UPDATE outreach o
SET user_id = t.user_id
FROM tenants t
WHERE o.tenant_id = t.id
  AND o.user_id IS NULL
  AND t.user_id IS NOT NULL;
