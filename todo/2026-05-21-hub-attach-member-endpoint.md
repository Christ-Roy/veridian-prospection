# [PROSPECTION] Endpoint attach-member pour invitations Hub

> **Type** : Endpoint contrat cross-app, demandé par le Hub
> **Sévérité** : 🔴 P1 — bloque la phase 4b du P1 invitation Hub
> **Owner** : agent Prospection
> **Créé** : 2026-05-21 par l'agent Hub
> **Bloque** : `veridian-hub/lib/invitations/accept.ts` ne peut pas câbler
>              son `// TODO(P1-step4b)` tant que cet endpoint n'existe pas.

## Contexte

Le Hub a livré 5/9 étapes du P1 invitation endpoints (2026-05-21).
Aujourd'hui, quand un user accepte une invitation cross-app pour un
workspace Prospection, **le Hub marque l'invitation acceptée dans sa
table mais ne fait rien côté Prospection**. Conséquence : l'user
atterrit sur `prospection.app.veridian.site` mais n'est PAS membre du
workspace cible.

Le Hub renvoie volontairement 202 Accepted + `downstream_call: "pending"`
sur `POST /api/invitations/[token]/accept` pour signaler ce trou —
l'UI verra cet état et pourra afficher "votre accès est en cours
d'attribution".

Pour finir la boucle, Prospection doit exposer un endpoint que le Hub
appelle en HMAC après acceptation.

## Spec endpoint à livrer

**Route** : `POST /api/veridian/workspaces/[workspaceId]/attach-member`

**Pourquoi `/api/veridian/...` et pas `/api/workspaces/...`** : pour
isoler clairement les routes machine-to-machine (HMAC Hub) des routes
user (session Prospection). Cohérent avec les routes existantes Hub→
Prospection (`/api/veridian/tenants/provision`, etc.).

### Auth — HMAC Hub

Réutiliser `verifyHubHmac` existant (`src/lib/hub/hmac.ts`).

Headers attendus :
```
X-Veridian-Timestamp: 1747857600000
X-Veridian-Hub-Signature: <hex sha256>
```

Secret env Prospection : utiliser le **même** que pour les autres
routes Hub→Prospection (`HUB_API_SECRET` ou équivalent, à vérifier
selon convention en place).

⚠️ NE PAS introduire de nouveau secret dédié — un secret par app
côté Hub (`HUB_INVITATION_SECRET_PROSPECTION`) suffit, et Prospection
doit l'aligner sur son secret de réception Hub existant. Si ce n'est
pas le cas, créer alias env `HUB_INVITATION_SECRET=alias($HUB_API_SECRET)`.

### Body

```json
{
  "hub_user_id": "user_abc123",
  "hub_user_email": "alice@example.com",
  "role": "member",
  "invitation_id": "inv_xyz"
}
```

- `hub_user_id` : id côté `hub_app.users` — l'app stocke cet id (et
  pas un id local) pour cohérence cross-app.
- `hub_user_email` : pour affichage / debug (Prospection peut stocker
  ou pas, à voir avec le schéma membre existant).
- `role` : `'owner' | 'admin' | 'member'`. Mapper aux roles internes
  Prospection si différents.
- `invitation_id` : traçabilité audit (logger dans audit_log Prospection
  l'origine "via Hub invitation X").

### Réponse

Succès création (201) :
```json
{
  "attached": true,
  "already_member": false,
  "member_id": "<id local Prospection>",
  "workspace_id": "<workspaceId>",
  "role": "member",
  "login_url": "https://prospection.app.veridian.site/?token=..."
}
```

Idempotent — si user déjà membre du workspace avec le bon role :
```json
{
  "attached": true,
  "already_member": true,
  "member_id": "<id existant>",
  "workspace_id": "<workspaceId>",
  "role": "member",
  "login_url": "https://prospection.app.veridian.site/..."
}
```

**Toujours** retourner un `login_url` (magic link Prospection auto-login)
pour que le Hub redirige l'user vers son workspace sans qu'il ait à
re-saisir des credentials.

### Codes erreur

Code | Status | Sens
---|---|---
`unauthorized` | 401 | HMAC invalide ou drift > 5min
`workspace_not_found` | 404 | `workspaceId` n'existe pas en DB Prospection
`invalid_body` | 400 | Body Zod fail
`invalid_role` | 400 | `role` pas dans owner/admin/member
`workspace_suspended` | 423 | Workspace suspendu (billing) — pas d'add membre
`user_role_conflict` | 409 | User déjà membre avec un autre role (à arbitrer : update ou reject)

### Idempotence et sécurité

- Si la row `prospection_workspace_members(user_id, workspace_id)`
  existe déjà :
  - Même role → 200 `already_member: true` (no-op DB).
  - Role différent → décision business : on UPDATE (Hub a la
    source de vérité du nouveau role) ou on REJECT 409 ? Préférence
    Hub : **UPDATE** + audit log "role changed via Hub invitation".
- Toujours générer une row audit log Prospection avec
  `action=workspace.member.attached_via_hub`, `actor=hub:invitation`,
  `payload={hub_user_id, invitation_id, role, already_member}`.
- Pas de trigger d'email de bienvenue par Prospection — c'est le Hub
  qui gère les comms (étape 7 du P1 Hub).

### Tests obligatoires (mode Nuclear si applicable)

- Test HMAC valide → 201 + row créée
- Test HMAC invalide → 401
- Test drift timestamp > 5min → 401
- Test workspace inconnu → 404
- Test idempotence (re-call mêmes params) → 200 already_member=true
- Test conflit role → 200 update + audit
- Test workspace suspended → 423

## Sécurité hardening rappels

- Pas de log du body en clair (peut contenir `hub_user_email`).
- Pas de leak `attached: false` distinct de 401 — un attaquant ne doit
  pas pouvoir scanner `workspaceId` pour énumérer ceux qui existent.
  Le 404 doit être renvoyé seulement après HMAC OK (logique déjà gérée
  par le verify Hub en amont).
- Rate-limit recommandé (60/min/IP côté Prospection) — même si HMAC
  bloque déjà, défense en profondeur contre un Hub compromis.

## Lien avec le Hub

Une fois cet endpoint livré, l'agent Hub fait :

1. Câble le call HMAC dans `lib/invitations/accept.ts`
   (`// TODO(P1-step4b)`).
2. Bascule la réponse `POST /api/invitations/[token]/accept` de 202 → 200
   quand `downstream_call=completed`.
3. Renvoie le `login_url` retourné par Prospection au lieu d'un
   simple fallback `https://prospection.app.veridian.site`.

Cf doc Hub : `memory/reference_hub_invitation_hmac_contract.md` côté
agent Hub pour le contrat global.

## Référence

- Spec P1 Hub : `veridian-hub/todo/2026-05-20-hub-invitation-endpoints.md`
- Helper accept Hub : `veridian-hub/lib/invitations/accept.ts` (TODO marker)
- Pattern HMAC Prospection : `src/lib/hub/hmac.ts` (verifyHubHmac existant)
- Convention machine-to-machine : `CONTRAT-HUB.md` §6.1

## Effort estimé

- 0.5j : route Next + Zod + helper attach
- 0.5j : tests (HMAC verify, idempotence, edge cases)
- Total : ~1 jour
