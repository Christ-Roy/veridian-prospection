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
  # Recale le 2026-09-24 (chantier durcissement conteneurs) : mesure sur le
  # job Nomad vivant = c70ba3c, juste avant ce commit.
  default     = "c70ba3c"
}

job "prospection" {
  datacenters = ["veridian-eu"]
  type        = "service"
  priority    = 80

# veridian-contract:start
# veridian.contract.version=1
# veridian.managed_by=repo
# veridian.environment=production
# veridian.tier=saas-prod
# veridian.criticality=B
# veridian.owner=growth
# veridian.objective=availability-99.9
# veridian.rto_minutes=5
# veridian.rpo_minutes=15
# veridian.state=local-state
# veridian.mobility=local-gap
# veridian.preemptible=false
# veridian.staging_job=prospection-staging
# veridian.promotion_policy=staging-required
# veridian-contract:end

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

    # Bleu-vert (08/11/2026) : la base vit dans le job prospection-db, le canari demarre a cote de l'ancienne allocation.
    # Ne pas changer les tags Traefik dans un deploiement ordinaire : deux versions aux tags differents donnent a Traefik
    # deux definitions du meme routeur, il l'ecarte (404).
    update {
      max_parallel     = 1
      canary           = 1
      auto_promote     = true
      min_healthy_time = "15s"
      healthy_deadline = "5m"
      auto_revert      = true
    }

    network {
      mode = "bridge"
      # L'ingress primaire tourne sur un autre nœud : annoncer le backend sur
      # le tailnet évite le hairpin vers l'IP publique ovh-prod (504 depuis
      # Traefik) tout en gardant l'application exposée uniquement via Traefik.
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

    task "prospection" {
      driver         = "docker"
      user           = "nextjs"
      # Traefik relit le catalogue toutes les 15 s : l'allocation sortante sert encore pendant qu'il l'oublie.
      shutdown_delay = "30s"
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
        # Durcissement Unix : empeche un processus non privilegie d'elever ses
        # droits via un binaire setuid. C'est le maillon entre « shell dans le
        # conteneur » et « root sur l'hote ». N'affecte PAS un processus qui
        # ABANDONNE ses droits au demarrage, seulement celui qui en gagne.
        security_opt    = ["no-new-privileges:true"]
        readonly_rootfs = true
        cap_drop        = ["ALL"]

        # Identification lisible du conteneur (2026-09-07). Nomad ne pose que
        # `com.hashicorp.nomad.alloc_id` : rien ne disait a quelle application
        # appartenait un conteneur. Les quatre premieres valeurs sont
        # interpolees par Nomad a l'execution, les deux dernieres sont des
        # proprietes du fichier (dossier jobs/<tier>/ et table du script
        # scripts/poser-labels-conteneurs.py).
        labels = {
          "site.veridian.job"   = "${NOMAD_JOB_NAME}"
          "site.veridian.group" = "${NOMAD_GROUP_NAME}"
          "site.veridian.task"  = "${NOMAD_TASK_NAME}"
          "site.veridian.node"  = "${node.unique.name}"
          "site.veridian.tier"  = "saas-prod"
          "site.veridian.app"   = "prospection"
        }
        image = "ghcr.io/christ-roy/prospection:${var.image_tag}"
        ports = ["http"]

        mount {
          type     = "tmpfs"
          target   = "/tmp"
          readonly = false
          tmpfs_options { size = 67108864 }
        }
        mount {
          type     = "tmpfs"
          target   = "/app/.next/cache"
          readonly = false
          tmpfs_options { size = 134217728 }
        }
      }
      template {
        destination = "secrets/app.env"
        perms       = "600"   # secret: lisible du seul proprietaire
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
AUTH_SECRET={{ .AUTH_SECRET }}
TENANT_API_SECRET={{ .TENANT_API_SECRET }}
SEARCH_API_SECRET={{ .SEARCH_API_SECRET }}
CRON_SECRET={{ .CRON_SECRET }}
HUB_WEBHOOK_TOKEN={{ .HUB_WEBHOOK_TOKEN }}
OPENROUTER_VERIDIAN_KEY={{ .OPENROUTER_VERIDIAN_KEY }}
{{ end }}
{{ range nomadService "prospection-postgres" }}{{ $a := .Address }}{{ $p := .Port }}{{ with nomadVar "nomad/jobs/prospection" }}DATABASE_URL=postgresql://postgres:{{ .DB_PASSWORD }}@{{ $a }}:{{ $p }}/prospection?connection_limit=10{{ end }}{{ end }}
EOH
      }
      resources {
        cpu        = 500
        # 08/11 : reserve = memoire non reprenable mesuree (143 Mio) + 55 %, plafond = pointe (203 Mio) x 5. Avant : 7000 Mio,
        # une fuite de Prospection pouvait avaler ovh-prod et toutes les apps qui y tournent.
        memory     = 224
        memory_max = 1024
      }
    }
  }
}
