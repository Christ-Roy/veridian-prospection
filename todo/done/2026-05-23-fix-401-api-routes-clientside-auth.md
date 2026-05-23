# [PROSPECTION] Bug — /api/me /api/trial /api/settings renvoient 401 client-side avec session Auth.js v5 valide

> **Type** : Bug fonctionnel
> **Sévérité** : 🟡 P1 — la session Auth.js v5 est valide (cookie posé,
>   `/api/auth/session` retourne le user), mais 3 routes API client-side
>   refusent l'auth sur TOUTES les pages dashboard. Le dashboard fonctionne
>   visuellement (les server components ont la session via `auth()`), mais
>   chaque page logue 3 console.error 401 → bruit + features client cassées
>   (trial banner, settings, user info refresh).
> **Owner** : agent Prospection
> **Créé** : 2026-05-23

## Découvert par

Le dashboard crawler post-deploy staging, **après** fix du câblage CI
(ticket `2026-05-22-fix-crawler-database-url-staging-ci.md`). Avant ce fix,
le helper E2E `skip()` silencieusement → ces 401 étaient masqués. Après
fix : crawler ROUGE explicitement sur toutes les pages, message
`"Failed to load resource: the server responded with a status of 401"`
répété 3 fois par page.

## Reproduction

```bash
# Container Playwright sur dev-pub (réseau staging-edge), session Auth.js OK,
# session valide vérifiée via /api/auth/session retournant le user complet :
session = {"user":{"id":"e2e0e2e0-...","email":"e2e-persistent@yopmail.com"}}

# MAIS les XHR client-side retournent 401 :
GET https://prospection.staging.veridian.site/api/me        → 401
GET https://prospection.staging.veridian.site/api/trial     → 401
GET https://prospection.staging.veridian.site/api/settings  → 401
```

Cohérent et reproductible sur les 7 pages dashboard (Prospects, Pipeline,
Historique, Settings, Admin Members, Admin Invitations, Admin Workspaces).

## Hypothèse

Ces 3 routes API utilisent probablement encore le middleware
`createClient()` Supabase ou attendent un header `Authorization: Bearer
<jwt>` Supabase, là où le reste du code a migré vers Auth.js v5
(`auth()` côté server, cookie `__Secure-authjs.session-token`). Les
appels XHR client envoient bien le cookie Auth.js (SameSite Lax), mais
le handler API le rejette parce qu'il cherche autre chose.

À grep dans `src/app/api/me/`, `src/app/api/trial/`, `src/app/api/settings/` :
- Présence de `createClient()` Supabase ou `getServerSession()` legacy ?
- Comparaison avec une route qui marche (ex: `/api/prospects`) pour voir
  le pattern d'auth attendu.

## DoD

- [ ] `/api/me`, `/api/trial`, `/api/settings` reconnaissent une session
  Auth.js v5 valide et retournent 200 avec data attendue.
- [ ] Dashboard crawler vert end-to-end (les 7 pages, 0 console.error 401).
- [ ] Si d'autres routes API ont le même problème (à grep), même fix
  appliqué.
- [ ] Audit éventuel : lister toutes les routes API qui utilisent encore
  le pattern legacy → ticket dédié de finalisation migration.

## Pas P0 parce que

- Le crawler reste rouge sur ce step, mais c'est **un vrai rouge**
  (signal exact d'un bug), pas un faux rouge comme avant. C'est
  exactement ce que la migration helper voulait atteindre.
- Les pages dashboard **fonctionnent visuellement** (les server components
  ont la session via `auth()` direct). Seul le client perd les data de
  ces 3 routes.
- L'app prod (`prospection.app.veridian.site`) a été promue récemment
  avec le même code — donc le bug existe **aussi en prod**, mais reste
  silencieux côté UX (les composants client doivent fallback ou se taire).

## Lien

- Ticket fix CI crawler : `done/2026-05-22-fix-crawler-database-url-staging-ci.md`
  (à archiver après merge du workflow)
- Helper qui révèle le bug : `e2e/helpers/auth.ts` (commit `ce5b56f`)
- Spec qui le détecte : `e2e/dashboard-crawler.spec.ts`
