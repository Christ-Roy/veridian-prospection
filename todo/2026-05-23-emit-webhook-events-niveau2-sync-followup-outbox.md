# [Prospection] Pattern transactional outbox webhooks (follow-up Niveau 2)

> **Type** : Renforcement durabilité des webhooks app → Hub
> **Sévérité** : 🟢 P3 — fonctionnement actuel (fire-and-forget + retry 3×) tient pour le trafic actuel
> **Owner** : agent Prospection
> **Spec parent** : `veridian-hub/todo/2026-05-20-tenant-sync-strategy.md` (Niveau 2)
> **Créé** : 2026-05-23 par Agent L (cross-app endpoints sprint vague 3)
> **Bloqué par** : aucun

## Ce qui a déjà été livré (commit `1a26394`)

- ✅ `contract_version: "1.4"` dans tous les payloads
  (`src/lib/hub/webhooks.ts` → `HUB_WEBHOOK_CONTRACT_VERSION`)
- ✅ 4 nouveaux events émis depuis les routes correspondantes :
  - `tenant.soft_deleted` (route `soft-delete/route.ts`)
  - `tenant.purged` (route `purge/route.ts`)
  - `tenant.member_added` (route `sync-member/route.ts` sur create/restore)
  - `tenant.member_removed` (route `remove-member/route.ts` sur count > 0)
- ✅ Tests Vitest qui assertent l'émission correcte de chaque event
  (cf commit `1bf22a2`).

## Ce qui RESTE à livrer — pattern outbox transactionnel

Aujourd'hui, `emitHubWebhookAsync` est fire-and-forget avec retry exponentiel
en mémoire (1s, 2s, 4s). Si le process Prospection crash entre la mutation
DB et le 1er fetch, l'event est perdu. Pour les events critiques (purge,
soft-delete, member-removed), cette fragilité est acceptable pour le trafic
actuel mais doit être durcie quand on monte en charge.

### Plan d'implémentation suggéré

1. **Migration Prisma** : créer la table `webhook_outbox`
   ```prisma
   model WebhookOutbox {
     id              String   @id @default(uuid())
     event           String
     tenantId        String   @map("tenant_id")
     payload         Json
     idempotencyKey  String   @unique @map("idempotency_key")
     createdAt       DateTime @default(now()) @map("created_at")
     attempts        Int      @default(0)
     lastAttemptAt   DateTime? @map("last_attempt_at")
     deliveredAt     DateTime? @map("delivered_at")
     lastError       String?   @map("last_error")
     nextRetryAt     DateTime  @default(now()) @map("next_retry_at")

     @@index([deliveredAt, nextRetryAt])
     @@map("webhook_outbox")
   }
   ```

2. **Refactorer `emitHubWebhookAsync`** : au lieu d'appeler `fetch` direct,
   INSERT dans `webhook_outbox` dans la même transaction Prisma que la
   mutation locale (garantit l'atomicité — si la mutation rollback, l'outbox
   row aussi).

3. **Worker** : 2 options
   - Option A : cron Node.js qui poll outbox toutes les 5s
     (`SELECT * WHERE delivered_at IS NULL AND next_retry_at <= NOW() ORDER BY created_at LIMIT 50`).
     Plus simple à déployer (1 container suffit).
   - Option B : BullMQ + Redis. Plus puissant (priorité, dead-letter queue,
     UI Bull-Board) mais ajoute une dépendance.

   **Reco** : Option A. On a déjà du cron Node dans le projet, pas besoin
   de Redis pour ce volume (< 100 events/jour estimé).

4. **Gestion d'erreur** : sur fetch fail → `attempts++`, `last_error = err.msg`,
   `next_retry_at = NOW + exp(attempts) * 1s` (max 1h, donnée par le ticket
   parent). Après 10 tentatives → bascule en dead-letter (alerte ops).

5. **Tests** :
   - Mutation locale + crash avant flush → l'outbox row existe, le worker
     la consomme au prochain tick.
   - Idempotency_key déjà reçue Hub (200 `deduplicated: true`) → marquer
     `delivered_at` sans retry.
   - Retry exponentiel respecté.

### Pièges déjà connus

- Le code actuel utilise `emitHubWebhookAsync` (sans await), donc la
  garantie de durabilité n'est aujourd'hui PAS celle du contrat §7.1.
  Le passage à l'outbox change le contrat sans casser l'interface publique
  (signature `(event, tenantId, data)` inchangée).
- En env test/dev, l'outbox doit être no-op (NODE_ENV=test) OU
  inséré-puis-immédiatement-marqué-delivered pour ne pas saturer les
  fixtures de tests.

## Estimation

~1.5 j (migration Prisma + worker + tests + déploiement staging avec
monitoring du backlog outbox).

## Référence

- Pattern outbox : https://microservices.io/patterns/data/transactional-outbox.html
- Ticket parent (sprint courant) : `todo/done/2026-05-23-emit-webhook-events-niveau2-sync.md`
- Helpers Hub : `veridian-hub/lib/sync/snapshot-updater.ts`
- Contrat events : `veridian-hub/docs/CONTRAT-HUB.md` §7.1 v1.5
