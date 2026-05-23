# [PROSPECTION] Trous coverage E2E — scénarios entiers cross-app manquants

> **Type** : Dette tests / qualité
> **Sévérité** : 🟡 P1 — l'incident invitations 2026-05-22 (Supabase mort,
>   /api/invitations/[token]/accept cassé en silence) est passé en prod
>   parce que AUCUN test ne couvrait le flow invitation end-to-end. Nos
>   tests unitaires Vitest valident des bouts en isolation. Aucun ne joue
>   un scénario utilisateur réel.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Découvert par** : Robert (suite hotfix 2026-05-23)

## Constat

Sprint 2026-05-22 a livré 152 tests Vitest unitaires + 77 tests src/.
**Tous les tests passaient, et pourtant deux bugs majeurs sont arrivés
en prod** :

1. **Invitations cassées** : `src/lib/invitations.ts` appelait toujours
   `/auth/v1/admin/generate_link` et `/auth/v1/admin/users` de Supabase
   GoTrue (mort depuis la migration Auth.js v5). Tout admin qui tente
   d'inviter un membre = erreur 500 ou crash silencieux.

2. **Pas de logout côté Prospection** : un user arrivé via token Hub
   (Open Prospection) ne pouvait pas se logger sur un autre compte —
   aucun bouton signOut visible dans la nav ni sur /login. Bloque cas
   démo, machine partagée, switch de compte multi-tenant.

**Pourquoi nos tests ne l'ont pas vu** :

- `invitations.test.ts` (avant hotfix) mockait fetch Supabase et
  testait que le helper *appelait* l'endpoint Supabase — il ne vérifiait
  PAS que cet endpoint existait, ni qu'un user était réellement créé en
  DB. Le mock validait un appel API mort.
- Aucun test n'instanciait `<AppNav>` côté React pour vérifier qu'un
  bouton de signOut était visible quand `useSession()` retourne un user.
  Le composant n'importait même pas `SessionProvider` — `useSession()`
  aurait retourné undefined si on l'avait câblé naïvement.
- Le crawler E2E `dashboard-crawler.spec.ts` est CASSÉ depuis 2026-05-22
  (cf `todo/2026-05-22-fix-crawler-database-url-staging-ci.md` —
  `DATABASE_URL` manquante en CI). Donc même les pages dashboard ne sont
  pas vraiment auditées en E2E.

## Demande

Câbler une vraie **batterie E2E "happy path + scénarios cross-app"** qui
exerce des FLOWS entiers, contre la DB staging réelle. Pas des unit tests
DOM, pas des mocks API. Du Playwright qui ouvre Chrome, clique, navigue,
et vérifie ce que l'utilisateur voit.

### Flows minimum à couvrir

1. **Invitation cross-app complète**
   - Admin loggué crée une invitation pour `new@test.local` via UI admin
   - Visite l'URL `/invite/{token}`, voit l'écran d'acceptation
   - Renseigne password, accepte
   - Est automatiquement loggué et atterrit sur `/prospects`
   - `/api/auth/session` retourne le bon user
   - **Anti-régression directe du bug 2026-05-23**

2. **Login Hub → Prospection (autologin)**
   - Génère un token via `POST /api/tenants/provision` (HMAC) avec un
     `user_id` Hub donné
   - Ouvre `GET /api/auth/token?t={token}` dans le browser
   - Vérifie redirect `/prospects` + session active

3. **Switch de compte / logout**
   - Loggué en tant que Alice via Hub token
   - Visite `/login` → voit le bandeau "Connecté en tant que alice@…"
   - Clique "Changer de compte" → session vidée
   - Login en tant que bob via le form Credentials
   - Vérifie session = bob

4. **Provision Hub → Prospection (HMAC)**
   - POST `/api/tenants/provision` body conforme contrat
   - Vérifie User + Tenant + Workspace + WorkspaceMember(admin) créés
   - Le `login_url` retourné mène à une session valide

5. **Welcome leads grant (Hub → Prospection)**
   - POST `/api/tenants/[id]/credit-leads` `source=welcome welcome_plan=freemium`
   - Vérifie crédit +100 sur le quota du workspace
   - REJOUE le même call → 200 no-op (anti-double-grant par palier)
   - Upgrade plan → re-call `source=welcome welcome_plan=pro` → +1900

6. **Login Credentials direct (form /login)**
   - User existant + mot de passe → form `/login` → session active

7. **Pages dashboard core sans erreur visible ni console**
   - Charge `/prospects`, `/pipeline`, `/historique`, `/settings`,
     `/admin/members`, `/admin/invitations`, `/admin/workspaces`
   - Aucun toast d'erreur, aucun `Error` en console
   - C'est ce que tente de faire `dashboard-crawler.spec.ts` aujourd'hui
     — mais cassé (cf ticket associé)

### Comment exécuter ces tests

Pattern déjà éprouvé par `e2e-fix` (hotfix 2026-05-22 sur `e2e/helpers/auth.ts`) :
- Container Playwright sur dev-pub sur le réseau `staging-edge`
- Cible le hot reload (`http://ui-dev:3100`) avec la DB staging réelle
- Cleanup des données de test après chaque spec (delete user + invitation)
- Lancé en CI staging post-deploy (refactor du job crawler — cf ticket
  `2026-05-22-fix-crawler-database-url-staging-ci.md`)

### Métrique de succès

- Casser volontairement un des 7 flows → le test correspondant doit
  rougir. Si on casse `acceptInvitation` (revient à Supabase, ou plante
  sur upsert), le flow 1 doit échouer dans les 30s.
- Aucun mock fetch Supabase ou interface morte. Si une API est morte,
  les tests le voient.

## Stratégie

C'est un chantier — pas une session. À découper :

- **Sprint A — refactor crawler post-deploy** (1-2h) — câbler crawler
  Playwright dans container dev-pub avec accès DB. Débloque CI staging
  pour les flows 7 (déjà sous forme de spec).
- **Sprint B — flows 1+2+3** (1 jour) — les flows que cet hotfix a
  exposés. Anti-régression directe.
- **Sprint C — flows 4+5+6** (1 jour) — cross-app provision/billing/login
  Credentials. Couvre le contrat Hub.

À planifier dans le backlog quand la prod est de nouveau stable.

## Référence

- Hotfix 2026-05-23 qui a révélé les trous : commit (à venir)
- Ticket crawler CI : `todo/2026-05-22-fix-crawler-database-url-staging-ci.md`
- Pattern helper E2E Auth.js v5 (à réutiliser) : `e2e/helpers/auth.ts`
  (commit `ce5b56f`)
