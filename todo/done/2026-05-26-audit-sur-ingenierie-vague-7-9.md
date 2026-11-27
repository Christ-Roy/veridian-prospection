# [AUDIT] Sur-ingénierie Vagues 7-9 (sessions 2026-05-25/26)

> **Type** : Audit honnête post-sprint
> **Sévérité** : 🔴 P0 — décisions de revert/simplification à prendre avant que la dette ne s'incruste
> **Owner** : Robert (décision business) + agent Prospection (exécution)
> **Créé** : 2026-05-26
> **Demandeur** : Robert (a flagué F = overkill, craint que ce soit symptomatique du reste)
> **Auditeur** : agent Opus audit-sur-ingenierie

---

## TL;DR

Sur 12 commits, **3 features sont franchement overkill** (F, W7b ICP, W9d Palier 2 OAuth PKCE),
**3 sont tier MOYEN à simplifier** (W7a, W9c-A templates, W9c-J signature),
**6 sont légitimes ou utiles** (W8a, W8b, W8c, W9a, W9b, fixes).

**Verdict global** : 🟢 **6 KEEP** / 🟡 **3 SIMPLIFY** / 🔴 **3 REVERT**.

**Effort total simplify/revert** : ~3 jours-humain (1 jour revert F + 1 jour simplify W7b + 0,5 jour OAuth PKCE + 0,5 jour autres).

**Pattern récurrent identifié** : les agents Opus, sans cadre business strict, ajoutent
systématiquement la couche "production-ready scale" (queue, OAuth, multi-tenant
templates) quand le besoin réel est "1 user solo qui valide le marché". Robert
doit pousser les futurs sprints avec consigne explicite **"ship 1 user, pas 1000"**
et **"BYO clé / config simple, jamais d'OAuth flow tant que pas 10 users payants"**.

---

## Méthode

Pour chaque feature : (1) ce qui a été livré (2) la comparaison concurrents (3)
utile MAINTENANT pour Robert (solo, 0 client payant Prospection, vise consulting CRM)
(4) verdict + proposition concrète.

Critère "sur-ingénierie" appliqué : worker/queue/cron là où sync suffit, méta-modèles
prématurés, OAuth flow là où BYO clé suffit, abstractions "scale-ready" sans client,
UI riche là où form 1-page passait.

---

## 1. W7a — Mail v2 Hub Gateway (`ac3e62f`)

**Périmètre** : envoi mail via Gmail OAuth user, route `/api/mail/send` branche sur
`workspace.mail_provider` (gmail-via-hub vs SMTP BYO), HMAC vers Hub, UI sending-account.
**11 fichiers, 2378 LOC, migration 0025**.

1. **Livré** : abstraction provider sur table workspace, HMAC client Hub, settings page,
   59 tests + 15 E2E specs. Gros chantier multi-couche.
2. **Concurrents** : Apollo/Lemlist/Instantly proposent Gmail OAuth direct ou bien
   SMTP BYO. Aucun ne réimplémente une "Hub Gateway" en interne — c'est leur backend
   propre. Twenty CRM = SMTP user direct.
3. **Utile MAINTENANT ?** **Oui pour le principe** (différenciateur "from = email user"
   = vrai pour la délivrabilité B2B), **mais la couche d'abstraction multi-provider
   est prématurée** : 1 seul provider est câblé (gmail-via-hub), le routing
   conditionnel + table mail_provider sont une couche pour rien tant qu'il n'y a pas
   2+ providers.
4. **Verdict** : 🟡 **SIMPLIFY** — garder l'envoi via Hub (la valeur produit est
   réelle), mais supprimer la couche d'abstraction `workspace.mail_provider`. Quand
   le user a connecté Gmail dans Hub → Prosp envoie via Hub. Sinon → SMTP. Pas de
   colonne enum, pas de toggle UI, pas de 4 modes de réponse (412/422/502/503).
   Mapping erreur direct : 2xx ok, sinon afficher l'erreur Hub. **Effort simplify : 0,5 j.**

---

## 2. W7b — Refill ICP page native `/leads/buy` (`ffe0404`)

**Périmètre** : page configurateur ICP avec 9 composants (Sector / Geo / Employee /
Revenue / Age / Qualifier sliders + LiveCount + OrderSummary + RefillIcpClient),
migration 0026 `lead_orders` (table dédiée + filters_json), route estimate-count,
route refill/start, HMAC checkout Hub. **26 fichiers, 4270 LOC**.

1. **Livré** : 1207 LOC de composants UI, 431 LOC `filters.ts` (Zod + SQL builder
   paramétré + 5 catalogues figés), nouvelle table `lead_orders` qui DOUBLE
   `lead_credit_events` (déjà existante), 119 tests + 16 E2E.
2. **Concurrents** : Apollo a un "search & buy" inline (chercher → cocher → checkout)
   pas un configurateur slider à 9 dimensions. Cognism = filters list dans search,
   download list ensuite. **Aucun n'a un "configurateur ICP" séparé du search.**
3. **Utile MAINTENANT ?** **Non** — la page Hub `/dashboard/refill-leads` existante
   (130 LOC, 1 form) faisait déjà la job (qty → checkout). La page native ICP ajoute
   8 dimensions de filtrage UI alors que **0 client payant Prospection** existe et
   que **Robert lui-même n'a jamais utilisé cette UI pour acheter ses propres leads**.
   La table `lead_orders` duplique `lead_credit_events` pour stocker `filters_json`
   qui ne sert à rien tant qu'il n'y a pas de re-livraison.
4. **Verdict** : 🔴 **REVERT** (ou simplify drastique). Proposition :
   - **Option A (revert complet)** : `git revert ffe0404` + supprimer migration 0026.
     L'user retombe sur le bouton "Acheter des leads" → redirect Hub. **2h.**
   - **Option B (simplify)** : garder `/leads/buy` mais 1 seul slider (quantité),
     pas de configurateur ICP, pas de live count, pas de `lead_orders`. Réutilise
     `lead_credit_events.source='purchase'`. ~150 LOC au total. **1 j.**

   **Reco : Option B** si Robert tient à l'UX native (« le user reste dans Prosp »),
   sinon Option A. Dans les 2 cas on supprime les 9 composants ICP + filters.ts + lead_orders.

---

## 3. W8a — Timeline P2 mails sortants + P3 appels Telnyx (`cc6a4c4`)

**Périmètre** : étend `/api/leads/[siren]/timeline` avec `mail_out` + `call`,
UI history-tab affiche subject/preview/durée/recordingPath. **Petite extension
sans nouvelle table.**

1. **Livré** : merge dans la requête timeline existante. ~37 tests ajoutés.
2. **Concurrents** : timeline 360° = standard Twenty/Pipedrive/HubSpot. C'est la
   base de toute fiche prospect CRM.
3. **Utile MAINTENANT ?** **Oui clairement** — c'est l'extension naturelle de la
   Phase 1 livrée, ça donne du sens à la table `lead_emails` qui existait déjà,
   et c'est ce que tout commercial attend de voir.
4. **Verdict** : 🟢 **KEEP** — extension légitime, pas de table neuve, pas
   d'abstraction. Bien fait.

---

## 4. W8b — IMAP réception cron 5 min (`b2faf67`)

**Périmètre** : migration 0027 (colonnes IMAP sur tenant_mail_config), wrapper
imapflow, route cron `/api/cron/imap-sync` (Bearer), UI onglet IMAP, matching
prospect par best_email_normalized. **~1500 LOC**.

1. **Livré** : décision Robert documentée d'éviter BullMQ worker → cron 5 min
   systemd. L'agent a explicitement renoncé à la sur-ingé infra. Match prospect
   par email normalisé (intelligent, pas de doublon avec messageId UNIQUE).
2. **Concurrents** : Twenty CRM = worker IMAP continu. Apollo / Lemlist = pas
   d'IMAP, ils sont sender-only. HubSpot = inbox connect via OAuth Gmail/MS.
3. **Utile MAINTENANT ?** **Oui** pour le différenciateur "voir les réponses dans
   la timeline" qui est ce qui fait revenir le commercial dans l'outil. Sans
   réponses entrantes, la timeline 360° est unidirectionnelle = inutile.
4. **Verdict** : 🟢 **KEEP** — choix cron 5 min explicite (pas de BullMQ), migration
   additive (colonnes pas table), match prospect simple. Bien dimensionné. Le seul
   point discutable : `imapflow` + `mailparser` ajoutent 2 deps mais c'est
   incontournable pour parser IMAP correctement.

---

## 5. W8c — Inbox global cross-prospects `/inbox` (`9633542`)

**Périmètre** : page `/inbox` qui liste tous les `lead_emails` du tenant +
filtres in/out/attached/orphan + bouton "Rattacher". Routes `/api/inbox` (GET)
et `/api/inbox/attach` (POST). **~700 LOC**.

1. **Livré** : query helper inbox.ts avec cursor pagination, audit log
   `inbox.email_attached`, RBAC workspace.
2. **Concurrents** : Twenty / Pipedrive / HubSpot ont tous une vue "inbox global".
   C'est la 2e page la plus utilisée après le dashboard dans un CRM B2B.
3. **Utile MAINTENANT ?** **Oui** — directement consommé par W8b (les mails IMAP
   orphelins doivent pouvoir être rattachés manuellement). Sans cette page, IMAP
   est "écris dans la DB et personne ne voit". Le couple W8b+W8c est cohérent.
4. **Verdict** : 🟢 **KEEP** — page utile, taille raisonnable, pas de nouvelle table.
   Le seul commentaire : la cursor pagination + rate-limit 120/min sont du
   gold-plating pour 0 client, mais c'est pas grave (le code existe pour quand
   ça scalera, et ça coûte peu de maintenance).

---

## 6. W9a — Cleanup dev-pub disque (`c19e49b`)

**Périmètre** : script `cleanup-dev-pub.sh` + cron systemd 03:00 UTC + doc
runbook. Adresse 6 sources de saturation disque identifiées (images Docker,
/tmp megabattery, profiles Playwright orphelins, containers stoppés, volumes
dangling).

1. **Livré** : script idempotent, install via systemd timer, runbook.
2. **Concurrents** : N/A (infra interne).
3. **Utile MAINTENANT ?** **Oui** — dev-pub était à 84%, ça coupait la mega
   battery. Sans ce cleanup, Robert aurait passé du temps à débugger des
   "no space left on device".
4. **Verdict** : 🟢 **KEEP** — c'est de l'hygiène infra basique, bien fait.

---

## 7. W9b — Fix E2E flaky invite + mobile (`6ab1399`)

**Périmètre** : fix 2 specs Playwright flaky (listener console.error attaché
avant login → 401 attendus capturés ; networkidle qui n'arrive jamais à cause
de useSession refresh).

1. **Livré** : 2 fix ciblés réutilisant le pattern `captureConsoleErrorsAfterLogin`
   et `waitUntil:'load'` déjà éprouvés.
2. **Concurrents** : N/A.
3. **Utile MAINTENANT ?** **Oui** — flaky tests = bruit qui fait perdre confiance
   dans la suite et empêche d'utiliser la mega battery comme gate sérieux.
4. **Verdict** : 🟢 **KEEP** — fix propre.

---

## 8a. W9c-F — Queue mail_outbox (`644c5d1` partie F)

**Périmètre** : table `mail_outbox` (queued/sending/sent/failed_retry/failed),
`outbox.ts` 461 LOC avec SELECT FOR UPDATE SKIP LOCKED + retry exponential
1min/5min/15min/60min/24h, route `/api/cron/mail-outbox-flush` Bearer, refactor
`/api/mail/send` → 202 queued au lieu de 200 sent. **Migration 0028, ~700 LOC**.

1. **Livré** : pattern transactional outbox industriel + cron dédié + idempotency
   key UNIQUE + ticket annexe pour câbler CRON_SECRET + Dokploy schedule.
2. **Concurrents** : **AUCUN CRM B2B 1-user n'a de queue mail outbox**. Twenty
   envoie en sync (POST → SMTP direct). Pipedrive idem. Apollo / Lemlist qui font
   du batch outreach 1000+ mails/jour ont une queue, mais c'est leur core métier.
   Pour 1 commercial qui envoie 10-50 mails/jour personnellement, **envoi sync
   nodemailer = parfait**.
3. **Utile MAINTENANT ?** **NON — c'est l'overkill flagué par Robert.** Aucun
   client, aucun volume, et le cron n'est même pas câblé (CRON_SECRET 503).
   Pendant des semaines les mails resteraient `queued` indéfiniment si la route
   était utilisée. Sync nodemailer = 1-3s blocking, mais le commercial qui
   compose un mail attend déjà 30s d'écrire le sujet, il s'en fout des 2s SMTP.
4. **Verdict** : 🔴 **REVERT** — comme Robert l'a déjà dit. Proposition :
   - Drop migration 0028 (DROP TABLE mail_outbox)
   - Suppr `src/lib/mail/outbox.ts` + tests
   - Suppr `src/app/api/cron/mail-outbox-flush/route.ts`
   - Revert `/api/mail/send` au comportement sync (avant W9c)
   - Garder `applySignatureIfEnabled` mais l'appeler inline dans /api/mail/send
   - Update timeline pour afficher status='sent'|'failed' directement

   **Effort : 1 jour-humain.**

---

## 8b. W9c-A — Templates customs `tenant_mail_templates` (`644c5d1` partie A)

**Périmètre** : migration 0029 table `tenant_mail_templates` + soft-delete +
UNIQUE PARTIAL + lib resolve/create/update/softDelete + 5 routes admin RBAC +
1 route consumer + UI manager 356 LOC. **~900 LOC.**

1. **Livré** : multi-tenant templates dynamiques avec soft-delete, fallback sur
   2 templates hardcodés "Relance"/"Demo".
2. **Concurrents** : Twenty / Pipedrive / HubSpot ont tous des templates éditables.
   C'est standard.
3. **Utile MAINTENANT ?** **Marginalement** — 2 templates hardcodés couvraient le
   besoin v1. La table dynamique est utile dès qu'on a 1 client qui veut son
   propre wording. Mais soft-delete + UNIQUE PARTIAL + audit RBAC c'est du
   gold-plating prématuré.
4. **Verdict** : 🟡 **SIMPLIFY** — garder la table mais virer :
   - Soft delete + UNIQUE PARTIAL → DELETE hard, contrainte UNIQUE simple
   - Routes admin RBAC séparées → 1 route CRUD avec `requireAdmin`
   - UI manager 356 LOC → liste simple + form modal édition
   - Tests sabotage exhaustifs → tests happy path + 1 RBAC
   - Garder le fallback hardcodés (bonne idée pour regression-free)

   **Effort simplify : 0,5 j.** OU 🟢 **KEEP** si Robert juge que le truc tel
   quel ne coûte pas en maintenance (c'est défendable, mais reste over-engineered
   pour 0 client).

---

## 8c. W9c-I — Preview mail avant envoi (`644c5d1` partie I)

**Périmètre** : route `/api/mail/render-preview` (rendu liquid + détection vars
non substituées + signature optionnelle), composant `PreviewMailDialog` iframe
sandbox. **~300 LOC.**

1. **Livré** : preview iframe sécurisé (sandbox sans allow-scripts), warning vars
   unresolved.
2. **Concurrents** : tous les CRM ont un preview "à quoi va ressembler le mail
   avant envoi". C'est standard et utile.
3. **Utile MAINTENANT ?** **Oui** — sans preview, l'user envoie à l'aveugle, et
   un `{{ prospect.x }}` qui se rend en `{{ prospect.x }}` part en bug.
4. **Verdict** : 🟢 **KEEP** — utile, taille raisonnable.

---

## 8d. W9c-J — Signature commerciale auto (`644c5d1` partie J)

**Périmètre** : migration 0030 (`mail_signature_html` + `mail_signature_enabled`
sur tenant_mail_config), route GET/PUT signature, UI form preview live,
`applySignatureIfEnabled` au flush outbox. **~250 LOC.**

1. **Livré** : signature stockée tenant-level, appliquée au flush (donc
   modifiable en queue).
2. **Concurrents** : tous les CRM ont signature paramétrable. Standard.
3. **Utile MAINTENANT ?** **Oui** — un commercial qui ne peut pas mettre sa
   signature, c'est rédhibitoire. Marketing flag basique.
4. **Verdict** : 🟡 **SIMPLIFY** — garder la feature mais :
   - Virer la subtilité "applied au flush vs enqueue" → ça disparaît avec le
     revert F (plus de queue, plus de question)
   - Garder GET/PUT + UI preview live → c'est juste

   **Effort : 0,5 j (couplé au revert F).**

---

## 9. W9d — OpenRouter Palier 1+2 (`87e42ff`)

**Périmètre** : 2 paliers
- **Palier 1** : `OPENROUTER_VERIDIAN_KEY` env globale → fallback IA si tenant
  pas configuré, modèle Llama 3.3 70B :free.
- **Palier 2** : OAuth PKCE flow OpenRouter user link, migration 0031 table
  `user_openrouter_link` (api_key_enc AES-256-GCM, soft-delete, audit), 4 routes
  (connect/callback/disconnect/status), lib pkce.ts.

**~1500 LOC, 12 specs E2E.**

1. **Livré** : double couche fallback (link user > tenant config > Veridian) avec
   OAuth complet PKCE + cookie HMAC + CSRF state + anti link-jack.
2. **Concurrents** : Lemlist / Instantly / Apollo ne demandent pas à l'user de
   connecter SA clé OpenRouter — ils ont une clé OpenAI / Anthropic centrale et
   facturent à l'usage dans leur prix. Twenty propose "BYO key OpenAI" dans
   settings, point.
3. **Utile MAINTENANT ?**
   - **Palier 1** : OUI, fallback Veridian = "le user peut essayer l'IA sans
     rien configurer". C'est un onboarding crucial.
   - **Palier 2** : **NON, c'est l'overkill** — un OAuth PKCE complet pour link
     un compte OpenRouter alors que l'user peut juste coller sa clé `sk-or-...`
     dans un input dans /settings/mail (Palier déjà existant via tenant_ai_config).
     Robert lui-même reconnaît cet overkill dans le ticket
     `2026-05-26-openrouter-onboarding-ux-polish.md`.
4. **Verdict** : 🔴 **REVERT** sur Palier 2 / 🟢 **KEEP** sur Palier 1.
   - Drop migration 0031 (DROP TABLE user_openrouter_link)
   - Suppr `src/lib/openrouter/pkce.ts` + queries.ts user_openrouter_link parts
   - Suppr 4 routes `/api/integrations/openrouter/*`
   - Suppr composant `OpenRouterLinkCard`
   - Garder `resolveAdapter()` simplifié : tenant config > Veridian (sans la
     branche `link user`)
   - Garder `OPENROUTER_VERIDIAN_KEY` + doc OPENROUTER-SETUP.md

   **Effort : 0,5 j.**

---

## 10. W9e — IMAP/SMTP presets + App Password (`6f18d1e`)

**Périmètre** : lib `provider-presets.ts` 6 providers (Gmail/Outlook/Yahoo/iCloud/
OVH/Free) avec host/port/TLS + flag App Password + URL + guide. Component
MailProviderHint bandeau amber. Auto-fill onBlur email. **~400 LOC.**

1. **Livré** : detectProvider(email) + auto-fill non-destructif (n'écrase pas
   host manuel) + accordéon guide App Password.
2. **Concurrents** : Twenty CRM ne fait pas ça (l'user se débrouille avec la doc).
   Mais c'est exactement ce qu'on attend d'un produit poli.
3. **Utile MAINTENANT ?** **Oui** — Gmail / MS forcent App Password depuis 2022,
   sans guide les users abandonnent l'onboarding. C'est la friction n°1 sur la
   config mail BYO.
4. **Verdict** : 🟢 **KEEP** — feature UX pure, pas de table, lib simple,
   apporte une vraie valeur immédiate (réduit le bounce d'onboarding).

---

## 11. FIX-LEADS-BUY ChunkLoadError error boundary (`57cdc40`)

**Périmètre** : `src/app/error.tsx` error boundary qui detect ChunkLoadError
et force reload pendant fenêtre 502 deploy. Compteur sessionStorage anti-boucle.

1. **Livré** : 90 LOC test + 68 LOC error.tsx + 50 LOC lib.
2. **Concurrents** : N/A (mitigation infra Next.js).
3. **Utile MAINTENANT ?** **Mouais** — la root cause est le manque de blue-green
   deploy staging. L'error boundary masque le symptôme. Si on règle le blue-green
   (ticket P3 ouvert dans veridian-infra), cette mitigation est inutile.
4. **Verdict** : 🟡 **KEEP** mais flag comme dette — c'est un workaround, pas
   un fix. À supprimer une fois blue-green livré.

---

## 12. FIX-MEGABATTERY wrapper container (`1826dde`)

**Périmètre** : `scripts/e2e/staging-full.sh` wrap dans container Playwright sur
dev-pub via SSH+rsync+docker run --network staging-edge. Rétro-compat LOCAL_E2E=1.

1. **Livré** : 135 LOC bash modifié.
2. **Concurrents** : N/A (infra E2E interne).
3. **Utile MAINTENANT ?** **Oui** — sans ça la mega battery ne marche pas
   (PrismaClientInitializationError : DB staging joignable uniquement depuis
   le réseau Docker dev-pub). Robert ne peut pas gate ses promos sur la mega
   battery sans ce wrapper.
4. **Verdict** : 🟢 **KEEP** — outillage légitime.

---

## Synthèse verdicts

| # | Feature | Verdict | Effort |
|---|---|---|---|
| 1 | W7a Mail Hub Gateway | 🟡 SIMPLIFY (vire l'abstraction provider) | 0,5 j |
| 2 | W7b Refill ICP page native | 🔴 REVERT (ou simplify drastique 1 form) | 1 j |
| 3 | W8a Timeline P2/P3 | 🟢 KEEP | — |
| 4 | W8b IMAP cron 5min | 🟢 KEEP | — |
| 5 | W8c Inbox global | 🟢 KEEP | — |
| 6 | W9a Cleanup dev-pub | 🟢 KEEP | — |
| 7 | W9b E2E flaky fix | 🟢 KEEP | — |
| 8a | W9c-F Queue outbox | 🔴 REVERT (confirme Robert) | 1 j |
| 8b | W9c-A Templates customs | 🟡 SIMPLIFY (vire soft-delete, RBAC séparé) | 0,5 j |
| 8c | W9c-I Preview mail | 🟢 KEEP | — |
| 8d | W9c-J Signature | 🟡 SIMPLIFY (couplé avec revert F) | 0,5 j |
| 9 | W9d OpenRouter Palier 2 OAuth | 🔴 REVERT (Palier 1 garde) | 0,5 j |
| 10 | W9e Presets + App Password | 🟢 KEEP | — |
| 11 | FIX leads-buy ChunkLoad | 🟡 KEEP (dette à supprimer post blue-green) | — |
| 12 | FIX mega battery container | 🟢 KEEP | — |

**Total : 6 KEEP / 3 SIMPLIFY / 3 REVERT / 2 KEEP-dette.**

**Effort total revert+simplify : ~4 j-humain** (REVERT W7b 1 j + REVERT F 1 j +
REVERT OAuth PKCE 0,5 j + SIMPLIFY Hub Gateway 0,5 j + SIMPLIFY templates 0,5 j +
SIMPLIFY signature 0,5 j, mais 0,5 j à déduire car signature couplée à F = 0,5 j).

---

## Pattern récurrent + recommandation process

Les 3 REVERT (W7b ICP, F outbox, OAuth PKCE) ont un point commun : **chacun a
ajouté une couche "production scale" qui n'a aucun client à servir**. Les agents
Opus, mis en autonomie sans cadre business strict, vont mécaniquement vers
"l'industrie standard production-grade" parce que c'est ce que leur entraînement
récompense. Sans contre-poids, **tout sprint = sur-ingénierie programmée**.

**Recommandation pour les vagues suivantes** :

1. Préfacer chaque ticket sprint par un **cadre "stade de l'app"** :
   > Prosp = 0 client payant, 1 user (Robert), valide marché consulting CRM.
   > Tout truc qui n'apporte pas de valeur user IMMÉDIATEMENT et ajoute une
   > couche de maintenance = NON. Sync > async, BYO > OAuth flow, table simple >
   > méta-modèle, 1 form > 9 composants ICP, hardcodé > multi-tenant config.
2. Imposer un **budget LOC par feature** : "tu as 500 LOC max pour cette feature,
   au-delà tu reviens demander pourquoi". Ça force les agents à arbitrer.
3. **Banner contre les patterns industriels** : "interdit de poser une queue /
   un OAuth flow / un méta-modèle sans justification chiffrée écrite en haut
   du ticket".
4. **Review post-sprint systématique** : refaire cet audit après chaque vague.
   Mieux vaut revert sur du frais que de payer la dette 6 mois plus tard.

---

## Plan d'action recommandé

**Ordre suggéré (4 j-humain au total, 1 sub-agent Opus avec consigne stricte
"REVERT only, pas de nouvelle logique")** :

1. **REVERT F outbox** (1 j) — dégage le plus de surface code, débloque
   simplify J signature.
2. **REVERT OAuth PKCE Palier 2 OpenRouter** (0,5 j) — chirurgical, drop migration.
3. **REVERT W7b refill ICP** (1 j) — décision Robert : Option A revert complet
   OU Option B simplify 1 form. **Reco : Option B** (garde l'UX native page
   Prosp).
4. **SIMPLIFY W7a Mail Hub Gateway** (0,5 j) — vire abstraction provider.
5. **SIMPLIFY W9c-A templates** (0,5 j) — vire soft-delete + RBAC séparé.
6. **SIMPLIFY W9c-J signature** (couplé étape 1, 0 j supplémentaire).

**Migration DB à dropper** : 0026 lead_orders, 0028 mail_outbox, 0031
user_openrouter_link. Toutes en migration additive donc DROP TABLE clean.

**Tests à supprimer** : ~150 tests unit + ~40 specs E2E (les features revertées
emportent leurs tests).

**Net** : ~6000 LOC supprimées + ~150 tests supprimés + 3 migrations annulées.
La codebase respire mieux et Robert peut focus sur l'audit Twenty CRM (vision
customisable-crm) avec un Prospection plus simple à maintenir.
