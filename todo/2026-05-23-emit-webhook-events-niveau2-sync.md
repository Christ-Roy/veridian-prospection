# [Prospection] Émettre les events webhook Niveau 2 du tenant sync

> **Type** : Émission de webhooks app → Hub (contrat v1.4 §7.1)
> **Sévérité** : 🟡 P2 — Hub a les handlers prêts, manque l'émetteur côté Prospection
> **Owner** : agent Prospection
> **Spec parent** : `veridian-hub/todo/2026-05-20-tenant-sync-strategy.md` (Niveau 2)
> **Créé** : 2026-05-23

## Contexte

Hub a étendu les handlers webhook v1.4 (`lib/webhooks/prospection-handlers.ts`)
pour matérialiser dans `hub_app.tenants.metadata.prospection_*` les events :

- `tenant.suspended` → `prospection_status='suspended'`, `prospection_suspended_at`, `prospection_suspended_reason`
- `tenant.resumed` → reset des champs suspend, `prospection_resumed_at`
- `tenant.soft_deleted` → `prospection_status='deleted'`, `prospection_soft_deleted_at`
- `tenant.purged` → `prospection_purged_at`, `prospection_purged_rows`
- `tenant.owner_changed` → append `prospection_owner_history` (10 derniers)
- `tenant.quota_exceeded` → `prospection_quota_*` (last-known)
- `tenant.member_added` / `tenant.member_removed` → append `prospection_member_events` (50 derniers)

Prospection n'émet **aucun** de ces events aujourd'hui — toutes les
mutations locales sont muettes côté Hub. La conséquence : le dashboard
Hub affiche un état stale jusqu'à ce que le user retourne sur Prospection
et déclenche un effet réobservable.

## Endpoint Hub cible

`POST https://app.veridian.site/api/webhooks/prospection`

**Auth** : `Authorization: Bearer <PROSPECTION_WEBHOOK_TOKEN>`
**Format payload v1.4** :
```json
{
  "event": "tenant.suspended",
  "tenant_id": "<UUID tenant Prospection ou Hub bridge>",
  "occurred_at": "ISO8601",
  "data": { "suspended_at": "...", "reason": "..." },
  "idempotency_key": "uuid v4",
  "contract_version": "1.4"
}
```

Comportement Hub :
- 200 + `deduplicated: true` si idempotency_key déjà reçu (24h)
- 200 + dispatch handler v1.4
- 5xx → Prospection DOIT retenter avec backoff exponentiel (1s, 2s, ..., max 1h)

## Implémentation suggérée (Next.js)

1. Table `webhook_outbox` (pattern transactional outbox) — INSERT dans la
   même transaction que la mutation locale.
2. Worker BullMQ ou cron qui poll outbox toutes les 5s et envoie via fetch.
3. Service `lib/hub-webhook/sendEvent.ts` qui construit le payload v1.4 +
   ajoute Bearer + idempotency_key UUID v4.

## Référence

- Stratégie sync : `veridian-hub/todo/2026-05-20-tenant-sync-strategy.md` §Niveau 2
- Handlers Hub : `veridian-hub/lib/webhooks/prospection-handlers.ts`
- Helpers matérialisation : `veridian-hub/lib/sync/snapshot-updater.ts`
- Contrat events : `veridian-hub/docs/CONTRAT-HUB.md` §7.1 v1.5
- Pattern outbox : https://microservices.io/patterns/data/transactional-outbox.html
