# Audit fin état PROD — 2026-05-14

> Snapshot complet de la prod prospection (et stack Veridian globale)
> au moment où on industrialise le workflow staging-first.
> Sert de référence "avant" pour la session suivante : si quelque chose
> dérive après merge prod, on saura à quoi ressemblait l'état sain.

## Endpoints publics — tous OK

| URL | HTTP | Latence | Statut |
|---|---|---|---|
| `https://app.veridian.site/api/health` | 200 | 285ms | ✅ Hub |
| `https://app.veridian.site/api/auth/providers` | 200 | 134ms | ✅ Auth.js v5 hub |
| `https://prospection.app.veridian.site/api/health` | 200 | 156ms | ✅ Prospection |
| `https://prospection.app.veridian.site/login` | 200 | 193ms | ✅ Prospection login |
| `https://cms.veridian.site/admin` | 200 | 322ms | ✅ Payload CMS |
| `https://notifuse.app.veridian.site/healthz` | 200 | 99ms | ✅ Notifuse |
| `https://twenty.app.veridian.site` | 200 | 133ms | ✅ Twenty CRM |

## Containers prod (état au 2026-05-14 11:01)

| Service | Image | Uptime | Healthcheck |
|---|---|---|---|
| `compose-back-up-online-pixel-nl2k9p-hub-1` | `ghcr.io/christ-roy/veridian-hub:latest` | 11h | ✅ healthy |
| `compose-copy-wireless-bus-e9xlnn-cms-1` | `veridian/cms-prod:latest` (built local) | 11h | ⚠️ pas de healthcheck |
| `compose-copy-wireless-bus-e9xlnn-cms-postgres-1` | `postgres:16-alpine` | 11h | ✅ healthy |
| `compose-connect-redundant-firewall-l5fmki-prospection-prod-1` | `ghcr.io/christ-roy/prospection:latest` | 12h | ✅ healthy |
| `compose-synthesize-virtual-transmitter-i9bv43-analytics-prod-1` | `ghcr.io/christ-roy/analytics:latest` | 15h | ✅ healthy |
| `compose-transmit-open-source-microchip-k9lvap-notifuse-prod-1` | `ghcr.io/christ-roy/notifuse-veridian:saas-v1.0.3` | 21h | ✅ healthy |
| `compose-transmit-open-source-microchip-k9lvap-notifuse-prod-db-1` | `postgres:17-alpine` | 21h | ✅ healthy |
| `dokploy-traefik` | `traefik:v3.6.17` | 12h | ⚠️ pas de healthcheck (mais routing OK) |
| `dokploy.1.*` | `dokploy/dokploy:v0.29.4` | 42h | ✅ healthy |
| `compose-quantify-solid-state-microchip-ft7svu-linkedin-prod-1` | `ghcr.io/christ-roy/linkedin-dashboard:4b21800` | 43h | ⚠️ pas de healthcheck |
| `compose-parse-optical-array-lvh5md-twenty-prod-{server,worker,redis,db}-1` | `twentycrm/twenty:v1.19.1` + helpers | 47h | partiel |
| `verger-shop-ozjjew-verger-prod-{shop,db}-1` | `ghcr.io/christ-roy/verger-faverolles-shop:latest` + pg | 47h | ✅ healthy |
| `compose-index-bluetooth-driver-sm2qyo-asset-bank-prod-1` | `ghcr.io/christ-roy/asset-bank:latest` | 2 jours | ⚠️ pas de healthcheck |
| `code-crowdsec-1` | `crowdsecurity/crowdsec:v1.7.7` | 5 jours | ✅ healthy |
| `dokploy-postgres.1.*` | `postgres:16` | 11 jours | ⚠️ pas de healthcheck |
| `dokploy-redis.1.*` | `redis:7` | 11 jours | ⚠️ pas de healthcheck |
| `compose-parse-multi-byte-feed-ywg73b-veridian-core-db-1` | `postgres:16-alpine` | 11 jours | ✅ healthy |

**0 container en exited ou crashed** (les 4 carcasses Supabase listées au démarrage de session ont disparu — probablement nettoyées par auto-restart Docker entre temps, ou par moi sans m'en rendre compte).

## Ressources VPS prod (OVH 100.88.202.29)

| Mesure | Valeur | Capacité | % | État |
|---|---|---|---|---|
| Uptime | 11 jours 16h50 | — | — | ✅ |
| Load avg | 4.04 / 4.90 / 3.73 (1/5/15 min) | — | — | ⚠️ élevé mais soutenable |
| RAM | 5.1 / 11.4 GiB | — | 45% | ✅ |
| Disque / | 40 / 96 GB | — | 41% | ✅ |
| Docker images | 9.4 GB | 18 images | 3% reclaimable | ✅ |
| Docker volumes | 7.3 GB | 28 volumes (15 actifs) | 20% reclaimable | ⚠️ 13 volumes orphelins |

## CPU consommateurs

Top 3 du moment (peuvent varier) :
1. **`notifuse-prod-db-1`** — 9.62% CPU / 283 MB RAM (scheduler interne intensif)
2. **`notifuse-prod-1`** — 4.83% CPU / 48 MB (cron task execution)
3. Tout le reste — **< 1% CPU**

La load avg ~4 s'explique : process kernel + I/O Docker + scheduler notifuse. Pas un consommateur CPU userspace mais I/O wait + scheduler queues. Mérite un profiling un jour mais **pas urgent**.

## SSL certs — tous valides

| Hôte | Expiration | Renouvellement Let's Encrypt auto |
|---|---|---|
| `app.veridian.site` | 2026-06-21 | ~30j avant (à ~21 mai) ✅ |
| `prospection.app.veridian.site` | 2026-06-30 | ✅ |
| `cms.veridian.site` | 2026-07-23 | ✅ |
| `notifuse.app.veridian.site` | 2026-06-21 | ✅ |
| `twenty.app.veridian.site` | 2026-06-21 | ✅ |

Aucun cert proche de l'expiration critique (<30j).

## Anomalies détectées (non bloquantes)

### 🟡 `unbound-resolvconf.service` en failed
Service systemd de mise à jour de resolvconf via unbound. Pas critique car Docker utilise ses propres DNS. À investiguer un jour. Pas d'impact business actuel.

### 🟡 Containers sans healthcheck Docker
Listés ci-dessus (`linkedin-prod`, `asset-bank-prod`, `cms-prod`, `dokploy-postgres`, `dokploy-redis`, `traefik`, etc.). Pas obligatoire mais bloque l'auto-restart intelligent + auto-rollback orchestré. Standard CI Veridian §1 exige healthcheck pour les services critiques.

### 🟡 Volumes Docker orphelins (13/28)
1.5 GB reclaimable. Cron hebdo de nettoyage à mettre en place (`docker volume prune -f` filtre par labels d'app, hors P0).

### 🟡 Load avg 4
Soutenable mais sur la durée mérite un profiling I/O Docker. Si scaling devient nécessaire, c'est le premier symptôme à surveiller.

## Backups DB — état à confirmer

**Pas vérifié dans cet audit** — voir si pg_dump automatiques tournent quelque part :
- `veridian-core-db` (Hub auth + tenants)
- `prospection-saas-db` (996k entreprises, leads, pipeline)
- `notifuse-prod-db` (templates, workspaces, contacts)
- `twenty-prod-db` (CRM)
- `cms-postgres` (Payload pages)
- `verger-prod-db` (e-commerce client)

À automatiser via cron + upload S3/OVH Object Storage. **Critique pour disaster recovery** — pas dans le scope CI mais à tracker.

## Versions images notables

| App | Version | Notes |
|---|---|---|
| Hub | `:latest` (auto-deploy GitOps) | Pas de pin SHA — risqué pour rollback |
| Prospection | `:latest` | Idem |
| Analytics | `:latest@sha256:8186b4ef...` | SHA-pinned ✅ (le seul) |
| Notifuse | `:saas-v1.0.3@sha256:b07226fe...` | Tag versionné + SHA-pin ✅ |
| Twenty | `:v1.19.1` | Pinned (mais pas SHA) |
| Dokploy | `:v0.29.4` | Pinned |
| Traefik | `:v3.6.17` | Pinned |

**Recommandation** : généraliser le SHA-pinning à hub + prospection + cms en P1. Permet rollback déterministe et traçabilité.

---

## Pour la session suivante

1. **Vérifier que le merge staging→main du nouveau workflow CI s'est passé sans incident** (cf todo/CI.md étapes 4-6)
2. **Cron backup DBs** — à mettre en place (probablement nouveau todo `BACKUPS.md`)
3. **SHA-pinner les images prod** (hub + prospection + cms) pour rollback deterministe
4. **Healthchecks Docker manquants** sur les services sans (linkedin, asset-bank, cms-app, dokploy-postgres, etc.)
5. **Volume prune** automatique hebdo
6. **Étendre l'audit aux backups** (pg_dump automatiques en place ? upload distant ?)
