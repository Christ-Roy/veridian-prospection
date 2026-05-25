# Inbox global cross-prospects (W8c — Vague 8)

> **Sévérité** : 🟡 P1
> **Owner** : agent prospection (W8c)
> **Créé** : 2026-05-25
> **Livré** : 2026-05-25

## Contexte

Vague 8 — fiche prospect 360°. Trois agents en parallèle :
- W8a : timeline P2 mails sortants + P3 appels Telnyx
- W8b : IMAP réception cron 5 min
- W8c (ce ticket) : page `/inbox` global cross-prospects

But W8c : exposer toute la `lead_emails` du tenant sur une page unique avec
filtres rattaché/orphan et action "Rattacher à un prospect" pour les mails
orphelins (mails IMAP entrants sans correspondance SIREN automatique).

## Livré

### Backend

- `src/lib/queries/inbox.ts` (192 LOC) — helper de query Prisma
  - `listInboxEmails` : pagination cursor-based stable (sentAt desc, id desc),
    filtres direction (in/out/all) + status (attached/orphan/all), scope
    tenantId + workspaceFilter (admin → null, member → workspaces).
  - `attachInboxEmail` : RBAC cross-tenant + cross-workspace, vérif SIREN
    existe dans `entreprises`, last write wins, retourne previousSiren pour
    audit log.
  - `encodeCursor` / `decodeCursor` : base64url (`isoTimestamp|id`),
    fail-safe (input garbage → null, pas de throw).

- `src/app/api/inbox/route.ts` — GET liste paginée
  - `requireUser()` + `getWorkspaceFilter(auth.ctx)` (admin = null = vue
    tenant complète ; member = scope ses workspaces).
  - Rate-limit `inbox:<userId>` 120 req/min.
  - Allowlist stricte direction/status (fallback "all" sur garbage).

- `src/app/api/inbox/attach/route.ts` — POST attach
  - Validation Zod : `leadEmailId` uuid + `siren` regex `^\d{9}$`.
  - Rate-limit `inbox-attach:<userId>` 30 req/min.
  - Audit log `inbox.email_attached` avec `previousSiren` (compliance).
  - Mappe `forbidden` → 403, `not_found` / `siren_not_found` → 404.
  - Safe-parse `request.json().catch(() => ({}))` (pattern Veridian).

### Frontend

- `src/app/inbox/page.tsx` — page server-side `force-dynamic`
  - `requireUser()` + redirect `/login` si non-auth.
  - Wrapper `TrialGate` (consistance avec `/historique`, `/pipeline`).
  - Convertit `Date occurredAt` en ISO string pour le client component.

- `src/components/inbox/InboxList.tsx` — table avec data-testid riche
  - Icône direction (ArrowDownLeft incoming / ArrowUpRight outgoing).
  - Badge "Non rattaché" + bouton "Rattacher" pour orphans.
  - Lien `/leads/:siren` (dénomination entreprise) pour mails attachés.
  - Truncate subject 80 chars + preview 120 chars + fallback "(sans
    contenu)" et "(sans sujet)".
  - Bouton "Charger plus" qui préserve les search params filtres.

- `src/components/inbox/InboxFilters.tsx` — URL params reset cursor
  - 3 boutons direction (Tous / Reçus / Envoyés).
  - 3 boutons status (Tout / Rattachés / Non rattachés).
  - Reset `cursor` à chaque changement (évite cursor invalide).
  - Clean URL : `direction=all` / `status=all` → params absents.

- `src/components/inbox/AttachProspectModal.tsx` — recherche live + attach
  - Debounce 250ms via clearTimeout dans cleanup.
  - Min 2 chars pour déclencher `/api/leads?f_search=…`.
  - Filtre candidats sur regex SIREN (9 chiffres) avant affichage.
  - Toast success/error via `sonner`, `router.refresh()` post-succès.

- `src/components/layout/app-nav.tsx` — entrée nav `Inbox` (icône lucide
  `Inbox`) ajoutée entre `/pipeline` et `/historique`.

### Tests

- `src/lib/queries/inbox.test.ts` (23 tests) — Vitest, mocks Prisma
  - Cursor encode/decode roundtrip + invalid input → null.
  - RBAC scope tenantId + workspaceFilter (admin vs member).
  - Filtres direction/status avec fallback "all" sur garbage.
  - hasMore + nextCursor pagination.
  - Enrichissement entrepriseName (findMany sirens en batch).
  - Preview fallback bodyText → bodyHtml stripped → null.
  - attachInboxEmail : happy / not_found / forbidden (cross-tenant +
    cross-workspace) / siren_not_found / re-attach (last write wins).

- `src/app/api/inbox/inbox-rbac.test.ts` (23 tests) — source-level pattern
  Veridian (cf pipeline-stages-rbac.test.ts) :
  - requireUser, 401 sur error, getWorkspaceFilter, scope tenantId.
  - Zod validation (uuid + regex SIREN), 400 sur invalid.
  - Mapping codes erreur, audit log, rate-limit, safe-parse JSON.

- `src/components/inbox/inbox-list.test.ts` (28 tests) — source-level
  (pas de @testing-library dans le repo) :
  - data-testid pour E2E, fallbacks UI, lien conditionnel /leads/:siren,
  - modal montée seulement orphan, truncate subject/preview, reset cursor,
  - debounce search, POST attach JSON, toast.

- `e2e/staging-full/inbox-global.spec.ts` (12 specs) — hard-core headfull
  staging :
  - 01. Happy path 5 mails (3 out + 2 in) + filter orphan
  - 02. Attach orphan → page reload → lien /leads/:siren
  - 03. État vide → bannière "Aucun mail"
  - 04. Cursor invalide ignoré silencieusement (pas de 500)
  - 05. Direction inconnu fallback "all"
  - 06. RBAC non-auth → redirect /login
  - 07. RBAC API non-auth GET → 401
  - 08. RBAC API attach cross-tenant → 403/404
  - 09. Attach SIREN inexistant → 404
  - 10. Concurrence 2 attach → last write wins
  - 11. Pollution subject 500 chars + body null → truncate + "(sans contenu)"
  - 12. Filtre status=attached strict

### Coverage map

`test-coverage-map.yaml` : 3 entrées ajoutées pour déclarer la couverture
non-canonique (tests colocalisés + source-level), pattern accepté par
`check-test-mapping.sh`.

## Périmètre respecté

- ❌ Pas touché : `src/lib/queries/timeline.ts` (W8a)
- ❌ Pas touché : `src/app/api/leads/[siren]/timeline/` (W8a)
- ❌ Pas touché : `src/components/leads/history-tab.tsx` (W8a)
- ❌ Pas touché : `src/lib/mail/imap-client.ts` (W8b)
- ❌ Pas touché : `src/app/api/cron/imap-sync/` (W8b)
- ❌ Pas touché : migration 0027 (W8b)
- ❌ Pas touché : `src/components/settings/ImapConfigTab.tsx` (W8b)
- ❌ Pas touché : `src/app/api/mail/imap-config/` (W8b)

## Risk classification

`[risk:medium]` — pas de migration DB, mais 2 nouvelles routes API
(`/api/inbox`, `/api/inbox/attach`) + 1 nouvelle page UI + ajout
navigation. Pas d'auth refactor, pas de schéma Prisma touché. Pas en tier
🔴 HAUT (qui exigerait E2E headfull 100% pre-promo).

## Suite naturelle

- L'audit log `inbox.email_attached` permettra de remonter qui a rattaché
  quoi quand (futur dashboard analytics).
- Quand W8b livre l'IMAP, les mails entrants sans match SIREN automatique
  remplissent la file "Non rattachés" → cette page est l'UI de cleanup.
- Possible v2 : action "Détacher" (remettre siren=null) si rattachement
  erroné.
