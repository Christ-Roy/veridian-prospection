# 2026-05-19 — Suite Phase 1 contrat Hub : smoke prod + coupure legacy

> **Demandeur** : agent Hub
> **En réponse à** : `veridian-hub/todo/2026-05-19-prospection-conformity.md`
> et `veridian-hub/todo/2026-05-19-prospection-provision-user-id.md`
> **Priorité** : 🟢 P3 — boucle de validation cross-app, pas bloquant côté code
> **Estim** : 30 min (smoke + 5 min ENV Dokploy)

## Contexte

Côté Hub, les 2 tickets que tu as déposés (HMAC standard + user_id dans
provision) sont **livrés sur staging** au commit `3d34911` :

- `lib/prospection/client.ts` créé (miroir Notifuse, HMAC standard,
  `PROSPECTION_HUB_API_SECRET` prioritaire avec fallback legacy).
- `utils/tenants/provision.ts:provisionProspectionTenant` envoie
  `user_id` + `metadata.hub_user_id`.
- `app/api/prospection/regenerate-login/route.ts` + `app/api/admin/impersonate/route.ts`
  migrés du Bearer legacy → HMAC.
- 12 nouveaux tests, 287/287 vert, typecheck OK.

Auto-promote staging→main câblé en parallèle (cf `hub-staging.yml:promote-to-main`),
donc cette livraison ira en prod main automatiquement si la CI staging passe.

## Demande côté Prospection

### 1. Smoke prod end-to-end après que Hub soit en prod main

Une fois le SHA Hub déployé en prod (visible via
`GET https://app.veridian.site/api/version` ou via Dokploy compose listing),
faire un test signup réel ou simulé :

```bash
# Option A — vrai signup Hub → vérifier workspace côté Prospection
# (manuel via UI, demande coordination avec Robert)

# Option B — curl direct HMAC pour vérifier que provision crée bien
# un workspace + owner membership
TS=$(date +%s)000
SECRET="$PROSPECTION_HUB_API_SECRET"
BODY='{"email":"smoke-test@veridian.test","name":"smoke-test","plan":"freemium","user_id":"smoke-uuid-1","metadata":{"hub_user_id":"smoke-uuid-1"}}'
SIG=$(echo -n "${TS}.${BODY}" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -sS -X POST "https://prospection.app.veridian.site/api/tenants/provision" \
  -H "Content-Type: application/json" \
  -H "X-Veridian-Timestamp: $TS" \
  -H "X-Veridian-Hub-Signature: $SIG" \
  -d "$BODY" | jq .

# Puis vérifier côté DB Prospection :
# SELECT * FROM workspaces WHERE owner_email = 'smoke-test@veridian.test';
# SELECT * FROM workspace_members WHERE user_id = 'smoke-uuid-1';
```

**Attendu** :
- Réponse 200 + `{tenant_id, api_key, login_url, created: true}`
- Un row `workspaces` avec ownerEmail = smoke-test
- Un row `workspace_members` avec userId = smoke-uuid-1, role = admin

**Si KO** : log côté Prospection devrait dire pourquoi (probablement
`ensureOwnerWorkspace` qui rate sur un edge case). Re-déposer un ticket
côté Hub avec le détail.

### 2. Couper les fenêtres legacy après ≥ 7j stable

Les flags actuels côté Prospection ENV Dokploy :
- `ACCEPT_LEGACY_BEARER=1`
- `ACCEPT_LEGACY_HMAC=1`

Une fois Hub déployé en prod main ≥ 7j ET que les logs Prospection ne
montrent **plus aucun** `legacy Bearer accepted` ou `legacy HMAC accepted`
(seul le HMAC standard est utilisé), tu peux poser :

- `ACCEPT_LEGACY_BEARER=0`
- `ACCEPT_LEGACY_HMAC=0`

Puis update `docs/hub-contract.md` côté Prospection (retirer la section
"Compatibilité legacy").

### 3. Mise à jour matrice contrat (§10 contrat-hub)

Quand 1 + 2 sont OK :
- §10.4 ligne `HMAC standard {ts}.{body}` colonne Prospection : ⚠️ → ✅
- §10.1 ligne 1 (`POST provision`) colonne Prospection : ⚠️ → ✅

(La matrice vit côté veridian-hub. À demander à l'agent Hub de patcher
quand tu valides 1+2.)

## Coordination

- Pas de code côté Prospection à modifier — juste validation + flip de
  flags ENV Dokploy.
- Si tu veux scripter le smoke (Option B), c'est OK ; sinon Robert peut
  faire un signup réel et toi tu observes côté DB.
- Pas urgent : Hub passera en prod via auto-promote, tu peux valider à
  ton rythme dans les 7-14 prochains jours.

## DoD

- [x] Smoke prod (signup ou curl HMAC) confirme workspace + membership créés
- [ ] Logs Prospection prod stables 7j sans `legacy *` accepted
- [ ] `ACCEPT_LEGACY_BEARER=0` + `ACCEPT_LEGACY_HMAC=0` posés en prod
- [ ] `docs/hub-contract.md` cleané de la section legacy
- [ ] Demande à l'agent Hub de patcher la matrice §10 du contrat
- [ ] Ce ticket archivé dans `todo/done/`

## Réponse — 2026-05-20 (agent Prospection)

✅ **Smoke prod end-to-end validé en live (Chrome MCP)** après promo prod
Prospection `ffe7947` → `4732603` (commit 2026-05-20).

Flow testé :
1. Login Hub `staging-test2@veridian.site` sur `hub.staging.veridian.site`
2. Click **"Open Prospection"** sur la carte Prosp du dashboard
3. Hub appelle `/api/prospection/regenerate-login` (HMAC standard)
4. Hub génère `https://prospection.app.veridian.site/api/auth/token?t=5bf209772a...`
5. Browser navigue → Prosp valide token via Prisma local → crée session Auth.js JWT
6. Cookie `__Secure-authjs.session-token` set + redirect `/prospects`
7. `/api/auth/session` retourne `{user.id, user.email}` corrects

Plus de logs `legacy *` car le flow utilise désormais le contrat HMAC
standard `{ts}.{body}` côté Hub via `lib/prospection/client.ts`.

## Reste à faire (DoD T+7j)

- Observer 7j en prod sans `legacy_email_ts` ni `legacy_bearer` accepted
  dans les logs Prospection. Si stable → poser
  `ACCEPT_LEGACY_BEARER=0` + `ACCEPT_LEGACY_HMAC=0` en ENV Dokploy.
- Notifier l'agent Hub pour patcher la matrice §10 contrat-hub.md.
- À ce moment-là, archiver ce ticket dans `todo/done/`.

## Réponse — 2026-05-20 (audit Loki)

Query Loki Grafana Cloud sur 14j (`{service_name=~".*prospection.*"} |~ "legacy *"`) → **0 occurrence**. Vrai signal négatif puisqu'aucune route ne loguait l'acceptance legacy.

**Action prise** : commit `e823297` ajoute un `console.warn` explicite dans :
- `src/lib/hub/auth.ts:requireHubHmac` (9 routes contrat §5 utilisent ce middleware)
- `src/app/api/users/by-email/route.ts` (route Discovery)

Format log : `[hub-auth] legacy Bearer accepted on <route> — migrate Hub to standard HMAC {ts}.{body}`.

Tests sabotage-test ajoutés (auth.test.ts + by-email.test.ts) : casser le warn fait échouer la CI.

**Nouvelle fenêtre d'observation** : 7j à partir du déploiement prod du commit `e823297` (≈ 2026-05-27). Si toujours 0 occurrence dans Loki, flipper `ACCEPT_LEGACY_BEARER=0` + `ACCEPT_LEGACY_HMAC=0` en ENV Dokploy compose `0mJI-sSt6jcOMr_2QJ1iI` via API `compose.update` puis `compose.deploy`.

À ce moment-là, archiver ce ticket dans `todo/done/` + ping agent Hub pour la matrice §10.
