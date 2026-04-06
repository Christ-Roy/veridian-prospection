# Invite Flow — V1 démo

> Doc de référence pour la démo commerciale : comment un admin invite un collègue
> à rejoindre son workspace Prospection en moins de 30 secondes.
>
> Dernière mise à jour : 2026-04-05

---

## 1. Objectif utilisateur

En 30 secondes, un admin doit pouvoir inviter un collègue par email :

1. Admin ouvre `/admin/invitations`
2. Clic « Nouvelle invitation »
3. Remplit email + sélectionne un workspace + choisit le rôle
4. Valide → le collègue reçoit un mail avec un lien unique
5. Collègue clique le lien → définit son mot de passe → atterrit directement sur `/prospects`

Aucune confirmation email manuelle, aucune config SSO — juste un lien magique + password.

---

## 2. Schéma du flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                            CÔTÉ ADMIN                               │
└─────────────────────────────────────────────────────────────────────┘

  Admin (robert@veridian.site)
        │
        │ 1. navigate
        ▼
  /admin/invitations
        │
        │ 2. clic « Nouvelle invitation »
        ▼
  Dialog [email + workspace + role]
        │
        │ 3. submit
        ▼
  POST /api/admin/invitations
        │                                                ┌──────────┐
        │ 4. requireAdmin + validation                    │ Supabase │
        ▼                                                │          │
  INSERT INTO invitations                                │          │
  (email, tenant_id, workspace_id, role, token,         │          │
   invited_by, expires_at = now() + 7d)                 │          │
        │                                                │          │
        │ 5. generateLink (type=invite)                  │          │
        │────────────────────────────────────────────────►          │
        │                                                │ SMTP →   │
        │                                                │ boîte    │
        │                                                │ collègue │
        │                                                └──────────┘
        │
        ▼
  Response { id, token, inviteUrl, emailSent:true }
        │
        ▼
  Table /admin/invitations affiche
  l'invitation avec badge « En attente »

┌─────────────────────────────────────────────────────────────────────┐
│                          CÔTÉ COLLÈGUE                              │
└─────────────────────────────────────────────────────────────────────┘

  Inbox collègue
        │
        │ 1. clic lien dans mail
        ▼
  /invite/[token]
        │
        │ 2. fetch (server) GET /api/invitations/[token]
        ▼
  Landing « Vous avez été invité par robert@veridian.site »
  + form password + fullName
        │
        │ 3. submit
        ▼
  POST /api/invitations/[token]/accept
  body: { password, fullName }
        │
        │ 4. acceptInvitation()
        │    ├── supabase.admin.createUser(email, password, email_confirm:true)
        │    ├── upsert workspace_members (user_id, workspace_id, role)
        │    ├── UPDATE invitations SET accepted_at = now()
        │    └── signInWithPassword → session
        ▼
  Response { session:{access_token, refresh_token}, userId, redirectTo:'/prospects' }
        │
        │ 5. supabase.auth.setSession(session)
        │    cookies sb-<ref>-auth-token posés
        ▼
  window.location = '/prospects'
        │
        ▼
  Dashboard Prospection du workspace
  (multi-tenant scoping via tenantId JWT claim)
```

---

## 3. Endpoints API

| Méthode | Route                                      | Auth          | Description |
|---------|--------------------------------------------|---------------|-------------|
| GET     | `/api/admin/invitations?status=all`        | requireAdmin  | Liste les invitations du tenant (statuts : `pending`, `accepted`, `revoked`, `expired`, `all`) |
| POST    | `/api/admin/invitations`                   | requireAdmin  | Crée une invitation. Body : `{ email, workspaceId?, role? }`. Renvoie `{ id, token, inviteUrl, expiresAt, emailSent, email, workspaceId, role }` avec status 201 |
| DELETE  | `/api/admin/invitations/:id`               | requireAdmin  | Révoque (soft-delete via `revoked_at`). Scopé au tenant — idempotent → 204 |
| GET     | `/api/invitations/:token`                  | **public**    | Lookup invitation par token. Renvoie `{ email, role, workspaceId, workspaceName, inviterEmail, expiresAt }`. 404 si invalide/expirée/consommée |
| POST    | `/api/invitations/:token/accept`           | **public**    | Accepte l'invitation. Body : `{ password (≥8), fullName? }`. Rate limit : 10 req/min/IP. Renvoie `{ session, userId, redirectTo }` |

> Les routes publiques utilisent le token comme credential — pas de cookie nécessaire.
> Rate limit côté `accept` pour éviter le brute-force password.

---

## 4. Schéma DB

Table `invitations` (Postgres 15, migration `scripts/2026-04-05_add-invitations-table.sql`) :

| Colonne       | Type          | Nullable | Default                    | Description |
|---------------|---------------|----------|----------------------------|-------------|
| `id`          | SERIAL        | NO       | auto-increment             | PK |
| `email`       | TEXT          | NO       |                            | Email de l'invité (lowercased à la création) |
| `invited_by`  | UUID          | NO       |                            | `user_id` Supabase de l'admin qui a créé l'invitation |
| `tenant_id`   | UUID          | NO       |                            | Scope multi-tenant |
| `workspace_id`| UUID          | YES      |                            | Workspace cible (optionnel — `NULL` = tenant-level) |
| `role`        | TEXT          | NO       | `'member'`                 | `'admin'` ou `'member'` (CHECK contrainte) |
| `token`       | TEXT          | NO       |                            | Token unique (32+ chars, UNIQUE) — porté dans l'URL |
| `expires_at`  | TIMESTAMPTZ   | NO       | `now() + interval '7 days'`| Expiration automatique |
| `accepted_at` | TIMESTAMPTZ   | YES      |                            | Set quand le collègue accepte |
| `revoked_at`  | TIMESTAMPTZ   | YES      |                            | Soft-delete admin |
| `created_at`  | TIMESTAMPTZ   | NO       | `now()`                    | |

Index : `invitations_tenant_id_idx`, `invitations_token_idx`, `invitations_email_idx`.

Le statut calculé (`pending`/`accepted`/`revoked`/`expired`) est dérivé côté code depuis
`revoked_at`, `accepted_at` et `expires_at` — il n'est **pas** stocké.

---

## 5. Tester en local

### Avec curl (API pure)

```bash
# 1. Magic link admin pour récupérer une session
SUPABASE_URL=http://localhost:54321 \
SUPABASE_SERVICE_ROLE_KEY=... \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
APP_URL=http://localhost:3000 \
npx tsx scripts/test-invite-api.ts

# Le script :
#  - login admin (magic link)
#  - POST /api/admin/invitations
#  - GET /api/invitations/:token
#  - POST /api/invitations/:token/accept
#  - DELETE /api/admin/invitations/:id
#  - Cleanup user Supabase
```

### Avec le browser

1. `npm run dev` dans `dashboard/`
2. Login comme `robert@veridian.site` (tenant owner) → `http://localhost:3000/login`
3. Goto `http://localhost:3000/admin/invitations`
4. Clic « + Nouvelle invitation » → remplir `test-local@yopmail.com` + workspace + role
5. Copier l'`inviteUrl` depuis le dialog qui s'affiche
6. Ouvrir une **fenêtre privée** (sinon tu écrases ta session admin), coller le lien
7. Remplir password `TestLocal2026!` + submit → redirect `/prospects`
8. Retour sur la fenêtre admin, refresh `/admin/invitations` → badge « Acceptée »

---

## 6. Tester en staging

URLs :
- Dashboard : https://saas-prospection.staging.veridian.site
- Page admin : https://saas-prospection.staging.veridian.site/admin/invitations
- API invitation (public) : https://saas-prospection.staging.veridian.site/api/invitations/:token

Credentials et procédure détaillés dans [`dashboard/docs/TESTING.md`](./TESTING.md).

Tests automatisés couvrant ce flow :
- `scripts/test-invite-api.ts` — smoke API pure (wiré dans CI `e2e-staging`)
- `e2e/admin-pages-v1.spec.ts` — vérifie que `/admin/invitations` charge sans console error
- `e2e/invite-flow.spec.ts` — scénario e2e complet avec 2 browser contexts (admin + collègue)

---

## 7. Limitations V1 connues

- **Pas de resend** : si le collègue ne reçoit pas l'email, l'admin doit **supprimer** l'invitation et en créer une nouvelle. Pas de bouton « renvoyer ».
- **Pas de SSO** : uniquement email + password. Google OAuth / SAML arrivent en V2.
- **SMTP Supabase staging peut avoir des delivery issues** (rate limit, spam folder, domaine pas whitelisté). Fallback : copier le lien directement depuis la UI admin (dialog « Lien d'invitation ») et l'envoyer par un autre canal (Slack, mail perso).
- **Pas de gestion fine des rôles multi-workspace** : un user peut être `member` ou `admin`, mais une invitation cible UN workspace à la fois. Pour inviter sur plusieurs workspaces, créer plusieurs invitations.
- **Pas de détection de doublons** : on peut créer plusieurs invitations pending pour la même adresse. La dernière acceptée « gagne », les autres restent pending jusqu'à expiration.
- **Pas d'audit log** : on ne garde que `invited_by` et `created_at`. Pas d'historique de qui a révoqué quoi, ni des changements de rôle post-acceptation.
- **Expiration dure à 7 jours** : non configurable côté UI, uniquement au niveau de la migration SQL.
- **Rate limit accept 10 req/min/IP** : assez permissif, à durcir si besoin.

---

## 8. Roadmap V2 post-démo

Par ordre de priorité business :

1. **Resend email** — bouton « renvoyer » qui régénère le lien Supabase sans changer le token DB
2. **SSO Google OAuth** — `supabase.auth.signInWithOAuth({ provider:'google' })` + binding sur l'invitation en attente
3. **Rôles multi-workspace** — inviter un user sur plusieurs workspaces en une seule opération
4. **Audit log invitations** — nouvelle table `invitation_events` avec `created|accepted|revoked|resent|expired`
5. **Bulk invite** — CSV upload (email,workspace,role) dans le dialog admin
6. **Email customisable** — template MJML Notifuse au lieu du SMTP Supabase par défaut
7. **Webhook outbound** — notif Slack / webhook custom à chaque acceptation
8. **TTL configurable** — slider 1/7/14/30 jours dans le dialog admin
9. **Détection doublons** — si une invitation pending existe déjà pour cet email, proposer soit de resend soit d'en créer une nouvelle
10. **Self-service signup avec invitation code** — landing `/signup?code=XYZ` au lieu d'un lien complet

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `scripts/2026-04-05_add-invitations-table.sql` | Migration SQL |
| `src/lib/invitations.ts` | Lib serveur (create/list/get/accept/revoke) |
| `src/app/api/admin/invitations/route.ts` | GET + POST admin |
| `src/app/api/admin/invitations/[id]/route.ts` | DELETE admin |
| `src/app/api/invitations/[token]/route.ts` | GET public (lookup) |
| `src/app/api/invitations/[token]/accept/route.ts` | POST public (accept) |
| `src/app/admin/invitations/page.tsx` | UI admin (table + dialog) |
| `src/app/invite/[token]/page.tsx` | Landing serveur |
| `src/app/invite/[token]/invite-accept-form.tsx` | Form client d'acceptation |
| `scripts/test-invite-api.ts` | Smoke API automatisé |
| `e2e/invite-flow.spec.ts` | Test e2e 2 contexts |
| `e2e/admin-pages-v1.spec.ts` | Smoke pages admin V1 |
