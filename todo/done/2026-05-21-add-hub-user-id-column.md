# [PROSPECTION] Ajouter colonne users.hub_user_id (§3.7 v1.5)

> **Type** : Migration Prisma additive
> **Sévérité** : 🟡 P1 — pré-requis du ticket `2026-05-21-hub-attach-member-endpoint.md`
> **Owner** : agent Prospection
> **Créé** : 2026-05-21
> **Réfère** : `CONTRAT-HUB.md` v1.5 §3.7

## Contexte

Le contrat v1.5 grave (§3.7) le modèle d'identité cross-app :
- `hub_app.users.id` = source de vérité humaine
- `<app>.users.id` = PK locale, INCHANGÉE
- `<app>.users.hub_user_id` = **nouvelle colonne nullable** UNIQUE, backfillée
  au premier contact Hub (provision, attach-member, sync-member, update-plan)

C'est un pré-requis pour câbler `attach-member` proprement (sinon résolution
user uniquement par email → fragile sur les cas pathologiques).

## Migration Prisma

### Étape 1 — Schéma

```prisma
model User {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email       String   @unique
  hubUserId   String?  @unique @map("hub_user_id") @db.Uuid  // NEW v1.5
  // ... reste inchangé
}
```

### Étape 2 — Migration SQL

`prisma/migrations/<timestamp>_add_users_hub_user_id/migration.sql` :

```sql
ALTER TABLE users ADD COLUMN hub_user_id UUID NULL;
CREATE UNIQUE INDEX users_hub_user_id_uniq ON users(hub_user_id) WHERE hub_user_id IS NOT NULL;
```

NOT NULL pas envisageable : on backfille progressivement, jamais d'un coup.

### Étape 3 — Helper backfill

Créer `src/lib/hub/identity.ts` :

```typescript
import { prisma } from '@/lib/prisma';

/**
 * Résout un user Prospection à partir de l'identité Hub.
 * Ordre de résolution :
 * 1. Match par hub_user_id (si déjà backfillé)
 * 2. Match par email + backfill hub_user_id
 * 3. Création user local avec hub_user_id rempli
 */
export async function resolveOrCreateUserFromHub(params: {
  hubUserId: string;
  email: string;
}): Promise<{ id: string; createdByHub: boolean }> {
  // 1. Match par hub_user_id
  const byHubId = await prisma.user.findUnique({
    where: { hubUserId: params.hubUserId },
    select: { id: true },
  });
  if (byHubId) return { id: byHubId.id, createdByHub: false };

  // 2. Match par email + backfill
  const byEmail = await prisma.user.findUnique({
    where: { email: params.email },
    select: { id: true, hubUserId: true },
  });
  if (byEmail) {
    if (!byEmail.hubUserId) {
      await prisma.user.update({
        where: { id: byEmail.id },
        data: { hubUserId: params.hubUserId },
      });
    }
    return { id: byEmail.id, createdByHub: false };
  }

  // 3. Créer
  const created = await prisma.user.create({
    data: {
      email: params.email,
      hubUserId: params.hubUserId,
      // password, emailVerified, etc. = NULL (Hub-driven)
    },
    select: { id: true },
  });
  return { id: created.id, createdByHub: true };
}
```

### Étape 4 — Câbler dans les endpoints existants

À mettre à jour pour utiliser `resolveOrCreateUserFromHub` au lieu des
résolutions ad-hoc actuelles :

- `src/app/api/tenants/provision/route.ts` (extraire `metadata.hub_user_id`)
- `src/app/api/tenants/attach-owner/route.ts` (idem)
- Le futur `src/app/api/veridian/workspaces/[workspaceId]/attach-member/route.ts`
  (utilisera directement)

### Étape 5 — Tests

`src/lib/hub/identity.test.ts` (5 tests minimum) :

1. Match par `hub_user_id` existant → use it
2. Match par email + `hub_user_id` NULL → backfill OK
3. Match par email + `hub_user_id` déjà rempli (autre que celui demandé) → conflit / utiliser le local
4. Pas de match → création avec `hub_user_id` rempli
5. Idempotent : 2 appels consécutifs avec mêmes params → même `users.id`

## Application en prod

Migration tier 🟡 MOYEN (§20 CI-ARCHITECTURE) :

- Migration ADDITIVE (ADD COLUMN nullable) → zéro downtime
- Pas de DROP, pas de NOT NULL forcé
- Backfill progressif via les endpoints existants
- Cron de nettoyage tardif possible : "tous les users avec hub_user_id NULL
  qui ont login récemment → resolve par email"

Cf [[project_prisma_migrate_pattern]] pour le mode d'application manuel
(la CI prod n'applique pas `prisma migrate deploy`).

## Effort estimé

- 0.5j : migration + schema Prisma + helper
- 0.5j : câblage dans endpoints existants + tests
- Total : ~1j

## Référence

- `CONTRAT-HUB.md` v1.5 §3.7
- `CONTRAT-HUB-API-REF.md` v1.0 sections ATTACH, SYNC
- Ticket `2026-05-21-hub-attach-member-endpoint.md` (utilise ce helper)
