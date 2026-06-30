-- Index trigram GIN sur web_domain_normalized : la barre de recherche prospects
-- cherche désormais aussi par nom de domaine (cas le plus fréquent en prospection
-- de sites web). Sans cet index, un ILIKE '%domaine%' sur 1,3M lignes = seq scan
-- ~1,6s. Avec : ~9ms (BitmapOr avec les autres trgm denom/dirigeant/email).
-- CONCURRENTLY : ne bloque pas la table pendant la construction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_webdomain_trgm
  ON entreprises USING gin (web_domain_normalized gin_trgm_ops);
