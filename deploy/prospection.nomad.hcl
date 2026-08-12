# prospection.nomad.hcl — source de vérité GitOps du déploiement PROD.
#
# La CI injecte le tag d'image promu avec `-var image_tag=<tag>`.
#
# Architecture prod :
# - PostgreSQL vit dans le groupe stateful `postgres`, épinglé à ovh-prod avec
#   volume local. Pas de reschedule : le volume ne suit pas l'allocation.
# - L'application vit dans le groupe stateless `app`. Elle parle à Postgres via
#   un sidecar HAProxy local (`pgproxy`) qui retry et garde DATABASE_URL stable.
# - Le cutover depuis l'ancien groupe co-localisé `stack` reste une opération
#   contrôlée : plan + fenêtre + smoke + rollback, jamais un rightsizing aveugle.
# Secrets = Nomad Variable `nomad/jobs/prospection`, jamais en clair ici.

variable "image_tag" {
  type        = string
  description = "Tag de l'image ghcr.io/christ-roy/prospection promue en prod. Pour nomad-v deploy, mettre à jour ce défaut puis committer."
  default     = "1ea6a39"
}

job "prospection" {
  datacenters = ["veridian-eu"]
  region      = "global"
  type        = "service"
  node_pool   = "default"
  priority    = 80

  group "postgres" {
    count = 1

    # Volume local ovh-prod : ne pas déplacer sans migration/replication.
    constraint {
      attribute = "${meta.provider}"
      value     = "ovh-prod"
    }

    restart {
      attempts = 10
      interval = "10m"
      delay    = "15s"
      mode     = "delay"
    }

    network {
      mode = "bridge"
      port "postgres" {
        static       = 15432
        to           = 5432
        host_network = "tailscale"
      }
    }

    task "prospection-saas-db" {
      driver         = "docker"
      shutdown_delay = "10s"
      kill_timeout   = "60s"
      service {
        name     = "prospection-postgres"
        provider = "nomad"
        port     = "postgres"
        tags     = ["traefik.enable=false"]
        check {
          type     = "tcp"
          interval = "10s"
          timeout  = "3s"
        }
      }
      config {
        image = "postgres:15-alpine"
        ports = ["postgres"]
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
        cpu        = 400
        memory     = 256
        memory_max = 3072
      }
    }
  }

  group "app" {
    count = 1

    # App stateless : peut quitter ovh-prod, mais pas vers ovh-dev qui porte le
    # staging. Contabo est acceptable comme nœud prod/ingress si ovh-prod manque.
    constraint {
      attribute = "${meta.provider}"
      operator  = "regexp"
      value     = "^(ovh-prod|contabo)$"
    }

    restart {
      attempts = 10
      interval = "10m"
      delay    = "15s"
      mode     = "delay"
    }

    reschedule {
      delay          = "15s"
      delay_function = "exponential"
      max_delay      = "2m"
      unlimited      = true
    }

    update {
      max_parallel      = 1
      canary            = 1
      auto_promote      = true
      auto_revert       = true
      min_healthy_time  = "15s"
      healthy_deadline  = "5m"
      progress_deadline = "8m"
      health_check      = "checks"
    }

    network {
      mode = "bridge"
      port "http" {
        to           = 3000
        host_network = "tailscale"
      }
    }

    service {
      name     = "prospection"
      provider = "nomad"
      port     = "http"
      tags = [
        "traefik.enable=true",
        "traefik.http.routers.prospection.rule=Host(`prospection-lab.veridian.site`)",
        "traefik.http.routers.prospection.entrypoints=web",
        "traefik.http.routers.prospection.middlewares=internal-only@nomad",
        "traefik.http.routers.prospectionsec.rule=Host(`prospection-lab.veridian.site`)",
        "traefik.http.routers.prospectionsec.entrypoints=websecure",
        "traefik.http.routers.prospectionsec.middlewares=internal-only@nomad",
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

    task "pgproxy" {
      driver = "docker"
      config {
        image   = "haproxy:3.0-alpine"
        command = "haproxy"
        args    = ["-f", "/local/haproxy.cfg"]
      }
      template {
        destination = "local/haproxy.cfg"
        change_mode = "restart"
        data        = <<EOH
global
    maxconn 200
    log stdout format raw local0 info

defaults
    log global
    mode tcp
    option tcplog
    retries 3
    timeout connect 5s
    timeout client 30m
    timeout server 30m
    timeout check 5s

listen postgres
    bind 127.0.0.1:5432
    option tcp-check
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server prospection-db-ovhprod 100.88.202.29:15432 check
EOH
      }
      resources {
        cpu        = 50
        memory     = 64
        memory_max = 128
      }
    }

    task "prospection" {
      driver         = "docker"
      shutdown_delay = "10s"
      kill_timeout   = "30s"
      service {
        name     = "prospection-selfheal"
        provider = "nomad"
        port     = "http"
        tags     = ["traefik.enable=false"]
        check {
          type     = "http"
          path     = "/api/health"
          interval = "15s"
          timeout  = "5s"
          check_restart {
            limit           = 4
            grace           = "120s"
            ignore_warnings = false
          }
        }
      }
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
# DB → sidecar HAProxy local, qui retry vers Postgres stateful sur Tailscale.
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
        cpu        = 150
        memory     = 256
        memory_max = 512
      }
    }
  }
}
