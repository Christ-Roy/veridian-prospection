# prospection.nomad.hcl — source de vérité GitOps du déploiement PROD.
#
# La CI injecte le tag d'image promu avec `-var image_tag=<tag>`. L'application est SANS ÉTAT
# (base sur pg-saas, Patroni) : deux instances, réparties par zone (ovh, app01), placées par étiquette
# `role=app` et jamais par machine. Ses caches en mémoire sont bornés à 3 s (27/11, voir src/lib/auth/).
# Secrets = Nomad Variable `nomad/jobs/prospection`, jamais en clair ici.

variable "image_tag" {
  type        = string
  description = "Tag de l'image ghcr.io/christ-roy/prospection promue en prod. Obligatoire : fourni par le verbe CI (`veridian-ci-deploy prospection deploy prod <sha7>`)."
  # PAS DE DÉFAUT, jamais. Un défaut figé fait reculer la prod au prochain
  # `nomad job run` sans -var (09/11 : défaut c70ba3c alors que la prod
  # servait 0537d22). Contrôle CI : scripts/ci/check-image-tag-sans-defaut.py.
}

job "prospection" {
  meta {
    veridian_domaine = "saas" # domaine affiche par la vue flotte (scripts/vue-flotte/), regle DOMAINE du lint
  }
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
    # Deux exemplaires sans coupure (lot C, VER-270, 27/11) : une zone par exemplaire, étiquette `role=app`.
    count = 2

    constraint {
      attribute = "${meta.role}"
      operator  = "set_contains"
      value     = "app"
    }

    spread {
      attribute = "${meta.zone}"
      weight    = 100
    }

    restart {
      attempts = 10
      interval = "10m"
      delay    = "2s"
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
        # Une valeur neuve dans la Variable ne redémarre pas l'unique instance (coupure) : elle entre au déploiement
        # canari suivant. Indispensable pour renouveler le secret du Hub sans coupure (VER-251).
        change_mode = "noop"
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
# Liaisons vers le CRM et Mail (docs/LIAISONS.md). Vide = éteint, aucun bouton.
ATLAS_LIAISONS=crm=*;notifuse=*
# VER-249 (tranché par la parente le 27/11, aucun gratuit réel actif) : 20 fiches distinctes par jour et par espace
# montrent emails et téléphones, une liste jamais, écran et IA. Vide = sans limite ; « masque » = aucun. src/atlas/gratuit.ts.
# Mesure de l'usage : obs search '\[atlas\]\[coordonnees\]'.
ATLAS_GRATUIT_COORDONNEES=fiches:20
# CONTRAT-HUB §6.1 (VER-264) : la signature v1 du Hub est refusée, v2 seule (méthode, chemin, requête, corps, usage unique).
# Posé le 27/11 à 13:15Z : aucun v1 depuis 10:47Z (Hub et son outillage en v2, 7ea1f77 et 8c729ba).
VERIDIAN_HMAC_REQUIRE_V2=1
# Pages publiques des marchés indexables, robots.txt et sitemap ouverts (parente, 27/11, sous la consigne de Robert).
ATLAS_PUBLIC_INDEX=1
# Repli tant que le Hub ne rend pas l'adresse d'action dans sa réponse.
LIAISON_URL_CRM=https://crm.app.veridian.site/mcp
LIAISON_URL_NOTIFUSE=https://notifuse.app.veridian.site/api/veridian/actions
# Atlas : ClickHouse ODH en lecture seule (compte prospection_ro, profil borné côté serveur).
{{- $ch := "" }}{{ range nomadService "odh-clickhouse" }}{{ $ch = printf "http://%s:%d/" .Address .Port }}{{ end }}
# Adresse lue au catalogue Nomad (service odh-clickhouse), plus jamais en dur (lint CIBLE-IP, infra 27/11).
CLICKHOUSE_URL={{ $ch }}
CLICKHOUSE_USER=prospection_ro

{{ with nomadVar "nomad/jobs/prospection" }}
AUTH_SECRET={{ .AUTH_SECRET }}
TENANT_API_SECRET={{ .TENANT_API_SECRET }}
# Second secret du Hub, facultatif (VER-251) : accepté en vérification seulement, absent = rien.
{{ with .HUB_API_SECRET_SECOND }}HUB_API_SECRET_SECOND={{ . }}{{ end }}
CRON_SECRET={{ .CRON_SECRET }}
HUB_WEBHOOK_TOKEN={{ .HUB_WEBHOOK_TOKEN }}
OPENROUTER_VERIDIAN_KEY={{ .OPENROUTER_VERIDIAN_KEY }}
CLICKHOUSE_PASSWORD={{ .CLICKHOUSE_PASSWORD }}
{{ end }}
{{ with nomadVar "nomad/jobs/prospection" }}DATABASE_URL=postgresql://prospection:{{ .PG_SAAS_PASSWORD }}@172.26.64.1:15432/prospection?connection_limit=8&pool_timeout=10{{ end }}
EOH
      }
      resources {
        cpu        = 500
        # 08/11 : reserve = memoire non reprenable mesuree (143 Mio) + 55 %, plafond = pointe (203 Mio) x 5. Avant : 7000 Mio,
        # une fuite de Prospection pouvait avaler ovh-prod et toutes les apps qui y tournent.
        memory     = 112
        memory_max = 1024
      }
    }
  }
}
