# prospection.nomad.hcl — SOURCE DE VÉRITÉ GITOPS du déploiement PROD.
#
# Miroir versionné (dans CE repo) du job Nomad réellement déployé, cf ticket
# tickets/NOMAD-GITOPS.md. La CI injecte le tag d'image promu (var image_tag)
# puis `nomad job plan`→`run`.
#
# Placement : bastion contabo (provider=contabo) — porte les workloads prod +
# l'ingress. DB postgres:15 co-localisée (network namespace bridge partagé →
# 127.0.0.1:5432), volume bind /opt/veridian-lab/prospection/db du bastion.
# TLS terminé par Traefik (certresolver letsencrypt). Secrets = Nomad Variable
# nomad/jobs/prospection (JAMAIS en clair).
#
# ⚠️ DB PROD mono-instance postgres:15 (data ~4.4 GB). Cible infra à terme =
# cluster Patroni HA (cf tickets/NOMAD-GITOPS.md §4 + gabarit hub-staging-db).
# NE PAS reschedule (volume local ne suit pas). Migration DB = fenêtre + backup.

variable "image_tag" {
  type        = string
  description = "Tag de l'image ghcr.io/christ-roy/prospection promue en prod (injecté par la CI)."
  default     = "latest"
}

job "prospection" {
  datacenters = ["veridian-eu"]
  type        = "service"

  group "stack" {
    count = 1

    # Épinglé au bastion : la DB bind sur /opt/veridian-lab/prospection du bastion.
    constraint {
      attribute = "${meta.provider}"
      value     = "contabo"
    }

    restart {
      attempts = 10
      interval = "10m"
      delay    = "15s"
      mode     = "delay"
    }

    network {
      mode = "bridge"
      port "http" { to = 3000 }
    }

    service {
      name     = "prospection"
      provider = "nomad"
      port     = "http"
      tags = [
        "traefik.enable=true",
        "traefik.http.routers.prospection.rule=Host(`prospection-lab.veridian.site`)",
        "traefik.http.routers.prospection.entrypoints=web",
        "traefik.http.routers.prospectionsec.rule=Host(`prospection-lab.veridian.site`)",
        "traefik.http.routers.prospectionsec.entrypoints=websecure",
        "traefik.http.routers.prospectionsec.tls=true",
        "traefik.http.routers.prospectionprod.rule=Host(`prospection.app.veridian.site`)",
        "traefik.http.routers.prospectionprod.entrypoints=websecure",
        "traefik.http.routers.prospectionprod.tls=true",
        "traefik.http.routers.prospectionprod.tls.certresolver=letsencrypt",
      ]
      check {
        type     = "http"
        path     = "/api/health"
        interval = "15s"
        timeout  = "5s"
      }
    }

    # ---- prospection-saas-db (postgres:15, prod, interne) ----
    task "prospection-saas-db" {
      driver = "docker"
      config {
        image = "postgres:15-alpine"
        volumes = [
          "/opt/veridian-lab/prospection/db:/var/lib/postgresql/data",
        ]
      }
      template {
        destination = "secrets/pg.env"
        env         = true
        data        = <<EOH
TZ=UTC
POSTGRES_USER=postgres
POSTGRES_DB=prospection
{{ with nomadVar "nomad/jobs/prospection" }}
POSTGRES_PASSWORD={{ .DB_PASSWORD }}
{{ end }}
EOH
      }
      resources {
        cpu = 300
        # DB prod prospection = ~4.4 GB : 256 MB OOM-killait pg_restore (build d'index).
        # Réserve 512 MB, burst jusqu'à 3 GB pour absorber le restore et les gros index.
        memory     = 512
        memory_max = 3072
      }
    }

    # ---- prospection (Next.js, port 3000) ----
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
DEPLOY_ENV=prod
TRIAL_DAYS=7
NEXT_PUBLIC_TRIAL_DAYS=7
VAPID_SUBJECT=mailto:contact@veridian.site

NEXTAUTH_URL=https://prospection.app.veridian.site
APP_URL=https://prospection.app.veridian.site
NEXT_PUBLIC_SITE_URL=https://prospection.app.veridian.site
NEXT_PUBLIC_HUB_URL=https://app.veridian.site
HUB_API_URL=https://app.veridian.site

{{ with nomadVar "nomad/jobs/prospection" }}
DATABASE_URL=postgresql://postgres:{{ .DB_PASSWORD }}@127.0.0.1:5432/prospection?connection_limit=10
AUTH_SECRET={{ .AUTH_SECRET }}
TENANT_API_SECRET={{ .TENANT_API_SECRET }}
SEARCH_API_SECRET={{ .SEARCH_API_SECRET }}
CRON_SECRET={{ .CRON_SECRET }}
HUB_WEBHOOK_TOKEN={{ .HUB_WEBHOOK_TOKEN }}
OPENROUTER_VERIDIAN_KEY={{ .OPENROUTER_VERIDIAN_KEY }}
{{ end }}
EOH
      }
      resources {
        cpu    = 500
        memory = 768
      }
    }
  }
}
