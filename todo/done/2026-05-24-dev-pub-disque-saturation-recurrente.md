# [PROSPECTION] dev-pub saturation disque récurrente — 96% atteint après vague d'agents

> **Type** : Infra / observability
> **Sévérité** : 🟡 P1 — chaque salve d'agents fait monter le disque dev-pub. Le cleanup /tmp/prosp-crawler-* d'Agent J (commit aefb87a) fonctionne pour CE périmètre, mais autre chose remplit.
> **Owner** : agent Prospection (ou Infra cross-app)
> **Créé** : 2026-05-24
> **Découvert par** : team-lead pendant cleanup session 2026-05-23

## État au moment du ticket

```
df -h / sur dev-pub :
/dev/sda1   72G  69G  3.6G  96%

du -sh /home /var/lib/docker /tmp /opt :
  23G  /home
  36G  /var/lib/docker
  1.3G /tmp
  524M /opt

docker system df :
  Images:        17 total, 14 active, 6.868 GB, 2.639 GB reclaimable (38%)
  Containers:    18 total, 18 active, 625.7 MB
  Local Volumes: 14 total, 14 active, 20.14 GB, 0 reclaimable
  Build Cache:   0
```

## Constat

- Le cleanup /tmp/prosp-crawler-* via container alpine (commit `aefb87a` Agent J) **marche** : `/tmp` = 1.3 GB seulement après une journée d'agents.
- Mais le disque a quand même grimpé de 87% (session début) → 96% (session fin) en ~5h d'activité agents.
- Coupables probables (par ordre de masse) :
  - `/var/lib/docker` : 36 GB. Volumes Docker (clones DB staging postgres-staging, hub-staging-db, notifuse-staging-db, analytics-engine-clickhouse).
  - `/home` : 23 GB. Probablement `/home/ubuntu/prospection-staging/`, `/tmp/prosp-megabattery/` rsync, etc.
  - 2.64 GB d'images Docker reclaimable.

## Quick win — image prune

Action low-risk immédiate :
```bash
ssh dev-pub 'docker image prune -af'   # supprime les images non-utilisées (dangling + unreferenced)
```
Libère ~2.64 GB (38% de la masse images).

## Investigation à mener

1. **Identifier ce qui pèse dans `/home`** :
   ```bash
   ssh dev-pub 'sudo du -h /home --max-depth=2 | sort -rh | head -20'
   ```
   Cibles potentielles : prospection-staging, prospection-ui-dev, worktrees agents, logs containers (`docker logs` rotation ?).

2. **Logs containers** :
   ```bash
   ssh dev-pub 'sudo du -h /var/lib/docker/containers/*/*-json.log | sort -rh | head -10'
   ```
   Si > 100 MB/container, configurer log rotation Docker (`/etc/docker/daemon.json` avec `log-opts`).

3. **Volumes Docker orphelins** :
   ```bash
   ssh dev-pub 'docker volume ls -qf dangling=true'
   ```
   À supprimer.

4. **Cleanup auto** : ajouter un cron quotidien `docker system prune -af --volumes` (avec garde-fou — pas pendant les heures de prod).

## Pourquoi P1 et pas P0

- Staging encore fonctionnel à 96% (les containers tournent, healthcheck OK)
- Mais la marge de 3.6 GB ne tient pas un autre run mega battery + npm ci (~600 MB) sans risque ENOSPC
- Si on dépasse 100% → containers crashent → indisponibilité staging → impossible de valider la prochaine promo prod (gate mega battery cassé)

## Lien

- Cleanup /tmp Agent J : `todo/done/2026-05-23-dev-pub-cleanup-crawler-tmp-residuels.md`
- Memory : [[project_staging_dev_server]]
