-- Revert W7b "Refill leads page native ICP" — verdict audit sur-ingénierie.
-- La table `lead_orders` doublonnait `lead_credit_events` sans usage prod
-- (0 client payant). On revient à `lead_credit_events` comme source de vérité.
-- CASCADE pour purger les FK éventuelles (aucune en pratique côté Prisma).
DROP TABLE IF EXISTS lead_orders CASCADE;
