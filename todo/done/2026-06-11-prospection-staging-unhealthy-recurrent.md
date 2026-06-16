# prospection-staging unhealthy récurrent sur dev-pub

> **Sévérité** : 🟡 P1
> **Owner** : agent prospection
> **Créé** : 2026-06-11
> **Auteur** : agent CMS (vu en passant pendant le fix des alertes Telegram dev)

## Constat

Le container `prospection-staging-prospection-1` sur dev-pub passe
**unhealthy ≥ 5 minutes** de façon récurrente — 3 alertes docker-monitor en
~40h :

```
Jun 10 14:13:34  ALERT: Container prospection-staging-prospection-1 unhealthy for 5+ minutes
Jun 10 22:14:47  ALERT: Container prospection-staging-prospection-1 unhealthy for 5+ minutes
Jun 11 06:16:13  ALERT: Container prospection-staging-prospection-1 unhealthy for 5+ minutes
```

Également vu : `tunnel-bridge` en restart-loop (10 restarts, seuil 3) le
2026-06-10 14:19 — à vérifier s'il est dans votre périmètre ou celui d'infra.

## Demande

Diagnostiquer pourquoi le healthcheck staging flappe (mémoire ? DB ? healthcheck
trop strict ?) : `ssh dev-pub "docker inspect prospection-staging-prospection-1
--format '{{json .State.Health}}' | jq; docker logs prospection-staging-prospection-1 --tail 100"`

## Contexte

Ces alertes partaient sur le Telegram de Robert. Depuis le 2026-06-11 les
alertes containers du dev server sont mutées (journald only, cf.
`veridian-infra/infra/monitoring/README.md`) — donc **plus personne ne les
verra passer** : si le flapping cache un vrai problème staging, c'est ce
ticket qui en garde la trace.

---

## ✅ Résolu — 2026-06-16 (agent prospection)

**Cause racine** : le flapping unhealthy n'était pas un healthcheck trop strict — le
container **et le volume `postgres-staging`** avaient été **supprimés** de dev-pub
(probablement un `docker volume prune` lors d'un cleanup disque, dev-pub à 83%).
L'app pointait sur `postgres-staging:5432` injoignable → 503 permanent → unhealthy,
et la CI staging plantait à `prisma migrate deploy`.

**Défaut de conception sous-jacent** : Prospection était la **seule** app dont la DB
staging n'était PAS déclarée dans son compose versionné (contrairement à
hub-staging-db / notifuse-staging-db / crm-postgres). DB "à la main" = non
reproductible = un cleanup l'efface définitivement.

**Fix (voie propre)** :
1. Service `postgres-staging` (postgres:16-alpine, volume nommé, healthcheck)
   déclaré dans `infra/docker-compose.staging.yml` → reproductible, survit aux cleanups.
2. DB recréée + schéma cible via `prisma db push` (35 models) car l'historique de
   migrations est cassé from-scratch (→ ticket 2026-06-16-historique-migrations-prisma-divergent).
3. 31 migrations baselinées `--applied` → `migrate deploy` CI redevient idempotent.
4. App recréée → healthy en 15s, `/api/status` db:ok auth:ok.

Prod intacte (fix isolé à l'override staging, base+prod inchangés).
