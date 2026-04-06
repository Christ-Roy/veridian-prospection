# Security Debt — Prospection Dashboard

> Source de vérité pour la dette technique sécu. Édité à la main après
> chaque passage sur les artifacts générés par `.github/workflows/security.yml`.
> Triage mensuel : lead CI/CD trie les findings par risque et assigne des
> tâches de fix dans TaskCreate.

## Workflow de mise à jour

1. Télécharger les artifacts `npm-audit-report`, `semgrep-report`, `trivy-report` depuis le dernier run du workflow Security
2. Lire les findings → décider pour chacun : `fix now` / `fix later` / `accept` / `false positive`
3. Éditer ce fichier pour refléter la décision
4. Créer une `TaskCreate` dans la team courante pour chaque `fix now` / `fix later`

## Légende

- 🔴 **Critical** — exploitable à distance, fix immédiat obligatoire
- 🟠 **High** — fix dans la semaine
- 🟡 **Moderate** — fix dans le mois si simple, sinon backlog
- 🟢 **Low / info** — backlog, reviewed périodiquement
- ✅ **Fixed** — déplacé vers l'historique en bas de fichier

## État au 2026-04-05 — premier scan (run 24010355009)

Workflow `security.yml` run #24010355009 terminé en 1m09s. 4 jobs verts (non-bloquant).
Annotations GitHub : `npm-audit: critical=1 high=4 moderate=0`.

### 🔴 CRITICAL — `next` 15.3.3 → 15.5.14

**2 CVEs Next.js** actives sur la version déployée :
- **Cache Key Confusion for Image Optimization API Routes**
- **Content Injection Vulnerability for Image Optimization**

**Impact staging/prod** : les 2 touchent `/_next/image` (optimisation d'images).
Le dashboard Prospection utilise très peu `next/image`, surface d'attaque
limitée mais existante.

**Fix** : `npm install next@15.5.14` (bump minor, non-breaking).
**Priorité** : à faire demain matin AVANT la démo commerciale si fenêtre safe,
sinon post-démo (risque rebuild CI pré-démo non désiré).

### 🟠 HIGH × 4 — cascade Prisma → @prisma/config → effect → defu

Toutes dans la même chaîne de deps, fix par un seul `npm update prisma @prisma/client` :
- `defu` : prototype pollution via `__proto__` key in defaults
- `effect` : AsyncLocalStorage context lost/contaminated sous charge concurrente RPC
- `@prisma/config` : dépend de `effect`
- `prisma` : dépend de `@prisma/config`

**Impact** : prototype pollution rare à exploiter dans notre contexte,
race conditions Effect théoriques vu notre usage simple de Prisma.
Pas critique immédiatement mais à trier dans la semaine.

**Fix** : `cd dashboard && npm update prisma @prisma/client && npm test`

### 🟡 Moderate × 0

### Bugs workflow security.yml identifiés au premier run

- **semgrep** : artifacts `/tmp/semgrep.sarif` not found — le container semgrep
  écrit ailleurs que `/tmp/`. Fix dans `.github/workflows/security.yml` step semgrep.
- **gitleaks** : `git exit 128` — fetch-depth:0 ou permissions. À investiguer.
- **trivy-fs** : ✓ artifact uploadé. À lire post-démo.

## Second scan (run 24010581974, après fix commit 7c36988)

Fix des bugs workflow semgrep + gitleaks appliqué dans `7c36988`. Tous les
4 jobs passent désormais **verts** avec artifacts uploadés.

### ✅ Semgrep — 0 findings

6 rulesets lancés sur `dashboard/src`:
`p/owasp-top-ten`, `p/javascript`, `p/typescript`, `p/react`, `p/nextjs`, `p/secrets`.

**Résultat** : **0 findings**. Le code source ne déclenche aucune règle OWASP
Top 10, pas de pattern XSS / SQL injection / secret hardcodé / bypass auth
détectable statiquement. Excellent baseline pour une review propre.

### ✅ Gitleaks — 0 vrai secret, 15 false positives

15 findings, **tous false positives** :

- **5× JWT Supabase** (`jwt` rule) dans `.env.production`, `e2e/saas-flow.spec.ts`,
  `e2e/existing-accounts.spec.ts`. Ce sont les **anon keys Supabase staging**
  publiques par design (JWT signé avec claim `role: anon`, lisible par le
  frontend). Ne PAS rotater — c'est la même clé que `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  exposée dans le bundle client.

- **10× linkedin-client-id/secret** (`linkedin-client-id`, `linkedin-client-secret`
  rules) dans `dashboard/src/generated/prisma/{index-browser,edge,wasm}.js`.
  Faux positifs : ce sont des **strings littérales dans le code généré Prisma**
  qui ressemblent à des client IDs LinkedIn mais n'en sont pas. Pas d'intégration
  LinkedIn dans le projet côté dashboard.

**Action** : ajouter ces paths à un `.gitleaksignore` (ou `--config` custom) si
on veut un rapport propre. Pour l'instant tolérable (15 lignes, pas de risque réel).

### ✅ Trivy-fs — (à lire depuis l'artifact)

Run vert, SARIF uploadé. Pas encore triagé. TaskCreate de triage post-démo.

### ✅ npm-audit — identique au run précédent

critical=1 (next 15.3.3), high=4 (cascade prisma/effect/defu). Pas de nouveau
finding depuis le précédent scan. Les plans de fix documentés au-dessus restent
valides.

### Surface d'attaque identifiée pendant la session

1. **`/api/tenants/provision`** — bearer token `staging-prospection-secret-2026` en dur dans le code et committé dans ce markdown (!) Le secret doit être rotaté en prod, et en staging c'est **déjà exposé** dans plusieurs commits. Accepté pour l'instant (staging = environnement de dev, pas de données utilisateur réelles), à rotater AVANT go live prod.

2. **`/api/admin/*` ADMIN_EMAILS** — whitelist hardcodée `['brunon5robert@gmail.com']` dans chaque route (Hub). À terme, déplacer dans une table `platform_admins` Supabase pour éviter que la liste soit baked at build time.

3. **`/api/invitations/[token]/accept`** — POST public qui crée un user Supabase. Rate limit 10/min par IP (via `lib/rate-limit.ts`) — vérifier que c'est suffisant contre un bruteforce de tokens. Token = 32 bytes hex → 256 bits entropie, difficile à deviner mais pas impossible si la table est énorme.

4. **`/api/errors`** — POST public sans auth, ring buffer in-memory 1000 entries. Rate limit 20/min par IP. Un attaquant peut flood le buffer (DoS log), mais pas d'impact data. À surveiller.

5. **Cookie Supabase `sb-*-auth-token`** — stocké en localStorage + cookie. Le cookie est `httpOnly: false` parce que `@supabase/ssr` a besoin d'y accéder depuis le client. Vulnérable XSS si on introduit une injection HTML. Semgrep `p/react` doit catch ça.

6. **Prisma `$queryRawUnsafe`** — utilisé dans `src/lib/queries/*.ts`. Les params sont toujours passés en `$1, $2, ...` avec liste d'args, donc pas de SQL injection tant que personne ne concatène une string user-input dans le SQL brut. Semgrep `p/javascript` détecte normalement ces patterns.

7. **`TENANT_API_SECRET`** partagé entre Hub et Prospection en HMAC — bon pattern, mais la clé est la même pour tous les tenants. Une rotation = tout casser. Accepté V1.

## Historique (findings résolus)

_(vide pour l'instant)_

## Todo triage

- [ ] Premier run du workflow Security le 2026-04-06 matin
- [ ] Analyse des findings
- [ ] Création de tâches fix dans la team
- [ ] Rotation du `TENANT_API_SECRET` staging (non urgent, noté)
- [ ] Migration `ADMIN_EMAILS` → `platform_admins` table (post-démo)
