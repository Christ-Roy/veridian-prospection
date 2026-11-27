-- Retrait de la file d'échos vers le Hub (décision A, 27/11). Second temps : depuis 0b8821e, aucun code
-- ne lit ni n'écrit cette table (garde : __tests__/lib/hub-webhook/aucun-echo.test.ts). Table vide au DROP ;
-- 792 lignes historiques archivées, dump complet de la base au froid :
-- r2:veridian-backups/prospection/manuel/20261127-drop-outbox/.
DROP TABLE IF EXISTS "webhook_outbox";
