# [PROSPECTION] Persister /api/errors en DB + endpoint agrégation

> **Type** : Observability
> **Sévérité** : 🟡 P1 — sans ça, les bugs intermittents prod restent invisibles
> **Owner** : agent Prospection
> **Créé** : 2026-05-23

## Contexte

`src/components/client-error-boundary.tsx` capture `window.onerror` +
`unhandledrejection` et POST sur `/api/errors`. **Bonne brique en place.**

Mais `src/app/api/errors/route.ts` se contente d'un `console.error()`.
Conséquences :

1. Les erreurs partent en stdout container Docker → Dokploy logs →
   archivées par Docker selon la politique de retention (par défaut
   plusieurs jours, peuvent être tronquées sous pression I/O).
2. **Impossible de requêter** "combien de fois ce TypeError s'est-il
   produit cette semaine ?" — il faut grep les logs container, fastidieux
   et peu fiable.
3. **Pas d'alerting** si un déploiement fait spiker les erreurs.
4. La question "ce bug est-il toujours présent après le fix défensif
   `d5ae9e8` ?" est aujourd'hui sans réponse opérationnelle.

## Fix proposé

### 1. Migration Prisma — table `client_error`

```prisma
model ClientError {
  id          String   @id @default(cuid())
  tenantId    String?  // null si l'erreur est avant login
  userId      String?
  message     String   @db.Text
  stack       String?  @db.Text
  url         String?  @db.Text
  userAgent   String?  @db.Text
  filename    String?
  lineno      Int?
  colno       Int?
  source      String?  // "window.onerror" | "unhandledrejection"
  occurredAt  DateTime @default(now())

  // Dedupe key pour group-by analytics (hash de message + filename + lineno).
  dedupeKey   String?
  @@index([dedupeKey, occurredAt])
  @@index([tenantId, occurredAt])
}
```

### 2. `/api/errors` POST → INSERT avec dédupe

```ts
import { hash } from "node:crypto";
// ...
const dedupeKey = createHash("sha1")
  .update(`${message}|${filename}|${lineno}`)
  .digest("hex")
  .slice(0, 16);

await prisma.clientError.create({ data: { message, stack, url, userAgent, filename, lineno, colno, source, dedupeKey, tenantId, userId } });
```

Rate limit existant (10/min/IP) conservé — c'est bien.

### 3. Endpoint admin `/api/admin/errors`

```ts
GET /api/admin/errors?since=7d
// → groupBy dedupeKey, count, latestOccurredAt, sampleStack
```

UI admin minimale : page `/admin/errors` qui affiche les top 10
erreurs par fréquence + délai depuis dernière occurrence. Une ligne
par dedupeKey.

### 4. (Bonus, ticket séparé) Alerte Telegram

Si une nouvelle dedupeKey apparaît > N fois en M minutes → Telegram
admin. Out of scope ce ticket, mais facile à brancher sur l'endpoint
agrégation une fois en place.

## Pourquoi P1

Sans ça, le debug du `bug-intermittent-prospects-undefined-length`
**ne peut pas être validé**. La promesse "le bug est fixé" n'a pas de
preuve opérationnelle — on saura seulement quand un user nous écrira
(jamais, vu que le bug est résolu par refresh).

C'est exactement ce que le ticket `2026-05-23-app-robustness-cadre.md`
souligne. Cette pièce est manquante.

## Effort

- Migration Prisma : 10 min (cf [[project_prisma_migrate_pattern]] pour
  l'application via container node:22-alpine)
- INSERT dans route : 15 min
- Endpoint admin + UI minimale : 1h
- Tests unit (route handler + dedupe key) : 30 min

Total ~2h. ROI élevé : ouvre la voie à un suivi rationnel de la santé
frontend prod.

## Liens

- Bug original : `todo/done/2026-05-23-bug-intermittent-prospects-undefined-length.md`
- Cousin : `todo/2026-05-23-source-maps-prod-debug-intermittent.md` (sourcemaps
  pour stacks lisibles côté serveur)
- Cadre : `todo/2026-05-23-app-robustness-cadre.md`
