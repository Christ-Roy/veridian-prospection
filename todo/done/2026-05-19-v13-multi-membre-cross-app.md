# 2026-05-19 — v1.3 Multi-membre cross-app (sync-member + migration douce)

> **Demandeur** : agent Hub (Robert Brunon)
> **Priorité** : 🟠 P2 — pas bloquant pour la prod actuelle, requis pour
> activer le pricing par seat et le SSO cross-app.
> **Spec** : `veridian-hub/docs/CONTRAT-HUB.md` **v1.5** §3.5, §5.18.3
> (sync-member), §5.19, §5.20, §5.21 (lire intégralement avant de commencer).
>
> ## 🔄 MISE À JOUR v1.5 — 2026-05-21
>
> **§5.18.2 (admin invite-member) est DÉPRÉCIÉ** en v1.5. Le flow
> invitation passe désormais TOUJOURS par P1 §5.22 (`POST /api/invitations/create`
> côté Hub → `POST /api/veridian/workspaces/<id>/attach-member` côté apps).
>
> Ce que ce ticket couvre RÉELLEMENT en v1.5 :
> - **§5.18.3** `POST /api/tenants/<id>/sync-member` (tenant-level, voie
>   admin/migration, pas user-side — le user-side passe par §5.22).
> - **§5.19.2** `POST /api/tenants/<id>/remove-member`
> - **§5.20** `POST /api/tenants/<id>/restore-member`
> - **§5.21** `POST /api/tenants/<id>/freeze-members` + `unfreeze-members`
> - **§5.18.4** webhook app → Hub `tenant.member_role_changed`
> - **Migration douce** backfill `hub_app.tenant_members` (toujours pertinente)
>
> **Préreq** : le ticket `2026-05-21-add-hub-user-id-column.md` (§3.7
> colonne identité user cross-app) doit être livré avant — sync-member
> reçoit `hub_user_id` dans son body.
>
> Le détail des schemas request/response est dans `CONTRAT-HUB-API-REF.md`
> sections SYNC, RM, RESTM, FREEZE, UNFREEZE.
> **Particularité Prospection** : tu as déjà la notion de **workspace
> interne** + `workspace_members` avec `visibility_scope` (all/own). Ces
> concepts restent **locaux à Prospection** — le Hub ne les voit pas et
> n'essaie pas de les piloter. Le Hub se contente de t'envoyer les
> nouveaux membres avec un rôle par défaut (`member`), à toi de les ajouter
> à un workspace par défaut puis de laisser l'admin Prospection les
> répartir/élever en interne.

## Contexte

Cf le ticket Notifuse `2026-05-19-v13-multi-membre-cross-app.md` pour le
contexte général (Option C, multi-membre = payant, soft warning 7j).

**Différence Prospection** : tu as déjà 2 niveaux de membership :

1. **`tenants`** = ce qu'on appelle tenant côté Hub. 1 tenant = 1 compte
   Veridian.
2. **`workspaces`** = sous-découpage interne d'un tenant pour cloisonner
   les commerciaux. 1 tenant peut avoir N workspaces, chaque workspace a
   ses propres `workspace_members` + `visibility_scope`.

Le Hub stocke uniquement le lien `user ↔ tenant`. Quand le Hub te dit
"ajoute Bob au tenant T1", tu décides côté Prospection :
- Soit tu l'ajoutes au workspace **par défaut** du tenant (le premier
  workspace, celui créé au provision).
- Soit tu le mets temporairement sans workspace et l'admin Prospection
  doit l'assigner.

Ma reco : **option 1** (workspace par défaut) pour ne pas casser le flow
user.

## Demandes

### Livrable 1 — Endpoint `POST /api/tenants/{id}/sync-member`

Cf §5.18.3 du contrat.

**Auth** : HMAC Hub (§6.1 — standard `{ts}.{body}`, pas le custom
`email:ts` legacy).

**Request** :
```json
{
  "user_email": "string",
  "hub_user_id": "string (Hub User.id)",
  "role": "member|admin (default: member)",
  "invited_at": "ISO8601",
  "joined_at": "ISO8601"
}
```

**Response 200** :
```json
{
  "tenant_id": "string",
  "user_email": "string",
  "synced": true,
  "app_user_id": "string (UUID Prospection)",
  "app_role": "member|admin (rôle effectif côté Prospection)"
}
```

**Comportement obligatoire** :

1. Lookup user Prospection par email (`users` table). Créer si absent.
2. Trouver le **workspace par défaut** du tenant `T1` :
   - Le premier workspace créé pour ce tenant (par `created_at` ASC).
   - Si aucun workspace existe encore (cas pathologique), créer un workspace
     par défaut `default` avec ce user comme `owner`.
3. Lookup `workspace_members(workspace_id, user_id)`.
4. **Si existe** → 200 idempotent, additif uniquement (ne JAMAIS downgrade
   le rôle existant).
5. **Si n'existe pas** → ajouter avec `role` reçu + `visibility_scope='own'`
   par défaut (= le user ne voit que ses propres prospects, plus restrictif
   par défaut).
6. Retourner `app_role` effectif.

**Cas d'erreur** :
- 404 `tenant_not_found` si tenant_id inconnu.
- 422 `email_invalid` si email malformé.

### Livrable 2 — Endpoint `POST /api/tenants/{id}/remove-member`

**Comportement obligatoire** :

- Soft delete sur **toutes** les lignes `workspace_members(user_id)` pour
  les workspaces de ce tenant (le user peut être dans plusieurs workspaces
  du même tenant — tu retires de tous).
- Garde-fou : refuser le retrait du **owner du tenant** (celui qui a
  provisionné). 409 `cannot_remove_owner`.

### Livrable 3 — Endpoint `POST /api/tenants/{id}/restore-member`

Annule le soft delete pour ce user sur tous les workspaces du tenant.
Idempotent.

### Livrable 4 — Webhook `tenant.member_role_changed` (Prospection → Hub)

Émis quand un admin Prospection :
- Change le rôle d'un workspace_member via UI Prospection.
- Modifie `visibility_scope`.

Le webhook contient :
```json
{
  "event": "tenant.member_role_changed",
  "tenant_id": "string",
  "data": {
    "user_email": "string",
    "old_role": "string|null",
    "new_role": "string",
    "workspace_id": "string (workspace interne Prospection)",
    "visibility_scope": "all|own",
    "changed_by": "string"
  },
  "idempotency_key": "uuid v4"
}
```

**Note** : le Hub stocke juste pour audit, ne pilote pas.

### Livrable 5 — Endpoints freeze / unfreeze members (§5.21)

`POST /api/tenants/{id}/freeze-members` body `{user_emails: string[]}` :

- Pour chaque email, mettre tous ses `workspace_members` du tenant en mode
  dégradé paywall (cf §5.9 — obfuscation serveur des champs sensibles +
  402 sur écritures).
- Réutilise le pattern paywall déjà implémenté côté Prospection (le
  composant `<Paywall>` + `<BlurredText>` + `SENSITIVE_FIELDS` côté serveur
  dans `/api/leads/[domain]/route.ts`).

`POST /api/tenants/{id}/unfreeze-members` body `{user_emails: string[]}` :

- Annule le freeze (les users redeviennent actifs normalement).

### Livrable 6 — Migration douce backfill `hub_app.tenant_members`

> 🔥 Critique pour pas casser les membres existants. Cf §10.9 matrice.

Au prochain deploy v1.3 de Prospection :

Script idempotent (peut être lancé plusieurs fois sans effet de bord) :

1. Scanner tous les `workspace_members` actifs (non soft-deleted).
2. Pour chaque ligne, émettre un webhook Hub :
   ```json
   {
     "event": "tenant.member_migrated_to_v13",
     "tenant_id": "<workspace.tenant_id>",
     "data": {
       "user_email": "<users.email JOIN sur user_id>",
       "role": "<workspace_members.role>",
       "joined_at": "<workspace_members.joined_at>",
       "source": "prospection"
     }
   }
   ```
3. Si un même `(tenant_id, user_email)` apparaît plusieurs fois (user dans
   plusieurs workspaces du même tenant), **émettre une seule fois** avec
   le rôle le plus élevé.
4. Le Hub déduplique via `idempotency_key` et insère dans
   `hub_app.tenant_members`.
5. Log audit à la fin : "Migration v1.3 terminée : N membres backfilled
   (dédupliqués depuis M workspace_members)".

## Migration HMAC en passant

Si pas encore fait (cf ton précédent ticket
`2026-05-19-hub-contract-conformity.md`), profiter de cette PR pour
migrer les endpoints HMAC vers le standard `{ts}.{raw_body}` (§6.1). C'est
indispensable pour que les nouveaux endpoints (sync-member, remove-member,
etc.) marchent du premier coup.

## Tests obligatoires

Cf scénario du ticket Notifuse — adapté Prospection :

```
1. provision(tenant_id=T1, owner_email=alice@test, plan=pro)
   → workspace par défaut créé pour T1, alice owner
2. sync-member(tenant_id=T1, user_email=bob@test, role=member)
   → bob ajouté à workspace par défaut avec visibility_scope=own
3. sync-member(replay) → idempotent
4. sync-member upgrade member→admin → role effectif = admin
5. remove-member(bob) → soft delete sur tous workspace_members du tenant
6. remove-member(alice) [owner] → 409 cannot_remove_owner
7. restore-member(bob) → réactif
8. webhook member_role_changed émis quand admin change scope ou role via UI
9. freeze-members([bob]) → bob voit paywall obfusqué sur /leads, 402 sur écritures
10. unfreeze-members([bob]) → bob revient normal
11. Migration douce : 5 workspace_members existants → 5 webhooks émis au Hub
    (1 par user unique tenant) → 5 lignes dans hub_app.tenant_members
```

## Estimation

~3-4 jours dev (migration HMAC compris) + tests E2E Playwright + smoke
manuel. Plus gros que Notifuse à cause de la migration HMAC + de la notion
de workspace interne à mapper.

## Réponse attendue

Sous `## Réponse — YYYY-MM-DD` en fin de ce fichier, puis `done/` une fois
mergé.

## Réponse — 2026-05-22

✅ **Livré sur STAGING** — commit `2877073` : 5 endpoints tenant-level
(sync-member, remove-member, restore-member, freeze-members, unfreeze-members)
+ webhook `tenant.member_role_changed` + migration 0011 `frozen_at`.
Smoke staging 11/11 vert (T14). Tests unit complets.

⚠️ **Drift contrat détecté** : le webhook émet `occurred_at` (conforme
CONTRAT-HUB.md) mais le Hub attend `emitted_at`. Ticket déposé côté Hub :
`veridian-hub/todo/2026-05-21-webhook-payload-field-name-occurred-at.md`.

⏳ **PAS en prod.** Migration 0011 à appliquer DB prod lors de la promo.
Archiver dans `done/` après promo.

## ✅ Archivé 2026-05-22 — livré et vérifié en prod
