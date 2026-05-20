# 2026-05-20 — Fix auth/token HMAC + cleanup Supabase global

> **Demandeur** : agent Hub (session 2026-05-20)
> **Priorité Phase 1** : 🔴 P1 — autologin Prospection cassé sur staging
> **Priorité Phase 2** : 🟢 P3 — cleanup Supabase global (54 fichiers)
> **Contexte cross-agent** : voir `veridian-hub/docs/CONTRAT-HUB.md` §6bis
> (autologin SSO-stack Veridian — 3 couches)

## Contexte

### Symptôme observé sur staging 2026-05-20

User Robert signup sur `hub.staging.veridian.site` → clique "Commencer
l'essai gratuit" sur la carte Prospection → toast "Essai démarré ✓" →
ouverture nouvel onglet `prospection.staging.veridian.site` →
**redirige sur `/login` au lieu de logger l'user**.

Logs Prospection :

```
[provision] Generated token for robert+staging-test-...@veridian.test
[provision] Auto-admin OK: user=c014b8a3... tenant=2af46619... workspace=9e5a1896...
[auth/token] Validating token, host=prospection.staging.veridian.site, supabaseUrl=set
[auth/token] Supabase not configured — skipping token validation
```

Donc :
- Provisioning Hub → Prospection ✅ (HMAC standard, user_id transmis,
  workspace + owner créés — la livraison Hub Phase 1 fonctionne)
- Auto-login token **fail silencieusement** parce que `auth/token`
  valide le token contre Supabase (legacy), et Supabase n'est pas
  configuré sur staging → skip validation → user pas authentifié.

### Cause racine

`src/app/api/auth/token/route.ts` valide le token autologin en faisant :

```ts
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const { data: tenant } = await supabase
  .from("tenants")
  .select("id, prospection_login_token_created_at, prospection_login_token_used")
  .eq("prospection_login_token", token)
  .maybeSingle();
```

→ Lookup le token dans la table Supabase `tenants`. C'est un reliquat
de la migration Auth.js (le TODO en commentaire le mentionne) — mais en
fait, **le token est déjà dans la DB Prisma locale Prospection**, le
détour par Supabase est inutile.

## Phase 1 — Fix auth/token (P1 urgent)

### Demande

Remplacer la validation Supabase de `src/app/api/auth/token/route.ts`
par une validation 100% locale (Prisma + table `tenants` Prospection).

**Pas besoin d'appeler le Hub** : le token est généré localement par
`POST /api/tenants/provision` (le Hub appelle Prospection en HMAC,
Prospection génère son token autologin, le stocke en local + retourne
au Hub qui le redirige vers l'user). Donc le flow est :

```
1. Hub → POST /api/tenants/provision (HMAC §6.1) ✅ déjà OK
   → Prospection stocke token en local + retourne login_url avec ?t=<token>
2. User browser → GET prospection/auth/token?t=<token>
   → Prospection valide token contre sa propre DB Prisma ← À FIXER
   → Set cookie session locale Prospection
   → Redirect /
```

### Implémentation suggérée

```ts
// src/app/api/auth/token/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth/session"; // existant ou à créer

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const host = request.headers.get("x-forwarded-host") ?? "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const baseUrl = `${proto}://${host}`;

  const tenant = await prisma.tenant.findFirst({
    where: { prospection_login_token: token },
    select: {
      id: true,
      hub_user_id: true,
      owner_email: true,
      prospection_login_token_created_at: true,
      prospection_login_token_used_at: true,
    },
  });

  if (!tenant) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", baseUrl));
  }
  if (tenant.prospection_login_token_used_at) {
    return NextResponse.redirect(new URL("/login?error=token_used", baseUrl));
  }
  const ageMs = Date.now() - tenant.prospection_login_token_created_at.getTime();
  if (ageMs > 24 * 60 * 60 * 1000) {
    return NextResponse.redirect(new URL("/login?error=token_expired", baseUrl));
  }

  // Mark used (one-shot token)
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { prospection_login_token_used_at: new Date() },
  });

  // Set session cookie locale Prospection (mécanisme propre à Prospection)
  const res = NextResponse.redirect(new URL("/", baseUrl));
  res.cookies.set({
    name: "prospection.session",
    value: signSession({
      user_id: tenant.hub_user_id,
      email: tenant.owner_email,
      tenant_id: tenant.id,
    }),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30j
  });
  return res;
}
```

(Le détail de la session — JWT ou opaque store DB — est à ton appréciation,
cf ce qui est déjà en place côté Prospection. Ce qui compte c'est que la
validation ne passe **plus** par Supabase.)

### Test attendu

- Smoke staging post-fix : signup Hub → click trial Prospection → nouvel
  onglet ouvre et **arrive sur `/prospects` (ou home logged-in)**, plus
  sur `/login`.
- Test unit `__tests__/app/api/auth/token/route.test.ts` : assert token
  valide → 302 vers `/` + cookie session set ; token expiré/used/inexistant
  → 302 vers `/login?error=...`.

### DoD Phase 1

- [ ] `src/app/api/auth/token/route.ts` ne contient plus `@supabase/supabase-js`
- [ ] Test unit colocalisé vert
- [ ] Smoke staging end-to-end OK (signup Hub → trial → autologin Prospection
      sans repasser par /login)
- [ ] Notif au Hub via réponse sur ce ticket

## Phase 2 — Cleanup Supabase global (P3)

### Inventaire

54 fichiers TS/TSX côté Prospection référencent encore Supabase. Les
gros (10+ imports actifs `@supabase/supabase-js`) :

- `src/app/api/auth/token/route.ts` — fixé en Phase 1 ✓
- `src/app/api/webhooks/stripe/route.ts`
- `src/app/api/trial/route.ts`
- `src/app/api/admin/members/route.ts`
- `src/app/api/admin/kpi/route.ts`
- `src/app/api/invitations/[token]/route.ts`
- `src/app/api/status/route.ts`
- ... (cf `grep -rn "@supabase" src/`)

### Approche recommandée

1. **Sprint 1 (1-2j)** : identifier quelles tables sont encore lues
   via Supabase. Pour chacune :
   - Si déjà en Prisma local Prospection → remplace l'appel Supabase
     par Prisma.
   - Si pas en Prisma → migration Prisma + import des données via dump
     ponctuel.
2. **Sprint 2 (1j)** : nettoyer les imports morts, retirer
   `@supabase/supabase-js` du `package.json`.
3. **Sprint 3 (30min)** : audit final `grep -r supabase src/` → doit
   retourner 0 résultat (sauf commentaires expliquant l'historique).

### Référence du ticket dette technique existant

Ce cleanup est déjà listé comme "Sprint 2 — Supabase cleanup global"
dans `todo/2026-05-19-dette-technique-audit.md` (~6h estimées). Ce
ticket-ci formalise la demande Hub : la priorité monte à P3 (pas
P5) parce que **chaque appel Supabase dans Prospection est un risque
de désync silencieuse** identique à celui fixé en Phase 1.

### DoD Phase 2

- [ ] `grep -r "@supabase/supabase-js" src/` → 0 résultat
- [ ] `@supabase/supabase-js` retiré du `package.json`
- [ ] Suite de tests Prospection toujours verte
- [ ] Ticket archivé dans `todo/done/`

## Coordination cross-agent

- Phase 1 débloque la **couche 1 autologin** du contrat Hub §6bis.
  Critique pour démos clients.
- Phase 2 est indépendante mais cohérente avec la dette technique
  identifiée par toi-même le 2026-05-19.
- Le Hub n'a **plus** de référence Supabase runtime (audit fait :
  0 import `@supabase`, dep absente du `package.json`). Le seul reliquat
  est le nommage `User.supabaseUserId` (UUID bridge legacy, pas du code
  Supabase) — rename Hub planifié en P4 future, pas bloquant.

## Réponse — (à compléter par agent Prospection)
