# Cron IMAP sync — mail v2 (ticket W8b)

## Décision archi

Pas de worker container BullMQ comme Twenty CRM (instabilité connue de leur
sync IMAP, issues GitHub à répétition). Polling Next.js depuis route
`POST /api/cron/imap-sync` toutes les 5 min, déclenché par cron systemd
externe.

5 min de latence acceptable B2B. Zéro infra additionnelle.

## Endpoint

```
POST https://prospection.app.veridian.site/api/cron/imap-sync
Headers: Authorization: Bearer ${CRON_SECRET}
```

CRON_SECRET déjà défini en prod (utilisé par `/api/cron/process-outbox`).

## Cron systemd (prod) — à câbler par Robert / agent infra

Sur `prod-pub` :

```cron
# /etc/cron.d/veridian-prospection-imap-sync
*/5 * * * * www-data curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://prospection.app.veridian.site/api/cron/imap-sync \
  >> /var/log/veridian/imap-sync.log 2>&1
```

Ou en `systemd timer` (préféré pour Veridian) :

```ini
# /etc/systemd/system/veridian-imap-sync.service
[Unit]
Description=Veridian Prospection — IMAP polling

[Service]
Type=oneshot
EnvironmentFile=/etc/veridian/cron.env
ExecStart=/usr/bin/curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://prospection.app.veridian.site/api/cron/imap-sync
```

```ini
# /etc/systemd/system/veridian-imap-sync.timer
[Unit]
Description=Veridian Prospection — IMAP polling timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=veridian-imap-sync.service

[Install]
WantedBy=timers.target
```

Enable :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now veridian-imap-sync.timer
sudo systemctl list-timers | grep veridian
```

## Cron staging — sur `dev-pub`

Même pattern, juste URL :

```
https://prospection.staging.veridian.site/api/cron/imap-sync
```

## Vérifier le bon fonctionnement

Logs Next.js (Dokploy `docker.getContainerLogs` ou `ssh prod-pub`) :

```
[cron:imap-sync] tenants=3 ok=3 failed=0 inserted=7 duration_ms=2841
```

État par tenant dans `tenant_mail_config` :

- `imap_last_sync_at` : timestamp du dernier run
- `imap_last_sync_status` : `ok` / `auth_failed` / `host_unreachable` / `timeout` / `tls_error` / `folder_not_found` / `unknown`
- `imap_last_sync_error` : détail texte de l'erreur (visible côté UI Settings → Mail → IMAP)
- `imap_last_uid_seen` : high-water mark UID, monotone croissant

## Désactiver le sync pour un tenant

UI : `Settings → Mail → IMAP → Désactiver IMAP` (DELETE /api/mail/imap-config).
Le tenant disparaît du sélecteur `listImapEnabledTenants()` au prochain run.

## Garde-fous techniques

- Max 200 messages par run / par tenant (pour ne pas saturer le cron sur
  un tenant qui aurait 50k mails non lus). Au-delà, on prend les 200
  derniers et on saute en avant. cf `MAX_MESSAGES_PER_RUN` dans
  `src/lib/mail/imap-client.ts`.
- Timeout réseau IMAP : 30s par tenant. Au-delà → status `timeout`.
- Sync séquentiel des tenants — un tenant lent ne ralentit pas les autres
  trop fort (max 30s par tenant), mais évite de saturer la machine.
  Si > 20 tenants IMAP-enabled simultanés, migrer vers p-limit(5).

## Sécurité

- Chaque password IMAP est chiffré AES-256-GCM (lib `encrypt-password.ts`,
  dérivé de `AUTH_SECRET`).
- Le secret CRON_SECRET est commun à tous les crons Prospection. Rotation
  via Dokploy ENV → restart container.
- L'endpoint est public-facing (besoin pour systemd externe sans VPN), donc
  l'auth Bearer est la seule défense — d'où la nécessité d'un secret long
  et de la rotation périodique.

## Liens

- Route handler : `src/app/api/cron/imap-sync/route.ts`
- Orchestrateur : `src/lib/mail/imap-sync.ts`
- Client IMAP : `src/lib/mail/imap-client.ts`
- Matcher prospect : `src/lib/mail/match-prospect.ts`
- Migration : `prisma/migrations/0027_add_imap_config/migration.sql`
