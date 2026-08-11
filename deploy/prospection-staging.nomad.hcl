# prospection-staging.nomad.hcl — SOURCE DE VÉRITÉ GITOPS du déploiement staging.
#
# Miroir versionné (dans CE repo) du job Nomad réellement déployé, cf ticket
# tickets/NOMAD-GITOPS.md. La CI (.github/workflows/prospection-deploy-staging.yml)
# injecte le tag d'image buildé (var image_tag) puis `nomad job plan`→`run`.
#
# Placement : ovh-dev (provider=ovh-dev == dev-pub). Réseau PRIVÉ (host_network
# tailscale) + middleware internal-only@nomad (ipAllowList 100.64/10 → 403 hors
# tailnet). Secrets = Nomad Variable nomad/jobs/prospection-staging (JAMAIS en clair).
#
# Group unique co-localisé (network namespace bridge partagé → 127.0.0.1:5432) :
#   - task db          : postgres:16, DEUX bases — `prospection` (app staging, ~13 MB)
#                        et `prospection_devclone` (clone prod, 4.2 GB, 996K entreprises).
#   - task prospection : app Next.js (:3000), DB `prospection`.
#   - task search-dev  : banc moteur de recherche IA (:3200), seconde instance de
#                        l'image staging, DB `prospection_devclone`.

variable "image_tag" {
  type        = string
  description = "Tag de l'image ghcr.io/christ-roy/prospection à déployer (injecté par la CI)."
  default     = "staging-d8d8a4e"
}

job "prospection-staging" {
  datacenters = ["veridian-eu"]
  type        = "service"

  group "stack" {
    count = 1

    # Les routeurs permanents Sablier de l'ingress pointent sur les ports fixes
    # 19097/19098. Cette meta autorise Sablier à endormir/réveiller ce job.
    meta = { "sablier.enable" = "true" }

    # Stratégie de déploiement. healthy_deadline LARGE : le 1er pull de l'image
    # Next.js (~grosse) sur un nœud qui ne l'a pas en cache peut dépasser les 5min
    # par défaut → l'alloc était marquée unhealthy alors qu'elle finissait de puller
    # (incident 2026-07-11, staging 502). auto_revert = filet de sécurité : un deploy
    # qui échoue restaure automatiquement la dernière version saine (pas de trou).
    update {
      healthy_deadline  = "15m"
      progress_deadline  = "20m"
      min_healthy_time  = "10s"
      auto_revert       = true
    }

    # Épinglé à ovh-dev : la DB bind sur /opt/veridian-staging du nœud ovh-dev.
    # Stateful à volume local → PAS de reschedule (le volume ne suit pas).
    constraint {
      attribute = "${meta.provider}"
      value     = "ovh-dev"
    }

    restart {
      attempts = 10
      interval = "10m"
      delay    = "15s"
      mode     = "delay"
    }

    network {
      mode = "bridge"
      # host_network tailscale : les ports CNI bind sur l'IP Tailscale du nœud uniquement
      # → apps injoignables en public, Traefik route via Tailscale, ipAllowList non-bypassable.
      port "http" {
        static       = 19097
        to           = 3000
        host_network = "tailscale"
      }
      port "searchhttp" {
        static       = 19098
        to           = 3200
        host_network = "tailscale"
      }
    }

    # ---- service prospection-staging (app Next.js) ----
    service {
      name     = "prospection-staging"
      provider = "nomad"
      port     = "http"
      # Le routing vit dans ingress.nomad.hcl avec un service @file permanent.
      tags = ["traefik.enable=false"]
      check {
        type     = "http"
        path     = "/api/health"
        interval = "5s"
        timeout  = "5s"
      }
    }

    # ---- service prospection-search-staging (banc IA, next dev) ----
    service {
      name     = "prospection-search-staging"
      provider = "nomad"
      port     = "searchhttp"
      tags = ["traefik.enable=false"]
      check {
        type     = "tcp"
        interval = "5s"
        timeout  = "10s"
      }
    }

    # ---- db (postgres:16 : prospection + prospection_devclone) ----
    task "db" {
      driver = "docker"
      config {
        image = "postgres:16-alpine"
        volumes = [
          "/opt/veridian-staging/prospection/db:/var/lib/postgresql/data",
        ]
      }
      template {
        destination = "secrets/pg.env"
        env         = true
        data        = <<EOH
TZ=UTC
POSTGRES_USER=app
POSTGRES_DB=prospection
{{ with nomadVar "nomad/jobs/prospection-staging" }}
POSTGRES_PASSWORD={{ .DB_PASSWORD }}
{{ end }}
EOH
      }
      resources {
        # Pics live 2026-08-11: 30 MHz / 13 MiB. Le burst jusqu'à 3 GiB
        # reste disponible pour le restore et la construction d'index.
        cpu        = 50
        memory     = 64
        memory_max = 3072
      }
    }

    # ---- prospection (Next.js compilé, node server.js, :3000) ----
    task "prospection" {
      driver = "docker"
      config {
        image = "ghcr.io/christ-roy/prospection:${var.image_tag}"
        ports = ["http"]
      }
      template {
        destination = "secrets/app.env"
        env         = true
        data        = <<EOH
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=3000
AUTH_TRUST_HOST=true
DEPLOY_ENV=staging
TRIAL_DAYS=7
NEXT_PUBLIC_TRIAL_DAYS=7
VAPID_SUBJECT=mailto:contact@veridian.site

NEXTAUTH_URL=https://prospection.staging.veridian.site
APP_URL=https://prospection.staging.veridian.site
NEXT_PUBLIC_SITE_URL=https://prospection.staging.veridian.site
NEXT_PUBLIC_HUB_URL=https://app.veridian.site
HUB_API_URL=https://app.veridian.site

{{ with nomadVar "nomad/jobs/prospection-staging" }}
DATABASE_URL=postgresql://app:{{ .DB_PASSWORD }}@127.0.0.1:5432/prospection?connection_limit=10
AUTH_SECRET={{ .AUTH_SECRET }}
TENANT_API_SECRET={{ .TENANT_API_SECRET }}
SEARCH_API_SECRET={{ .SEARCH_API_SECRET }}
HUB_WEBHOOK_TOKEN={{ .HUB_WEBHOOK_TOKEN }}
TELNYX_PUBLIC_KEY={{ .TELNYX_PUBLIC_KEY }}
{{ end }}
EOH
      }
      resources {
        # Pic live 2026-08-11: 102 MiB. Réserve x1,9; fusible inchangé.
        cpu        = 100
        memory     = 192
        memory_max = 1024
      }
    }

    # ---- search-dev (banc IA : image staging reproductible, DB clone, :3200) ----
    task "search-dev" {
      driver = "docker"
      config {
        image = "ghcr.io/christ-roy/prospection:${var.image_tag}"
        ports = ["searchhttp"]
      }
      template {
        destination = "secrets/search.env"
        env         = true
        data        = <<EOH
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=3200
NEXT_TELEMETRY_DISABLED=1
AUTH_TRUST_HOST=true
DEPLOY_ENV=staging
NEXTAUTH_URL=https://search-dev.staging.veridian.site
APP_URL=https://search-dev.staging.veridian.site
HUB_API_URL=https://app.veridian.site
STAGING_DB_USER=app
STAGING_DB_NAME=prospection

{{ with nomadVar "nomad/jobs/prospection-staging" }}
DATABASE_URL=postgresql://app:{{ .DB_PASSWORD }}@127.0.0.1:5432/prospection_devclone?connection_limit=10
STAGING_DB_PASSWORD={{ .DB_PASSWORD }}
AUTH_SECRET={{ .AUTH_SECRET }}
TENANT_API_SECRET={{ .TENANT_API_SECRET }}
SEARCH_API_SECRET={{ .SEARCH_API_SECRET }}
HUB_WEBHOOK_TOKEN={{ .HUB_WEBHOOK_TOKEN }}
TELNYX_PUBLIC_KEY={{ .TELNYX_PUBLIC_KEY }}
{{ end }}
EOH
      }
      resources {
        # Pics live 2026-08-11: 4 MHz / 17 MiB; fusible inchangé.
        cpu        = 50
        memory     = 64
        memory_max = 2048
      }
    }
  }
}
