# prospection.nomad.hcl — source de vérité GitOps du déploiement PROD.
#
# La CI injecte le tag d'image promu avec `-var image_tag=<tag>`. La base
# Postgres et l'application partagent le même groupe réseau. Le volume DB est
# local à ovh-prod : ce job stateful ne doit pas être déplacé sans migration.
# Secrets = Nomad Variable `nomad/jobs/prospection`, jamais en clair ici.

variable "image_tag" {
  type        = string
  description = "Tag de l'image ghcr.io/christ-roy/prospection promue en prod (injecté par la CI)."
  # `07b0b0e` n'a JAMAIS existe sur GHCR : c'etait le prefixe du DIGEST de
  # l'image, recopie par erreur comme s'il s'agissait d'un tag. Un deploiement
  # hors CI echouait donc a tirer l'image (manifest unknown) et se faisait
  # rattraper par auto_revert. L'image reellement en production a ete retaguee
  # `prod-20260815` sur GHCR (meme contenu, sha256:07b0b0ec…) pour que ce defaut
  # designe enfin quelque chose.
  default     = "prod-20260815"
}

job "prospection" {
  datacenters = ["veridian-eu"]
  type        = "service"
  priority    = 80

  group "stack" {
    count = 1

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

    update {
      max_parallel     = 1
      min_healthy_time = "15s"
      healthy_deadline = "5m"
      auto_revert      = true
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

    task "prospection-saas-db" {
      driver = "docker"
      config {
        # Image officielle postgres:15-alpine + pgBackRest epingle. La BASE est
        # identique au bit pres : changer d'image de base changerait la
        # collation (musl/glibc) et fausserait silencieusement les index.
        image = "ghcr.io/christ-roy/veridian-postgres-pgbackrest:15-alpine@sha256:e872b9618b68103f1c8789923946f5aca3b4065009f00e8734f4c13603c8ee19"
        args = [
          # --- Archivage continu des WAL vers le depot pgBackRest ---
          # C'est CE reglage, et non la sauvegarde nocturne, qui borne la perte
          # de donnees : chaque segment de journal part vers R2 des qu'il est
          # clos. archive_timeout force cette cloture toutes les 5 minutes quand
          # il y a eu de l'ecriture, donc RPO = 5 min.
          # Modifier archive_mode exige un REDEMARRAGE de PostgreSQL (ce n'est
          # pas rechargeable a chaud) : c'est la seule interruption qu'impose la
          # mise en place.
          # pgBackRest ne joint le cluster QUE par socket Unix ; il n'a aucune
          # option de connexion TCP pour un cluster local. La tache annexe vit
          # dans un autre espace de montage et ne voit donc pas
          # /var/run/postgresql. On publie une seconde socket dans /alloc, le
          # repertoire que Nomad partage entre les taches d'un meme groupe.
          # L'ancienne reste en place : `docker exec ... psql` continue de marcher.
          "-c", "unix_socket_directories=/var/run/postgresql,/alloc",
          "-c", "archive_mode=on",
          "-c", "archive_command=pgbackrest --stanza=prospection archive-push %p",
          "-c", "archive_timeout=300",
          "-c", "wal_level=replica",
        ]
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
# --- pgBackRest : configuration par variables d'environnement ---
# Aucun fichier de configuration : les identifiants R2 et la phrase de
# chiffrement ne sont jamais ecrits sur le disque de l'allocation. pgBackRest
# lit toute option sous la forme PGBACKREST_<OPTION>.
PGBACKREST_REPO1_TYPE=s3
PGBACKREST_REPO1_PATH=/pgbackrest/prospection
PGBACKREST_REPO1_S3_REGION=auto
# path : R2 accepte les deux styles, celui-ci ne depend pas d'un DNS par bucket.
PGBACKREST_REPO1_S3_URI_STYLE=path
PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc
PGBACKREST_COMPRESS_TYPE=zst
PGBACKREST_COMPRESS_LEVEL=6
PGBACKREST_REPO1_BUNDLE=y
PGBACKREST_REPO1_BLOCK=y
PGBACKREST_LOG_LEVEL_CONSOLE=info
PGBACKREST_LOG_LEVEL_FILE=off
PGBACKREST_PG1_PATH=/var/lib/postgresql/data
PGBACKREST_PG1_PORT=5432
PGBACKREST_PG1_USER=postgres
PGBACKREST_PG1_DATABASE=prospection
{{ with nomadVar "nomad/jobs/prospection" }}
PGBACKREST_REPO1_S3_BUCKET={{ .R2_BUCKET }}
PGBACKREST_REPO1_S3_ENDPOINT={{ .R2_ENDPOINT }}
PGBACKREST_REPO1_S3_KEY={{ .R2_ACCESS_KEY_ID }}
PGBACKREST_REPO1_S3_KEY_SECRET={{ .R2_SECRET_ACCESS_KEY }}
# ATTENTION : PERDRE CETTE PHRASE = PERDRE TOUTES LES SAUVEGARDES. Copie de
# secours dans ~/credentials/.all-creds.env (PGBACKREST_CIPHER_PROSPECTION).
PGBACKREST_REPO1_CIPHER_PASS={{ .PGBACKREST_CIPHER_PASS }}
{{ end }}
EOH
      }
      resources {
        cpu        = 300
        memory     = 256
        memory_max = 7000
      }
    }

    # ---- pgBackRest : sauvegarde continue vers R2 ----
    # Tache annexe du MEME groupe, donc : meme espace reseau (elle joint
    # PostgreSQL par la socket publiee dans /alloc, authentification `trust`
    # locale, aucun mot de passe a promener) et meme bind mount de PGDATA (elle
    # lit les pages directement). Elle SUIT l'allocation : si Nomad replace le
    # groupe, la sauvegarde repart sans qu'on touche a un script.
    task "pgbackrest" {
      driver = "docker"
      config {
        image      = "ghcr.io/christ-roy/veridian-postgres-pgbackrest:15-alpine@sha256:e872b9618b68103f1c8789923946f5aca3b4065009f00e8734f4c13603c8ee19"
        entrypoint = ["/usr/local/bin/pgbackrest-scheduler"]
        command    = ""
        volumes = [
          "/opt/veridian-lab/prospection/db:/var/lib/postgresql/data",
        ]
      }
      user = "postgres"

      template {
        destination = "secrets/pgbackrest.env"
        env         = true
        data        = <<EOH
TZ=UTC
PGBR_STANZA=prospection
# Socket partagee avec la tache postgres via le repertoire d'allocation.
PGBACKREST_PG1_SOCKET_PATH=/alloc
# Complete le dimanche, differentielle les autres jours, incrementale toutes les
# 6 h. 35 : creneau propre a cette stanza pour ne pas taper R2 en meme
# temps que les autres bases du parc.
PGBR_FULL_DOW=0
PGBR_DAILY_HOUR=3
PGBR_DAILY_MINUTE=35
PGBR_INCR_EVERY_H=6
# Base de PRODUCTION cliente : 8 semaines de completes conservees. Les WAL
# retenus couvrent la meme profondeur, donc on peut viser n'importe quelle
# seconde des deux derniers mois.
PGBACKREST_REPO1_RETENTION_FULL=8
PGBACKREST_REPO1_RETENTION_DIFF=7
PGBACKREST_PROCESS_MAX=2
PGBACKREST_START_FAST=y
# --- pgBackRest : configuration par variables d'environnement ---
# Aucun fichier de configuration : les identifiants R2 et la phrase de
# chiffrement ne sont jamais ecrits sur le disque de l'allocation. pgBackRest
# lit toute option sous la forme PGBACKREST_<OPTION>.
PGBACKREST_REPO1_TYPE=s3
PGBACKREST_REPO1_PATH=/pgbackrest/prospection
PGBACKREST_REPO1_S3_REGION=auto
# path : R2 accepte les deux styles, celui-ci ne depend pas d'un DNS par bucket.
PGBACKREST_REPO1_S3_URI_STYLE=path
PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc
PGBACKREST_COMPRESS_TYPE=zst
PGBACKREST_COMPRESS_LEVEL=6
PGBACKREST_REPO1_BUNDLE=y
PGBACKREST_REPO1_BLOCK=y
PGBACKREST_LOG_LEVEL_CONSOLE=info
PGBACKREST_LOG_LEVEL_FILE=off
PGBACKREST_PG1_PATH=/var/lib/postgresql/data
PGBACKREST_PG1_PORT=5432
PGBACKREST_PG1_USER=postgres
PGBACKREST_PG1_DATABASE=prospection
{{ with nomadVar "nomad/jobs/prospection" }}
PGBACKREST_REPO1_S3_BUCKET={{ .R2_BUCKET }}
PGBACKREST_REPO1_S3_ENDPOINT={{ .R2_ENDPOINT }}
PGBACKREST_REPO1_S3_KEY={{ .R2_ACCESS_KEY_ID }}
PGBACKREST_REPO1_S3_KEY_SECRET={{ .R2_SECRET_ACCESS_KEY }}
# ATTENTION : PERDRE CETTE PHRASE = PERDRE TOUTES LES SAUVEGARDES. Copie de
# secours dans ~/credentials/.all-creds.env (PGBACKREST_CIPHER_PROSPECTION).
PGBACKREST_REPO1_CIPHER_PASS={{ .PGBACKREST_CIPHER_PASS }}
{{ end }}
EOH
      }

      resources {
        cpu        = 100
        memory     = 64
        memory_max = 512
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
        memory     = 256
        memory_max = 7000
      }
    }
  }
}
