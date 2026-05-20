-- Migration 0008: Ajout des colonnes login_token Prospection sur Tenant local.
--
-- Contexte : avant 2026-05-20, le flow autologin Hub→Prospection passait
-- par la table Supabase `tenants` (legacy). Le `auth/token/route.ts`
-- lookupait le token dans Supabase. Maintenant Supabase est dégagé côté
-- Prospection runtime → on stocke le token en local Prisma à la place.
--
-- Cf todo/2026-05-20-auth-token-hmac-fix-and-supabase-cleanup.md.
--
-- Additif uniquement (3 colonnes nullable). Zero downtime.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS prospection_login_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS prospection_login_token_created_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS prospection_login_token_used_at TIMESTAMPTZ;

-- Index pour le lookup token → tenant (validation autologin).
-- Le token est unique de fait (random 32 bytes hex) mais on n'impose pas
-- UNIQUE constraint pour ne pas bloquer un re-provision juste avant l'expiration.
CREATE INDEX IF NOT EXISTS tenants_prospection_login_token_idx
  ON tenants(prospection_login_token)
  WHERE prospection_login_token IS NOT NULL;
