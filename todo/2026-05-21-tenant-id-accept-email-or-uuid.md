# [PROSPECTION] Accepter tenant_id en email OU UUID dans routes T3+T2

> **Type** : Patch contrat — résolution robuste
> **Sévérité** : 🔴 P1 — bloque promo T3 prod
> **Owner** : agent Prospection (T3 ou Hub)
> **Créé** : 2026-05-21
> **Bloque** : promo T3 (sync/remove/restore/freeze/unfreeze) en prod

## Contexte (bug découvert lors du smoke staging)

Le smoke E2E T3 staging du 2026-05-21 a révélé que `POST /api/tenants/provision`
retourne `tenant_id: email` (cf `src/app/api/tenants/provision/route.ts:312`)
alors que les nouvelles routes T3+T2 lookup le tenant via
`prisma.tenant.findUnique({where: {id: tenantId}})` qui attend l'UUID local.

Conséquence : si le Hub stocke `tenant_id = email` (comme provision le suggère)
et appelle `POST /api/tenants/{email}/sync-member`, Prosp répond **404
tenant_not_found** systématiquement. C'est un contrat cassé bout-en-bout.

Smoke staging avec UUID correct = 8/8 verts. Smoke avec email = 8/8 KO.

## Décision Robert (2026-05-21)

**Option B** : Prospection accepte les deux formats. Plus simple, plus
défensif, pas de coordination Hub nécessaire. Le `[id]` dans l'URL des
routes tenant-level peut être soit l'UUID local soit l'email owner.

## Routes à patcher

Toutes les routes qui font `prisma.tenant.findUnique({where: {id: tenantId}})` :

- `src/app/api/tenants/[id]/sync-member/route.ts`
- `src/app/api/tenants/[id]/remove-member/route.ts`
- `src/app/api/tenants/[id]/restore-member/route.ts`
- `src/app/api/tenants/[id]/freeze-members/route.ts`
- `src/app/api/tenants/[id]/unfreeze-members/route.ts`

Toute autre route `/api/tenants/[id]/*` qui aurait le même pattern (grep
avant de toucher).

## Helper à introduire

Créer `src/lib/hub/tenant-lookup.ts` :

```typescript
import { prisma } from '@/lib/prisma';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Résout un tenant Prospection à partir d'un id qui peut être :
 *  - l'UUID local Prisma (tenants.id)
 *  - l'email du owner (cf contrat Hub legacy — tenant_id retourné par provision = email)
 *
 * Retourne le tenant ou null si non trouvé.
 */
export async function resolveTenantByIdOrEmail(idOrEmail: string) {
  if (UUID_RE.test(idOrEmail)) {
    return prisma.tenant.findUnique({
      where: { id: idOrEmail },
      select: { id: true, userId: true },
    });
  }
  // Sinon = email owner → JOIN users
  const user = await prisma.user.findUnique({
    where: { email: idOrEmail },
    select: { id: true },
  });
  if (!user) return null;
  return prisma.tenant.findFirst({
    where: { userId: user.id },
    select: { id: true, userId: true },
  });
}
```

## Câblage routes

Remplacer dans chaque route T3 :

```typescript
// AVANT
const tenant = await prisma.tenant.findUnique({
  where: { id: tenantId },
  select: { id: true },
});
if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

// APRÈS
const tenant = await resolveTenantByIdOrEmail(tenantId);
if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
// Utiliser tenant.id (UUID local) pour la suite de la logique
```

⚠️ Bien utiliser **`tenant.id`** (UUID) en interne après résolution, pas
le `tenantId` brut de l'URL.

## Tests obligatoires

`__tests__/lib/hub/tenant-lookup.test.ts` :

1. Lookup par UUID existant → retourne le tenant
2. Lookup par UUID inexistant → null
3. Lookup par email owner existant → retourne le tenant
4. Lookup par email user qui n'a pas de tenant → null
5. Lookup par email inexistant → null
6. Lookup par string ni UUID ni email → null (pas de match)

Pour chaque route T3 patchée, **ajouter 2 tests** :
- Call avec UUID → fonctionne
- Call avec email owner → fonctionne pareil

## Flow ship STAGING UNIQUEMENT

1. Pull rebase staging
2. Code + tests + commit `fix(hub): accept tenant_id as email OR UUID in T3 routes [risk:medium]`
3. Push staging
4. CI vert
5. Re-run smoke T3 staging avec **email** comme tenant_id (le bug original)
6. Tous OK → **STOP en staging**, ping team-lead pour go promo prod
7. Pas d'archivage ticket tant que pas en prod

## Note T2 attach-member

T2 (`POST /api/veridian/workspaces/[workspaceId]/attach-member`) utilise un
`workspaceId` (UUID workspace local) pas un `tenantId`. Donc T2 n'est PAS
concerné par ce patch — workspace_id reste UUID strict. Le Hub doit
récupérer le workspace UUID via le flow d'invitation (Hub a la table
`hub_app.tenants` qui peut stocker le workspace_id local après provision).

## Référence

- Bug découvert : smoke staging 2026-05-21 (team-lead)
- Provision response actuelle : `src/app/api/tenants/provision/route.ts:312` (`tenant_id: email`)
- Ticket sprint v15 parent : `2026-05-21-sprint-v15-cross-app.md`

## Effort

- 0.5j (helper + câblage 5 routes + tests + smoke)
