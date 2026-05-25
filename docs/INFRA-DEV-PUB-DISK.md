# dev-pub — gestion du disque

> Runbook pour comprendre ce qui remplit `/dev/sda1` (72 GB) sur le dev
> server OVH (`ssh dev-pub`) et comment maintenir la marge propre.

## Contexte

`dev-pub` héberge :

- Le reverse proxy Traefik standalone (port 80/443)
- Toutes les apps staging Veridian (Hub, Prospection, Notifuse, Analytics, CMS, mailpit)
- Le container `prospection-ui-dev` (hot reload)
- 4-5 worktrees agents simultanés pour les vagues team-lead
- Les actions-runners GitHub self-hosted (`prospection`, `notifuse-veridian`)
- Les rsync `/tmp/*-megabattery` lancés depuis la machine locale Robert

À 7.6 G RAM / 72 GB disk, la marge est étroite. Une saturation à 100% ⇒
les containers staging crashent ⇒ promo prod bloquée (gate mega battery).

## Diagnostic en 30 secondes

```bash
ssh dev-pub 'df -h / && docker system df && du -sh /home /var/lib/docker /tmp /opt 2>/dev/null'
```

État sain attendu :

- `df -h /` : < 85% utilisé
- `docker system df` : reclaimable < 5 GB
- `/tmp` : < 3 GB
- `/home` : ~20-25 GB (worktrees + actions-runners + .pnpm/.npm cache)
- `/var/lib/docker` : ~25-30 GB (volumes Postgres clonés + overlay2)

## Anatomie de la masse disque (audit 2026-05-25, ~84%)

| Source | Taille | Maîtrisée par |
|---|---:|---|
| `/var/lib/docker/overlay2` | 19 GB | Docker (purgée par `image prune`) |
| `/var/lib/docker/volumes` | 9.3 GB | Volumes nommés (Postgres clones, Clickhouse) — NE PAS purger |
| `/home/ubuntu/.local` | 3.8 GB | pnpm store global + Claude state + trivy |
| `/home/ubuntu/actions-runner` | 2 GB | GitHub Actions runner self-hosted |
| `/home/ubuntu/prospection-ui-dev` | 1.7 GB | Hot reload UI dev container worktree |
| `/home/ubuntu/.nvm` | 1.7 GB | Multiples versions Node |
| `/home/ubuntu/.claude` | 1.7 GB | Agents Claude memory + transcripts |
| `/home/ubuntu/actions-runner-notifuse-veridian` | 1.6 GB | Runner self-hosted Notifuse |
| `/home/ubuntu/tramtech-new-website` | 1.4 GB | Worktree client (Tramtech) |
| `/home/ubuntu/notifuse-ui-dev` | 1.4 GB | UI dev container Notifuse |
| `/home/ubuntu/prospection-e2e-validate` | 1.2 GB | Worktree agent validation E2E |
| `/home/ubuntu/agent-V-mail-flows-runner` | 1.2 GB | Worktree agent V |
| `/home/ubuntu/veridian-hub-ui-dev` | 1.1 GB | UI dev Hub |
| `/home/ubuntu/.cache/ms-playwright` | 631 MB | Browsers Playwright |
| `/tmp/hub-megabattery` | 1.3 GB | rsync depuis machine Robert (mega battery Hub) |
| `/tmp/prosp-megabattery` | 1.2 GB | rsync depuis machine Robert (mega battery Prospection) |

## Sources de saturation récurrente (post-fix Agent J)

Le cron Agent J (`aefb87a`) nettoie `/tmp/prosp-crawler-*` à 04:00 UTC.
Reste à gérer :

1. **Images Docker non-référencées** : à chaque push staging, l'image `ghcr.io/christ-roy/<app>:staging-<sha>` est pull. La vieille reste référencée jusqu'au `image prune`. ~500 MB/run × 10-15 runs/jour = 5-7 GB/jour.
2. **`/tmp/*-megabattery/node_modules`** : `npm ci` rsync'é depuis local. ~1.2 GB par mega battery × 2-3 apps simultanées.
3. **Profils Playwright orphelins** : `/tmp/playwright_chromiumdev_profile-*` créés par les runs E2E qui crashent (pas de cleanup `--remove-orphans`).
4. **Containers stoppés `mega-runner`** : à chaque mega battery, un container Playwright reste arrêté (pas `--rm`).
5. **Volumes dangling** : rare, mais arrive sur `docker compose down -v` mal exécuté.

## Solution livrée — `scripts/infra/cleanup-dev-pub.sh`

Script idempotent qui couvre les 5 sources ci-dessus + un filet sur le
cleanup crawler. Tourne via timer systemd toutes les 24h à 03:00 UTC
(creux d'activité, avant le cron crawler à 04:00).

### Déploiement initial sur dev-pub

```bash
# Depuis la machine locale Robert (ou un worktree agent)
scp scripts/infra/cleanup-dev-pub.sh scripts/infra/install-cleanup-cron.sh \
    dev-pub:~/scripts/infra/

ssh dev-pub 'bash ~/scripts/infra/install-cleanup-cron.sh'

# Linger UNE fois pour que le timer user tourne sans session active
ssh dev-pub 'sudo loginctl enable-linger ubuntu'
```

### Lancer un cleanup manuel (debug / urgence)

```bash
ssh dev-pub 'bash ~/scripts/infra/cleanup-dev-pub.sh'

# OU via systemd (loggé dans journalctl) :
ssh dev-pub 'systemctl --user start cleanup-dev-pub.service'
ssh dev-pub 'journalctl --user -u cleanup-dev-pub.service -n 100 --no-pager'
```

### Voir le prochain run automatique

```bash
ssh dev-pub 'systemctl --user list-timers cleanup-dev-pub.timer'
```

### Désactiver temporairement (pendant un troubleshoot)

```bash
ssh dev-pub 'systemctl --user stop cleanup-dev-pub.timer'
# Réactiver :
ssh dev-pub 'systemctl --user start cleanup-dev-pub.timer'
```

## Ce que le script NE fait PAS

Volontairement laissé manuel pour éviter de péter du contexte agent :

- **Worktrees `/home/ubuntu/agent-*`** : à archiver à la fin d'une vague. Le team-lead s'en charge en fin de session.
- **`/home/ubuntu/.local/share/claude`** : transcripts Claude — Robert décide quand purger.
- **Volumes Docker nommés** (`postgres-staging_pgdata`, `notifuse-staging-db-data`...) : data staging vivante, jamais auto-purgée.
- **`/var/lib/docker/containers/*-json.log`** : déjà géré par `/etc/docker/daemon.json` (rotation 10MB × 3 files).

## Anti-patterns à éviter

- ❌ `docker system prune -af --volumes` : tue les volumes nommés (Postgres staging) ⇒ data loss
- ❌ `rm -rf /tmp/prosp-*` en user ubuntu : fichiers root-owned du container Playwright, échec silencieux (cf incident 2026-05-23)
- ❌ `docker logs -f` qui tourne en background sans `tail` : pas de problème de logs (rotation OK) mais consomme RAM
- ❌ Toucher `/var/lib/docker` à la main : Docker peut s'en mêler ⇒ corruption

## Historique des incidents

- **2026-05-23** : `nospc` pendant un run E2E. Cause : cleanup crawler en user ubuntu échouait sur fichiers root-owned. Fix : `aefb87a` (cleanup via container alpine).
- **2026-05-25** : disque à 96% en fin de vague 8 agents. Cause : pas de cron auto pour `image prune` + résidus megabattery + profils Playwright orphelins. Fix : ce script + timer 03:00 UTC.

## Liens utiles

- Memory : `[[project_staging_dev_server]]`
- Ticket : `todo/2026-05-24-dev-pub-disque-saturation-recurrente.md`
- README Traefik staging : `dev-pub:~/traefik-staging/README.md`
- Daemon Docker config : `dev-pub:/etc/docker/daemon.json` (log rotation déjà OK)
