# prospection.nomad.hcl — source de vérité GitOps du déploiement PROD.
#
# La CI injecte le tag d'image promu avec `-var image_tag=<tag>`. La base PROD
# vit dans le job Patroni `prospection-db` du repo nomad-veridian. Chaque
# allocation embarque uniquement l'app et un HAProxy local qui suit le leader.
# Secrets = Nomad Variable `nomad/jobs/prospection`, jamais en clair ici.

variable "image_tag" {
  type        = string
  description = "Tag de l'image ghcr.io/christ-roy/prospection promue en prod (injecté par la CI)."
  default     = "latest"
}

job "prospection" {
  datacenters = ["veridian-eu"]
  type        = "service"
  priority    = 80

  group "stack" {
    count = 2

    # PROD stateless sur les deux origines publiques. distinct_hosts interdit
    # à Nomad de poser les deux allocations sur le même serveur.
    constraint {
      attribute = "${meta.provider}"
      operator  = "regexp"
      value     = "^(contabo|ovh-prod)$"
    }
    constraint {
      operator = "distinct_hosts"
      value    = "true"
    }
    spread {
      attribute = "${meta.provider}"
      weight    = 100
      target "contabo"  { percent = 50 }
      target "ovh-prod" { percent = 50 }
    }

    restart {
      attempts = 10
      interval = "10m"
      delay    = "15s"
      mode     = "delay"
    }

    update {
      max_parallel     = 1
      min_healthy_time = "15s"
      healthy_deadline = "5m"
      auto_revert      = true
    }

    reschedule {
      delay          = "15s"
      delay_function = "exponential"
      max_delay      = "2m"
      unlimited      = true
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

    # HAProxy écoute seulement dans le netns du groupe. Il sonde /primary sur
    # Patroni et ferme les connexions vers l'ancien leader lors d'une bascule.
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
    retries 2
    timeout connect 5s
    timeout client 30m
    timeout server 30m
    timeout check 5s

listen postgres-primary
    bind 127.0.0.1:5432
    option httpchk GET /primary
    http-check expect status 200
    default-server inter 3s fall 2 rise 2 on-marked-down shutdown-sessions
    server patroni-contabo 100.108.136.89:5435 check port 8012
    server patroni-ovhprod 100.88.202.29:5435 check port 8012
EOH
      }
      resources {
        cpu        = 50
        memory     = 32
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
        cpu        = 500
        memory     = 224
        memory_max = 7000
      }
    }
  }
}
