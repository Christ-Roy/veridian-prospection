# [INFRA] Câbler CRON_SECRET + cron job mail-outbox-flush sur staging + prod

> **Type** : Infra ops (Dokploy API)
> **Sévérité** : 🟡 P1 — sans ce câblage, queue d'envoi mail W9c (F) ne flush jamais, mails restent à `queued` indéfiniment côté DB
> **Owner** : team-lead Robert ou agent infra dédié
> **Créé** : 2026-05-25 par team-lead après livraison W9c
> **Découvert par** : W9c qui a identifié le gap dans son message de livraison

## Pourquoi c'est nécessaire

W9c a livré la queue d'envoi mail (`mail_outbox` + route `/api/cron/mail-outbox-flush` Bearer auth). La route répond actuellement `503 cron_secret_not_configured` parce que `CRON_SECRET` n'est pas dans les ENV staging Prosp Dokploy.

Conséquence si pas câblé : les mails sont inserted en `queued` dans `mail_outbox` mais jamais sent. L'UI rend 202 (utilisateur croit que c'est parti) mais aucun mail n'arrive jamais au destinataire.

## Actions à faire

### Staging

1. Générer un CRON_SECRET aléatoire (32+ chars) :
```bash
openssl rand -hex 32
```

2. Patcher le compose staging Dokploy via API :
```bash
DOKPLOY_API_KEY=$(grep "^DOKPLOY_API_KEY=" ~/credentials/.all-creds.env | cut -d= -f2-)
COMPOSE_ID="<staging-prospection-compose-id>"  # à chercher via GET /api/project.all
NEW_SECRET="$(openssl rand -hex 32)"

curl -X POST "https://dokploy.veridian.site/api/compose.update" \
  -H "x-api-key: $DOKPLOY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"composeId\": \"$COMPOSE_ID\",
    \"env\": \"CRON_SECRET=$NEW_SECRET\\n... (autres ENV existants)\"
  }"

curl -X POST "https://dokploy.veridian.site/api/compose.deploy" \
  -H "x-api-key: $DOKPLOY_API_KEY" \
  -d "{\"composeId\": \"$COMPOSE_ID\"}"
```

⚠️ Attention : `env` est un blob multi-lignes, il faut récupérer l'existant via `GET /api/compose.one?composeId=X` et ajouter `CRON_SECRET=...` à la fin sans supprimer le reste.

3. Vérifier que la route répond OK :
```bash
curl -X POST -H "Authorization: Bearer $NEW_SECRET" \
  https://prospection.staging.veridian.site/api/cron/mail-outbox-flush
# Doit retourner 200 + { "flushed": N, "errors": 0 }
```

4. Créer le **Schedule Job Dokploy** :
   - UI Dokploy → projet Prospection-Staging → Schedule Jobs → New
   - Cron : `* * * * *` (toutes les minutes)
   - Command : `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://prospection-staging:3000/api/cron/mail-outbox-flush`
   - OU via API Dokploy `POST /api/scheduledTask.create`

### Prod (avant promo prod Vague 10)

Même chose mais sur le compose prod (`0mJI-sSt6jcOMr_2QJ1iI`). À faire **AVANT** la promo Vague 9-10 sinon les mails prod resteront en queued.

## Pattern de référence

`/api/cron/process-outbox` (webhooks Prospection) est déjà câblé en cron Dokploy avec la même mécanique Bearer. Voir migration 0023 + ENV `CRON_SECRET` existant si déjà posé en prod (à vérifier).

Si déjà posé en prod mais pas en staging → juste rajouter en staging et créer le Schedule Job.

## Definition of done

- [ ] `CRON_SECRET` set dans ENV staging Prosp
- [ ] Smoke `curl -X POST ... mail-outbox-flush` retourne 200 (pas 503)
- [ ] Schedule Job Dokploy `* * * * *` actif côté staging
- [ ] Idem en prod (avant promo Vague 10)
- [ ] Test E2E : envoi mail → wait 60s → vérifier `mail_outbox.status = 'sent'`

## Estimation

~30 min (action infra Dokploy API + Schedule Job + vérif)
