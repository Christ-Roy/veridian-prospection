-- Migration 0007: Sync outreach.status ↔ outreach.pipeline_stage sur les
-- 66 lignes désync existantes (staging au 2026-05-20 : 50 archive-like + 16
-- intermédiaires legacy).
--
-- Contexte : avant l'introduction du helper canonique
-- src/lib/outreach/status.ts (2026-05-20), les writers métier (phone
-- webhooks, mail send, lead-sheet dismiss) écrivaient `status` SANS toucher
-- `pipeline_stage`, et inversement. Conséquence :
--   - /historique affichait un status désynchronisé du kanban
--   - 50 leads avec status='hors_cible'/'pas_interesse' mais pipeline_stage='fiche_ouverte'
--   - 16 leads avec status='appele'/'rappeler'/'interesse' mais pipeline_stage figé
--
-- Le code applicatif est maintenant cohérent à 100% (cf
-- src/lib/outreach/status.ts:STATUS_TO_PIPELINE). Cette migration applique
-- le même mapping en SQL pur sur l'historique.
--
-- Idempotent : un re-run ne touche aucune ligne déjà cohérente.

UPDATE outreach
SET pipeline_stage = CASE status
  -- Stages canoniques (déjà identiques) : pas de changement
  WHEN 'fiche_ouverte' THEN 'fiche_ouverte'
  WHEN 'repondeur' THEN 'repondeur'
  WHEN 'a_rappeler' THEN 'a_rappeler'
  WHEN 'site_demo' THEN 'site_demo'
  WHEN 'acompte' THEN 'acompte'
  WHEN 'finition' THEN 'finition'
  WHEN 'client' THEN 'client'
  WHEN 'upsell' THEN 'upsell'
  -- Stages terminaux : forcés (le commercial a le dernier mot)
  WHEN 'archive' THEN 'archive'
  WHEN 'pas_interesse' THEN 'pas_interesse'
  WHEN 'hors_cible' THEN 'hors_cible'
  WHEN 'disqualifie' THEN 'hors_cible'
  WHEN 'non_qualifie' THEN 'hors_cible'
  WHEN 'non_pertinent' THEN 'hors_cible'
  WHEN 'rejete' THEN 'hors_cible'
  WHEN 'a_ignorer' THEN 'hors_cible'
  WHEN 'skip' THEN 'archive'
  WHEN 'skip_qualifie' THEN 'archive'
  WHEN 'email_invalide' THEN 'archive'
  -- Stages intermédiaires legacy → stage canonique le plus proche
  WHEN 'appele' THEN 'repondeur'
  WHEN 'rappeler' THEN 'a_rappeler'
  WHEN 'contacte' THEN 'repondeur'
  WHEN 'interesse' THEN 'site_demo'
  WHEN 'rdv' THEN 'site_demo'
  WHEN 'qualified' THEN 'a_rappeler'
  WHEN 'en_attente' THEN 'fiche_ouverte'
  WHEN 'en_observation' THEN 'a_rappeler'
  WHEN 'a_contacter' THEN 'fiche_ouverte'
  -- Fallback : préserve l'existant si status inconnu
  ELSE COALESCE(pipeline_stage, 'fiche_ouverte')
END
WHERE pipeline_stage IS DISTINCT FROM (
  CASE status
    WHEN 'fiche_ouverte' THEN 'fiche_ouverte'
    WHEN 'repondeur' THEN 'repondeur'
    WHEN 'a_rappeler' THEN 'a_rappeler'
    WHEN 'site_demo' THEN 'site_demo'
    WHEN 'acompte' THEN 'acompte'
    WHEN 'finition' THEN 'finition'
    WHEN 'client' THEN 'client'
    WHEN 'upsell' THEN 'upsell'
    WHEN 'archive' THEN 'archive'
    WHEN 'pas_interesse' THEN 'pas_interesse'
    WHEN 'hors_cible' THEN 'hors_cible'
    WHEN 'disqualifie' THEN 'hors_cible'
    WHEN 'non_qualifie' THEN 'hors_cible'
    WHEN 'non_pertinent' THEN 'hors_cible'
    WHEN 'rejete' THEN 'hors_cible'
    WHEN 'a_ignorer' THEN 'hors_cible'
    WHEN 'skip' THEN 'archive'
    WHEN 'skip_qualifie' THEN 'archive'
    WHEN 'email_invalide' THEN 'archive'
    WHEN 'appele' THEN 'repondeur'
    WHEN 'rappeler' THEN 'a_rappeler'
    WHEN 'contacte' THEN 'repondeur'
    WHEN 'interesse' THEN 'site_demo'
    WHEN 'rdv' THEN 'site_demo'
    WHEN 'qualified' THEN 'a_rappeler'
    WHEN 'en_attente' THEN 'fiche_ouverte'
    WHEN 'en_observation' THEN 'a_rappeler'
    WHEN 'a_contacter' THEN 'fiche_ouverte'
    ELSE COALESCE(pipeline_stage, 'fiche_ouverte')
  END
);
