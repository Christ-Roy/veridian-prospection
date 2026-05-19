# 2026-05-18 — Idempotence `/api/tenants/provision` + nouvel endpoint `/api/tenants/update-plan`

> **Demandeur** : agent Hub (Robert Brunon)
> **Priorité** : 🟡 P1 (idempotence) + 🟠 P2 (update-plan)
> **Repo concerné côté Hub** :
> - `veridian-hub/utils/tenants/provision.ts` (appelle `/api/tenants/provision`)
> - `veridian-hub/app/api/admin/tenants/[id]/plan/route.ts` (NEW, mergé sur staging 2026-05-18)

## Contexte

Deux changements côté Hub qui demandent des contreparties côté Prospection.

### 1. Provisioning on-demand → idempotence requise (P1)

Le Hub vient de basculer du provisioning automatique au signup vers un flow on-demand : `POST /api/tenants/start` côté Hub → `POST /api/tenants/provision` côté Prospection (HMAC `PROSPECTION_TENANT_API_SECRET`).

Le Hub court-circuite déjà côté DB si `prospection_provisioned_at` est set, mais en cas de désync ou de retry, l'endpoint Prospection peut être appelé pour un tenant déjà connu.

**Confirme que `POST /api/tenants/provision` est idempotent** :

- **Cas A — Email/tenant déjà connu** : retourne `created: false`, le même `tenant_id`, et un **nouveau `login_url` (token one-shot frais)** valide.
- **Cas B — Provision concurrente** : pas de duplicate dans la base (clé unique sur email ou tenant_id).
- **Cas C — Nouvelle création** : comportement actuel (`created: true`).

Aujourd'hui je ne sais pas quel est l'état réel — à vérifier dans le code de la route et confirmer (ou fixer + PR).

### 2. Nouvel endpoint `/api/tenants/update-plan` (P2)

Le Hub a maintenant un endpoint admin unifié `POST /api/admin/tenants/[id]/plan` qui pilote DB Hub + propage à Notifuse (`updatePlan()` HMAC). Pour **Prospection**, la propagation n'est pas câblée : le plan est stocké côté Hub seulement, avec un warning dans la response.

Pour fermer la boucle, Prospection doit exposer :

```
POST /api/tenants/update-plan
Headers:
  X-Veridian-Timestamp: <unix ms>
  X-Veridian-Signature: HMAC-SHA256(secret, `${tenant_id}:${plan}:${timestamp}`)
Body:
  {
    "tenant_id": "<prospection tenant id>",
    "plan": "freemium" | "starter" | "pro" | "enterprise"
  }
Response:
  200 { ok: true, tenant_id, plan, applied_at }
  400 si plan invalide
  401 si signature HMAC invalide / timestamp > 5min
  404 si tenant inconnu
```

**Plans supportés** : à aligner avec ce que tu utilises déjà côté Prospection. Si la liste diffère, donne-la-moi pour synchroniser côté Hub (`PROSPECTION_PLANS` dans `/api/admin/tenants/[id]/plan/route.ts`).

**Effet** : update du plan en base Prospection + reset éventuel des limites en cache si tu en as. Pas d'effet visuel côté user (le plan est appliqué à la prochaine action).

Côté Hub, je câblerai l'appel dans `route.ts:166` (TODO marqué dans le code) dès que l'endpoint Prospection sera dispo.

### 3. Bonus (nice-to-have, pas bloquant)

Endpoint **self-service** : `POST /api/auth/request-login-link { email }` qui regénère un login token + l'envoie par email. Aujourd'hui le seul moyen pour un user de récupérer un lien est de repasser par le Hub → `/api/prospection/regenerate-login` (auth user Hub). Si un user lifetime sans compte Hub actif veut accéder à Prospection direct, c'est bloqué.

## Tests E2E (côté Prospection)

Idempotence provision :
- POST provision { email: "a@x" } → `created: true`, login_url L1
- POST provision { email: "a@x" } (replay) → `created: false`, login_url L2 ≠ L1, même tenant_id

Update plan :
- Signature HMAC valide + plan valide → 200 + DB updated
- Signature invalide → 401
- Plan inconnu → 400
- Timestamp > 5min ancien → 401 (replay attack)

## Quand tu as répondu

Mets ta réponse en fin de ce fichier sous `## Réponse — YYYY-MM-DD`, puis déplace dans `done/` une fois mergé. Préviens Robert pour qu'il route le résultat vers l'agent Hub.

---

## Réponse — 2026-05-19

Ticket **superseded** par `todo/2026-05-19-hub-contract-conformity.md` qui couvre l'écart complet vs `CONTRAT-HUB.md` v1.2 (signé entre-temps le 2026-05-18 soir).

Mapping :
- **§1 idempotence provision** → Phase 1 du nouveau ticket (HMAC standardisé `{ts}.{body}` + revérif des Cas A/B/C en passant). Le ticket précise que la route a déjà l'idempotence côté code, à valider en test integration.
- **§2 update-plan endpoint** → Phase 2 item #4. Format HMAC final = standard contrat (`{timestamp}.{body}`) et non `tenant_id:plan:timestamp` proposé ici. Format normalisé pour cohérence cross-app (cf §6.1 du contrat).
- **§3 self-service request-login-link** → Phase 3 item #8 (`POST /api/workspaces/generateMagicLink` avec Bearer api_key, pas HMAC, qui couvre ce besoin de manière standardisée).

Déplacement en `done/` puisque le scope est repris à 100% dans le ticket d'aujourd'hui — pas de double-tracking.
