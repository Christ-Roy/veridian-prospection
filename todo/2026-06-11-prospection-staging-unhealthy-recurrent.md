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
