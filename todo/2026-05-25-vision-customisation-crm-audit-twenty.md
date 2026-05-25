# [PROSPECTION] Vision customisation CRM — audit Twenty + voies possibles

> **Type** : Spec produit / architecture (PAS de code, document de décision)
> **Sévérité** : 🟢 P2 — choix stratégique, à trancher avant Vague 11+
> **Owner** : Robert (décideur) — agent Prospection (exécution une fois tranché)
> **Créé** : 2026-05-25
> **Demandeur** : Robert
> **Statut** : 📋 audit + voies — attente arbitrage

---

## 1. Contexte & demande

Robert : "Twenty CRM est 100% customisable côté utilisateur (l'user définit ses Objects/Fields via UI, le schéma DB et le GraphQL sont régénérés). Veridian Prospection est aujourd'hui à l'opposé : schéma Prisma **strict**, 28 migrations, ~200 specs E2E qui testent des contrats typés (`Lead.siren`, `Outreach.pipelineStage`, etc.). Comment on rapproche les deux ? Plusieurs voies, je veux trancher."

Ce ticket :
1. Fait l'audit factuel de Twenty (archi, perfs, maturité, pièges)
2. Synthétise ce que Veridian Prospection est **vraiment** aujourd'hui
3. Propose **5 voies** du plus conservateur (~3 j-h) au plus radical (~6 mois solo)
4. Donne une **reco honnête** basée sur le profil de Robert (solo + données figées + pré-commercial)

---

## 2. Audit Twenty CRM (synthèse recherche 2026-05-25)

### 2.1 Vision produit

- "The #1 Open-Source CRM, designed for AI" — alternative Salesforce/HubSpot
- Slogan technique : "Building blocks for a custom CRM"
- 46.5k stars GitHub, version courante `v2.7.0` (72 releases depuis le démarrage)
- **Pas de claim GA explicite** — la communication officielle reste prudente côté production-readiness ; les notes de release parlent de migrations destructives jusqu'à très récemment (incrémentales obligatoires jusqu'à v1.22, cross-version seulement depuis 1.22+)

### 2.2 Stack

| Couche | Choix |
|---|---|
| Backend | NestJS (TypeScript) |
| Frontend | React + Jotai + Linaria |
| DB | PostgreSQL **un schéma par workspace** (`workspace_{uuid}`) |
| Queue | BullMQ + Redis (obligatoire) |
| GraphQL | Schéma **régénéré à runtime** depuis le metadata cache |
| ORM | `twenty-orm` (custom maison, doc "thin" admise par leur propre rétro) |
| Monorepo | Nx |

### 2.3 Le modèle de données — meta-model 100%

C'est **le** point d'architecture qui rend Twenty si différent des CRM classiques :

1. **Workspace = schéma Postgres physique**. Provisionner un tenant = `CREATE SCHEMA workspace_xxx`. Dropper un tenant = `DROP SCHEMA CASCADE`.
2. **Catalogue méta dans le schéma `core`** :
   - `core.objectMetadata` (un row par "objet" type Lead/Company/Deal/CustomThing)
   - `core.fieldMetadata` (un row par "field" — type, nom, defaultValue stockés JSONB ; unique constraint sur `(name, objectMetadataId, workspaceId)`)
3. **DDL dynamique** : quand l'admin ajoute un field via UI, le backend fait
   ```sql
   ALTER TABLE workspace_xxx.company ADD COLUMN custom_field TEXT;
   ```
   et update `core.fieldMetadata` dans la même transaction.
4. **GraphQL recomputé live** : `TypeMapperService` lit le métadata cache et assemble les types/résolveurs (`UUIDScalarType`, `GraphQLString`…) "à chaque switch de contexte workspace". Une mutation `createFieldMetadata` → quelques secondes plus tard `findManyMyObject` apparaît dans le schema.
5. **DDL guardrails** : `checkSchemaExists()` avant toute migration + flag env `WORKSPACE_SCHEMA_DDL_LOCKED` pendant hot-upgrades (sinon migrations concurrentes qui s'entredéchirent).

### 2.4 Ce que ça permet aux clients

- Créer "Deals" / "Tasks" / "Contracts" / n'importe quoi sans deploy
- Custom fields infinis sur tout objet, **pricing inchangé** ("unlimited custom fields")
- Relations entre custom objects
- Schéma vraiment isolé par tenant (RGPD : drop schema = vraie purge)
- Pas de bricolage JSONB côté client — tout reste **typed** côté GraphQL

### 2.5 Inconvénients & pièges connus

| Sujet | Détail factuel |
|---|---|
| **Migrations destructives** | Jusqu'à v1.22, upgrade **incrémental obligatoire** (v1.6→v1.7→v1.8…). Reports d'instances "blank" après update 1.4→1.6.7. |
| **First-boot lent v2.5+** | Versioned envelope pour secrets au-repos → "slow upgrade commands" sur grosses DB (heureusement idempotent + resumable). |
| **Stack lourde** | NestJS + Postgres + Redis + BullMQ. Pas de SQLite fallback, pas de single-binary. "Operational burden for small teams" écrit noir sur blanc dans la revue. |
| **Doc twenty-orm "thin"** | Leur propre ORM custom, peu documenté, peu testé sur l'assemblage dynamique de schéma + workspace migrations. |
| **Couplage email/calendar** | Sync email/calendar **ne marche que** sur People, Companies, Opportunities — les custom objects sont exclus de cette feature. Limite produite par la complexité du méta-modèle. |
| **Performance scalabilité** | Recent fix CPU "replace deep-equal by fastDeepEqual" → indique des hot paths sensibles. Logs ajoutés "before/after instance slow data migration" = signal qu'ils découvrent en prod. |

### 2.6 Verdict factuel sur Twenty

- **Cool produit, archi élégante en théorie**, communauté active (46.5k ⭐ ce n'est pas rien)
- **Mais c'est un produit complet d'une équipe full-time** (NestJS + Redis + BullMQ + custom ORM + custom GraphQL builder + UI builder)
- **Encore en maturation** : v2.x, migrations destructives jusqu'à très récemment, doc interne admise comme partielle, problèmes prod sortent au fil de l'eau
- **Pas une lib qu'on plug** : c'est un CRM concurrent qu'on adopte en entier ou qu'on copie

---

## 3. État Veridian Prospection actuel (audit 2026-05-25)

### 3.1 Profil

- Next.js 15 (App Router) + Prisma + Postgres multi-tenant (un seul schéma `public`, colonne `tenant_id` partout)
- **28 migrations Prisma** linéaires, schéma typé **strict** (1106 lignes de `schema.prisma`)
- ~61 fichiers `*.spec.ts` E2E Playwright + 57 tests Vitest. Les tests valident des **contrats typés** : champs exacts, FK siren, énumérations stages
- Robert seul agent dev (avec moi en team-lead Claude). Pas d'équipe backend.
- App en pré-commercial actif (refill leads, mail v2, Telnyx en cours)

### 3.2 Les deux couches de données

Le schéma actuel se sépare naturellement en **deux mondes** :

**Couche figée par nature métier (intouchable)** :
- `entreprises` (996K rows) — siren, raison_sociale, NAF, effectif, dirigeants, web_*, score, etc. ~95 colonnes. Source = open-data-hub v3.8 (job ingest externe).
- `lead_segments` — appartenance d'un siren à un segment.
- C'est **l'asset Veridian** : 996K boîtes pré-enrichies. On ne touche pas le schéma, on l'enrichit côté ingest seulement.

**Couche métier user-driven (extensible)** :
- `Outreach` — pipeline commercial par tenant/workspace (status libre, notes, qualification, pipelineStage déjà extensible)
- `WorkspacePipelineStage` (livré 2026-05-23) — **première brique de customisation** : stages pipeline configurables par workspace
- `CallLog`, `LeadEmail`, `Appointment`, `Followup`, `PipelineTransition` — tables d'activité par lead
- `Workspace.displayMode` / `defaultGeoFilters` / `defaultSectorFilters` — **deuxième brique** : préférences UI/onboarding par workspace
- `TenantMailConfig`, `TenantAiConfig` — config BYO SMTP/IMAP/LLM par tenant
- `WebhookOutbox` — events sortants vers Hub
- `WorkspaceMember` / `Invitation` / `MagicLink` — RBAC + onboarding

### 3.3 Signaux symptomatiques d'un besoin de customisation

Pris dans les 20 derniers tickets `todo/done/` :
- `2026-05-23-pipeline-stages-customisables-par-workspace.md` ✅ stages custom (1ère vraie brique custom-by-tenant)
- `2026-05-22-switch-mode-agence-et-onboarding.md` ✅ displayMode + filtres défaut par workspace
- `2026-05-25-mail-templates-ia-llm.md` ✅ templates mail générés IA — BYO clé LLM
- `2026-05-25-refill-leads-page-native-icp.md` ✅ ICP custom (filtres JSON `filters_json`)
- `2026-05-24-fiche-360-phase-3-appels-telnyx.md` ✅ timeline 360° agrégée

**Lecture business** : Robert ajoute progressivement des **briques de customisation par workspace** (stages, mode, ICP, templates) sans jamais toucher au cœur typé. La trajectoire actuelle est déjà un **méta-modèle léger émergent** — sans le nommer.

### 3.4 Ce qu'on perdrait en passant méta 100%

- **Type safety Prisma** sur 95% du code applicatif (autocomplete, refactor safe)
- **~200 specs E2E** qui testent des contrats typés (`outreach.pipelineStage === "fiche_ouverte"` etc.) — devraient être réécrites pour valider des "objects+fields dynamiques"
- **Vélocité Robert seul** : la dette d'un méta-modèle (DDL dynamique, GraphQL builder, cache invalidation, queue de rebuild) c'est 3-4 mois full-time pour une équipe expérimentée
- **Simplicité ops** : aujourd'hui un seul schéma Postgres, dump = 1 fichier. Si on passe à "1 schéma par workspace", le backup/restore + Prisma + tooling explose en complexité

---

## 4. Voies possibles (du conservateur au radical)

> **Effort estimé en jours-humain (j-h) seuls.** Multiplier par 1.5–2 si Robert
> bosse à mi-temps dessus (réalité solo).

---

### Voie A — Custom Fields JSONB sur Outreach (conservateur, ~3 j-h)

**Idée** : on ajoute UNE colonne `customFields JSONB` sur `Outreach` (et éventuellement `Workspace.customFieldDefinitions JSONB` pour définir les fields).

```prisma
model Outreach {
  // ... existant ...
  customFields Json? @default("{}") @map("custom_fields")
}

model Workspace {
  // ... existant ...
  // Définitions des fields custom (schéma admin)
  // [{slug:"budget_estime", label:"Budget estimé", type:"number"},
  //  {slug:"signe_avec", label:"Signé avec",        type:"select", options:[...]}]
  customFieldDefs Json? @default("[]") @map("custom_field_defs")
}
```

UI : page `/settings/custom-fields` où l'admin ajoute "Budget estimé / Number" — apparaît immédiatement comme champ éditable dans la lead-sheet.

**Avantages** :
- 1 migration Prisma, 1 GIN index sur `outreach.custom_fields`, 0 DDL dynamique
- Pas de queue, pas de Redis, pas de GraphQL régénéré
- Le code typé existant n'est pas touché — `Outreach.pipelineStage` reste typé
- E2E existants ne bougent pas

**Inconvénients** :
- Pas de **filtre indexé** sur custom fields sans expression index manuel (= chaque tenant qui veut filtrer "budget > 50k" nécessite un index dédié, donc bof)
- Pas de relations entre customs
- Custom fields scoped à `Outreach` uniquement (pas de "Deal" ou "Task" séparés)
- Validation côté code (TS) seulement, pas DB

**Scope MVP (~3 j-h)** :
- Migration + UI settings custom-fields (CRUD défs) + render dans lead-sheet
- Tests E2E : 1 spec "ajouter field → apparaît → enregistre"

**Scope full (~5 j-h)** : + filtres sur custom fields dans la liste prospects + export CSV.

---

### Voie B — Vues sauvegardées + custom fields (medium, ~7 j-h)

= Voie A + table `SavedView` (filtres + colonnes + tri persistés par user/workspace).

```prisma
model SavedView {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String   @map("workspace_id") @db.Uuid
  userId        String?  @map("user_id") @db.Uuid  // null = vue partagée workspace
  name          String
  // {filters:{score:">80"}, columns:["denomination","budget_estime"], sort:"-prospect_score"}
  config        Json
  isPinned      Boolean  @default(false) @map("is_pinned")
  createdAt     DateTime @default(now())
}
```

**Avantages voie B vs A** :
- Vraie valeur perçue côté user — "j'ai MA vue 'prospects chauds > 80'"
- Ouvre la porte aux **filtres custom** sur custom fields
- Reste 100% rétro-compat, le code typé n'est pas touché

**Inconvénients** :
- Effort marginal : ~+4 j-h vs voie A
- Doit gérer migrations de schéma de `config` quand on évolue (versionning JSONB)

**Scope MVP (~7 j-h)** : voie A + table SavedView + UI tabs vues + filtres custom dans la liste prospects.

---

### Voie C — Briques génériques (custom fields + vues + workflows + webhooks, ~3 semaines)

= Voie B + 2 briques héritées de l'industrie :

**3.1 Workflow rules** (`workspace_workflows`) — "quand stage passe à `client`, créer un Followup à +7 jours" / "quand custom field `budget` > 50k, envoyer notif Slack".

```prisma
model WorkflowRule {
  id            String @id
  workspaceId   String @map("workspace_id") @db.Uuid
  trigger       Json   // {event:"stage_changed", to:"client"}
  conditions    Json   // [{field:"budget_estime", op:">", value:50000}]
  actions       Json   // [{type:"create_followup", delay:"7d"}, {type:"webhook", url:"..."}]
  enabled       Boolean @default(true)
}
```

**3.2 Webhook subscriptions client-facing** (`workspace_webhooks`) — l'user déclare un endpoint qui reçoit les events de SON workspace. Réutilise le `WebhookOutbox` qu'on a déjà construit pour Hub → généralisable.

**Avantages** :
- C'est ce qui rend HubSpot "léger" puissant : custom fields + vues + workflows + webhooks. **80% du gain Twenty pour 20% du coût.**
- Reste rétro-compat strict, le typé existant ne bouge pas
- Chaque brique livrable indépendamment

**Inconvénients** :
- 3 semaines solo = un sprint complet où Robert ne fait que ça
- Le moteur workflow nécessite un scheduler (mais on a déjà cron + webhook outbox → réutilisable)
- Pas de "custom objects" — un user qui veut "Deals séparés de Outreach" est coincé

**Scope MVP** : voie B + WorkflowRule (trigger=stage_changed, action=create_followup/webhook seulement) + WorkspaceWebhook.

---

### Voie D — Méta-modèle léger (custom objects par tenant, sans toucher au schéma Lead, ~6 semaines)

**Idée majeure** : introduire un **modèle générique parallèle** à côté du schéma typé, qui permet de créer des "Entités custom" par workspace.

```prisma
// Définition d'un type d'objet custom (un par workspace)
model CustomObject {
  id           String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId  String @map("workspace_id") @db.Uuid
  slug         String // "deal", "task", "contract"
  label        String // "Affaire"
  // Définition des fields (typed JSONB)
  // [{slug:"montant", label:"Montant", type:"number"},
  //  {slug:"closed_at", label:"Closed at", type:"date"},
  //  {slug:"lead_siren", label:"Lead", type:"relation", target:"entreprise"}]
  fields       Json
  @@unique([workspaceId, slug])
}

// Stockage des records (EAV-like, scaled via JSONB)
model CustomRecord {
  id            String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String @map("workspace_id") @db.Uuid
  objectSlug    String // "deal"
  // Tous les fields packagés en JSONB
  data          Json   // {montant: 50000, closed_at: "2026-06-01", lead_siren: "552123456"}
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([workspaceId, objectSlug])
  // GIN index pour filtres JSONB
  // @@index([data], type: Gin) ← à câbler hors Prisma (raw SQL)
}
```

L'app principale (`Outreach`, `Entreprise`, `CallLog`…) **reste typée**. Mais l'user peut créer ses propres entités side-by-side (`Deals`, `Tasks`, `Contracts`) avec ses propres fields, et les lier au siren des leads.

**Avantages** :
- Pas de DDL dynamique (1 seul schéma, 1 seule table `custom_records`) → ops simple
- Pas de GraphQL régénéré (REST pragmatique : `GET /api/custom/{object}/records?filter=...`)
- Pas de queue / Redis nouveau
- Les 996K leads, l'auth, le billing, le mail v2 — **tout reste typé**
- Donne 80% de la valeur Twenty (custom objects + custom fields) avec 5% de la complexité
- Possible pricing tier (custom objects = Business plan)

**Inconvénients** :
- Stockage JSONB → indexes GIN à maintenir manuellement par tenant qui scale
- Relations entre customs sans FK SQL stricte (validation app)
- ~6 semaines solo c'est gros, mais bornable (livrable par phase : objects → fields → records → UI → vues → workflows)
- Vrai change architectural : nouvelle abstraction côté API + UI builder visuel (drag & drop fields)

**Scope MVP (~3 semaines)** : CustomObject + CustomRecord en JSONB + REST CRUD + UI "1 nouvelle entrée side-nav par object" (vue liste simple).

**Scope full (~6 semaines)** : + UI builder visuel fields + relations entre objects + vues custom + filtres GIN-indexed.

---

### Voie E — Twenty-style méta-modèle 100% (radical, ~6 mois solo)

**Idée** : on bascule l'archi entière sur le modèle Twenty. `Lead`/`Outreach`/`CallLog` deviennent des "objects" parmi d'autres dans un registre méta. Schéma DB régénéré via DDL dynamique. GraphQL recomputé. BullMQ + Redis pour les rebuilds async.

**Avantages** :
- Customisation maximale, parité fonctionnelle avec Twenty
- Type safety préservée via GraphQL codegen (chaque tenant a son schéma typé)
- Vraie isolation tenant (schéma Postgres physique par tenant)

**Inconvénients HONNÊTES** :
- **6 mois solo c'est optimiste**. Twenty c'est une équipe ~10 ingénieurs full-time depuis 3 ans, et leur propre rétro admet : doc "thin", couverture test "spotty", migrations destructives jusqu'à v1.22.
- Faut **réécrire 28 migrations Prisma + 200 specs E2E + tout le RBAC + le billing + le mail v2 + le refill leads + le timeline 360°**. Tout, ou presque, en mode "tu prends un cas spécial du méta-modèle".
- **Les 996K leads ne sont pas un objet user-defined** — c'est un asset Veridian. Soit on les laisse en table figée (incohérence avec le méta-modèle), soit on accepte que le "Lead" Twenty-style soit moins puissant que ce qu'on a aujourd'hui.
- Stack : il faut Redis + BullMQ + un custom ORM ou TypeORM/MikroORM + un builder GraphQL maison + invalidation cache → 4 nouvelles deps critiques en prod
- L'app a 28 migrations et un produit en pré-commercial : **toute interruption ≥ 2 mois fragilise la commercialisation** que Robert est en train de lancer

**Verdict voie E** : faisable uniquement si Veridian Prospection devient un projet à plein temps avec 2-3 devs. **En solo + commercialisation en cours = recette pour planter le projet.**

---

## 5. Critères de décision — tableau comparatif

| Critère | A (custom fields) | B (vues + fields) | C (workflows + webhooks) | D (custom objects méta-léger) | E (Twenty-style 100%) |
|---|---|---|---|---|---|
| **Effort solo** | ~3 j-h | ~7 j-h | ~3 semaines | ~6 semaines | ~6 mois (optimiste) |
| **Risque de régression** | 🟢 nul | 🟢 nul | 🟡 faible | 🟡 moyen | 🔴 élevé |
| **Casse les ~200 E2E** | ❌ non | ❌ non | ❌ non | ⚠️ partiellement (nouvelle surface) | ✅ presque toutes à réécrire |
| **Impacte les 996K leads** | ❌ non | ❌ non | ❌ non | ❌ non | ⚠️ oui (asset reclassé) |
| **Valeur perçue client** | 🟡 "ajouter un champ" | 🟢 "mes vues" | 🟢🟢 "mon process auto" | 🟢🟢🟢 "ma app sur-mesure" | 🟢🟢🟢🟢 "alternative Salesforce" |
| **Différenciation marché** | 🟡 standard | 🟡 standard | 🟢 niveau HubSpot | 🟢 niveau Pipedrive custom | 🟢🟢 niveau Salesforce |
| **Réversibilité** | ✅ trivial (drop colonne) | ✅ trivial | ✅ trivial | ⚠️ moyen (migration data custom) | ❌ point of no return |
| **Stack nouvelle complexité** | Aucune | Aucune | Aucune (cron+outbox déjà là) | Aucune (1 schéma) | Redis + BullMQ + custom ORM + GraphQL builder |
| **Compatible commercialisation en cours** | ✅ | ✅ | ✅ | 🟡 (à phaser) | ❌ |

---

## 6. Ma recommandation (agent)

**Reco : Voie D (méta-modèle léger / custom objects via JSONB), démarrée APRÈS avoir bouclé la Voie B/C en chemin.**

### Pourquoi pas A/B seul

A et B sont trop conservateurs vs la trajectoire produit. Tu livres déjà des briques de customisation par workspace tous les 3 jours (pipeline stages custom, displayMode, ICP, templates IA). En t'arrêtant à "custom fields sur Outreach" tu te coinces dans 6 mois.

### Pourquoi pas E (Twenty-style)

**Honnêtement** : c'est une mauvaise idée pour ton profil.

- Tu es solo. Twenty c'est ~10 ingénieurs depuis 3 ans et leur propre revue admet doc "thin" + couverture test "spotty" + migrations destructives.
- Tu as 996K leads qui sont **ton asset différenciant**. Le méta-modèle Twenty rend cet asset moins utile (c'est un objet parmi d'autres dans leur monde).
- Tu es en **pré-commercialisation active** — refill leads / mail v2 / Telnyx sont en cours. Une refonte 6 mois te tue le momentum business.
- Le ROI utilisateur entre D et E est faible : 95% des clients B2B veulent "ajouter un field, créer une entité Deal, automatiser un workflow" — pas "redessiner tout mon CRM". Voie D couvre ce besoin.

### Pourquoi D (avec passage B/C en chemin)

1. **Cohérent avec ta trajectoire actuelle** : tu construis déjà des briques de customisation par workspace (`WorkspacePipelineStage`, `displayMode`, ICP custom). D formalise ce pattern.
2. **Le typé reste typé** : Lead, Entreprise, Outreach, CallLog, LeadEmail, Workspace, Tenant — tout ça reste strict, tes 200 E2E ne bougent pas, le mail v2 et Telnyx continuent de marcher.
3. **80% de la valeur Twenty pour 5% de la complexité** : custom objects + custom fields + filtres + relations soft, sans Redis ni BullMQ ni custom ORM ni GraphQL régénéré.
4. **Pricing tier naturel** : voie A peut être dans le plan Pro (ajouter custom fields à Outreach) ; les custom objects voie D = différenciateur plan Business → vrai levier ARR.
5. **Phasable proprement** :
   - **Semaine 1-2 (= Voie A élargie)** : `Workspace.customFieldDefs` + `Outreach.customFields` JSONB, UI settings, render dans lead-sheet, export CSV
   - **Semaine 3 (= Voie B)** : SavedView (vues sauvegardées + filtres sur custom fields)
   - **Semaine 4-5 (= cœur Voie D)** : `CustomObject` + `CustomRecord` (JSONB), REST CRUD générique, UI side-nav dynamique, vue liste basique
   - **Semaine 6+** : relations entre customs, workflow rules (Voie C), webhook subscriptions client-facing
6. **Réversible** : chaque phase est livrable. Si à la fin de la semaine 2 tu décides que la voie A te suffit, tu archives le reste.

### Reco quantifiée

**Voie D phasée, ~6 semaines staggérées sur 2-3 mois** (en intercalant les vagues mail/Telnyx en cours). À l'arrivée : Veridian Prospection a un **CRM customisable au sens HubSpot/Pipedrive**, sans le coût et le risque d'un Twenty-clone.

Confiance : **~75%** sur la voie D. Le 25% d'incertitude vient des questions ouvertes ci-dessous.

---

## 7. Questions ouvertes pour Robert (à trancher)

1. **Quels clients ont demandé "customisable" précisément ?**
   - Si c'est "j'ai besoin d'un champ Budget sur mes prospects" → voie A suffit largement.
   - Si c'est "j'ai besoin d'avoir mes propres pipelines de Deals/Tasks séparés des prospects" → voie D devient évidente.
   - Si c'est "remplace HubSpot" → voie D + C, sur 3 mois.

2. **Niveau de customisation suffisant pour quel ARR cible ?**
   - Free / Pro à 29-99€ → voie A/B suffit.
   - Business 299-999€ → voie D nécessaire pour justifier l'écart de prix.
   - Enterprise sur mesure → voie E (mais Twenty existe déjà — pourquoi le refaire ?).

3. **Quel timeline business ?**
   - 3 mois : voie A ou B uniquement.
   - 6 mois : voie D phasée (= ma reco).
   - 12 mois : voie D complète + voie C.
   - 24+ mois avec embauche : ouvrir voie E en discussion.

4. **Acceptable de garder les 996K leads comme "data figée premium" ?**
   - Si oui → voies A/B/C/D nickel, le Lead reste un objet noble typé à part.
   - Si non (tu veux que l'user puisse customiser même le schéma Lead) → seule voie E permet ça, et c'est un piège.

5. **Quel est le rapport entre customisation et différenciation marché Veridian ?**
   - Aujourd'hui ton différenciant = **996K leads pré-enrichis + score tech + ICP refill**. Pas la customisation.
   - Si tu veux ajouter la customisation comme 2e pilier différenciant → voie D.
   - Si tu veux garder l'enrichissement comme seul pilier et la customisation comme "table-stake" → voie A/B suffit.

6. **Twenty CRM en intégration plutôt qu'en refonte ?**
   - Le schéma Tenant actuel a **déjà** des colonnes `twentyWorkspaceId`, `twentyApiKey`, `twentyLoginToken` (cf. `prisma/schema.prisma` lignes 862-868). Une voie hybride existerait : **garder Prosp typé pour le métier, brancher Twenty pour le CRM custom-objects** (et on push les leads enrichis vers Twenty via API). C'est une voie F possible. Question : est-ce que tu veux qu'on creuse cette piste, ou Twenty est out parce qu'il est trop lourd à déployer côté client ?

---

## 8. Décision attendue

| Décision | Action déclenchée |
|---|---|
| ✅ Go voie A | Ouvrir ticket implém ~3 j-h, mergé en 1 sprint |
| ✅ Go voie B | Ouvrir ticket implém ~7 j-h, mergé en 2 sprints |
| ✅ Go voie C | Sprint complet ~3 semaines, à phaser avec mail/Telnyx |
| ✅ **Go voie D phasée (ma reco)** | Ouvrir 4 tickets phasés (custom fields → vues → custom objects → workflows), exécution sur 2-3 mois |
| ❌ Stop voie E | Confirmer qu'on ne va pas réécrire en Twenty-style |
| ❓ Explorer voie F (intégration Twenty)| Ouvrir ticket "feasibility intégration Twenty as backend custom" |

**Robert** : tranche entre A/B/C/D/F (E déconseillée formellement). Je prépare les tickets d'implém une fois la voie choisie.

---

## Annexes

- Twenty repo : https://github.com/twentyhq/twenty (46.5k ⭐, v2.7.0)
- Twenty data model docs : https://docs.twenty.com/user-guide/data-model/overview
- Codeline review Twenty (technique) : https://www.codeline.co/thoughts/repo-review/2024/twenty-open-source-crm
- Pattern JSONB custom fields multi-tenant : https://www.architecture-weekly.com/p/postgresql-jsonb-powerful-storage
- Notre schéma Prisma : `prisma/schema.prisma` (1106 lignes, 28 migrations)
- Première brique custom livrée : `todo/done/2026-05-23-pipeline-stages-customisables-par-workspace.md`
