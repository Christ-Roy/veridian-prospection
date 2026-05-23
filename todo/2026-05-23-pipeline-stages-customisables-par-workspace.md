# [PROSPECTION] Statuts pipeline customisables par workspace (kanban + lead-sheet)

> **Type** : Feature multi-tenant — extensibilité workflow
> **Sévérité** : 🟡 P1 — bloque la commercialisation aux clients qui ont leur propre process (agences, secteurs B2B verticaux). Les 8 stages canoniques actuels = "one size fits all" qui ne colle pas à tout le monde.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Demandeur** : Robert

## Existant (à étendre, pas remplacer)

### Stages canoniques actuels (8 hardcodés)
`src/lib/outreach/status.ts` :
```ts
export const PIPELINE_STAGES = [
  "fiche_ouverte",
  "repondeur",
  "a_rappeler",
  "site_demo",
  "acompte",
  "finition",
  "client",
  "upsell",
] as const;
```

Ce sont aujourd'hui les **colonnes du kanban** `/pipeline` + les valeurs possibles de `Outreach.pipelineStage` en DB.

### Schéma DB
- `Outreach.pipelineStage : String?` — colonne string libre, déjà extensible côté DB
- `Outreach.status : String @default("a_contacter")` — colonne string libre aussi
- Mapping bidirectionnel `STATUS_TO_PIPELINE` dans `src/lib/outreach/status.ts` (statuts ↔ stages)
- **Workspace** n'a aucun champ pipeline custom aujourd'hui

### Code UI
- `src/components/dashboard/pipeline-board.tsx` : Kanban rendu avec les 8 colonnes hardcodées
- `src/components/dashboard/lead-sheet/stage-transition.tsx` : sélecteur de stage dans la fiche lead
- `src/lib/types.ts:386` : `getPipelineStage(id)` lookup hardcodé

## Ce qu'il faut faire

### 1. Modèle DB — table `workspace_pipeline_stages`

Choix archi à trancher : **table dédiée** (recommandé) vs **JSONB sur Workspace**.

**Reco : table dédiée** — permet contraintes FK + audit + index :

```prisma
model WorkspacePipelineStage {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // Slug technique stable (utilisé dans Outreach.pipelineStage). Lowercase
  // snake_case. Unique par workspace.
  slug        String   @db.VarChar(64)

  // Label affiché à l'utilisateur. Edit live possible sans casser la DB.
  label       String   @db.VarChar(80)

  // Ordre d'affichage dans le kanban (gauche → droite).
  position    Int      @default(0)

  // Couleur du badge dans le UI (tokens OKLCH ou hex). Ex: "primary",
  // "warning", "#FF5733".
  color       String?  @db.VarChar(32)

  // Stage terminal (sort le lead du funnel actif). Ex: "client" ou "perdu".
  isTerminal  Boolean  @default(false) @map("is_terminal")

  // Stage caché du kanban mais visible en filtre (ex: "archive").
  isHidden    Boolean  @default(false) @map("is_hidden")

  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt   DateTime? @map("deleted_at") @db.Timestamptz

  @@unique([workspaceId, slug])
  @@index([workspaceId, position])
  @@map("workspace_pipeline_stages")
}
```

### 2. Migration Prisma + seed des 8 stages par défaut

Pour chaque workspace existant à la migration, INSERT les 8 stages canoniques actuels comme défaut (préserve le comportement actuel). Aucune perte de data.

Migration additive (CREATE TABLE + INSERT seed depuis SELECT workspace.id), 0 risque, tier 🟡 MOYEN (ajout schéma sans destructif).

### 3. API CRUD `/api/workspaces/[id]/pipeline-stages`

- `GET` : liste les stages du workspace ordonnés par position
- `POST` : crée un stage (admin only — `WorkspaceMember.role` admin ou owner)
- `PATCH /[stage_id]` : edit label, color, position, isTerminal, isHidden
- `DELETE /[stage_id]` : soft-delete. **Refuser si des leads sont encore sur ce stage** (sinon orphelins) — proposer migration en cascade vers un autre stage
- `POST /reorder` : bulk update position en transaction

Sécu : `requireAuth()` + check membership + check role (admin/owner uniquement pour mutations).

### 4. UI édition — `/settings/pipeline` (nouvelle page)

- Liste des stages du workspace courant (drag-and-drop pour reorder)
- Click sur un stage → modale edit (label, color, isTerminal, isHidden)
- Bouton "Ajouter un stage" → modale create
- Bouton "Supprimer" sur chaque stage (sauf si leads dessus → tooltip "Migrez les leads d'abord")
- Bouton "Réinitialiser aux stages par défaut" (restaure les 8 stages canoniques + délète les custom — confirmation requise)

### 5. Binding kanban `/pipeline`

`pipeline-board.tsx` :
- Lit les stages via `useQuery` (cache 60s, invalidate sur mutation)
- Rendu dynamique des colonnes (au lieu du map sur `PIPELINE_STAGES` hardcodé)
- Drag-and-drop d'un lead met à jour `Outreach.pipelineStage` avec le `slug` du stage cible
- Si un stage est marqué `isTerminal`, badge visuel différent (ex: bordure verte)
- Si un stage est marqué `isHidden`, colonne masquée du board principal (mais visible dans le filtre kanban)

### 6. Binding lead-sheet `stage-transition.tsx`

- Sélecteur dropdown des stages disponibles du workspace courant
- Affiche label + color, value = slug
- Validation côté serveur que le slug existe bien dans le workspace de l'user (pas de cross-tenant)

### 7. Gestion du legacy `STATUS_TO_PIPELINE` hardcodé

Les 8 stages canoniques actuels deviennent les 8 stages **par défaut** créés au seed. Le mapping `status → pipeline_stage` côté `src/lib/outreach/status.ts` doit être adapté :
- Si `status` change (ex: "a_contacter" → "contacte_en_cours"), regarder si un stage par défaut existe dans le workspace courant ; sinon fallback sur l'ordre par position
- Long terme : déprécier `status` (le `pipelineStage` devient source de vérité, `status` reste pour rétrocompat)

## Garde-fous sécu

- **`workspaceId` cross-tenant** : toute mutation/lecture filtre `WHERE workspaceId = activeWorkspaceId(user)`. Pas confiance au body.
- **Stage delete avec leads** : refus serveur si `SELECT COUNT(*) FROM outreach WHERE pipeline_stage = <slug>` > 0. Erreur user-friendly avec lien "migrer ces leads".
- **Race condition reorder** : transaction Prisma pour le bulk update position.

## Tests

### Unit (Vitest)
- API CRUD : create/update/delete/reorder, validation Zod, RBAC, refus si leads sur stage
- Helper de mapping `status → pipelineStage` : fallback si stage custom n'existe pas

### Source-level
- `pipeline-board.test.tsx` : asserte que les stages sont fetched, pas hardcodés
- `stage-transition.test.tsx` : asserte que le dropdown lit les stages du workspace

### E2E (sprint coverage flows entiers)
- Admin crée 2 stages custom → kanban affiche 8 + 2 stages
- Lead drag-and-drop sur stage custom → DB updated
- Suppression d'un stage avec leads → refusée
- Suppression d'un stage vide → OK + n'apparaît plus dans le board

## Effort

- Migration Prisma + seed : ~1h
- API CRUD (4 endpoints + Zod + tests) : ~3h
- Page UI `/settings/pipeline` + drag-and-drop reorder + modales : ~5h
- Refonte `pipeline-board.tsx` (dynamique) + tests : ~3h
- Refonte `stage-transition.tsx` + tests : ~1h
- Adaptation `STATUS_TO_PIPELINE` legacy : ~1h
- **Total : ~2 jours**. Tier 🔴 HAUT (migration DB + RBAC cross-tenant + refonte UI hot path).

## Risques + mitigations

- **Migration DB de 8 stages × N workspaces** : safe car additive, INSERT SELECT en 1 transaction. Backup R2 préalable.
- **Casser le kanban existant des clients** : pendant la migration, garder le rendu hardcodé en fallback si la table workspace_pipeline_stages est vide pour un workspace (filet 1 jour).
- **Performance** : cache 60s côté front via SWR/React Query, invalidation sur mutation. Le kanban se charge avec 1 query supplémentaire (négligeable).
- **Cross-tenant** : tests RBAC explicites obligatoires (cf `lib-tests-coverage` pour le pattern).

## Définition de done

- [ ] Migration Prisma + seed sur staging puis prod (manual apply, cf `project_prisma_migrate_pattern`)
- [ ] API CRUD `/api/workspaces/[id]/pipeline-stages` (4 endpoints)
- [ ] Page `/settings/pipeline` avec drag-and-drop reorder
- [ ] Kanban `/pipeline` rendu dynamique
- [ ] Lead-sheet `stage-transition.tsx` dropdown dynamique
- [ ] Tests Vitest + source-level + E2E (1 flow custom)
- [ ] Smoke staging : crée stage custom → kanban → lead-sheet → DB cohérente
- [ ] Promo prod avec migration manuelle

## Coordination

Pas de dépendance cross-app forte — 100% Prospection. Mais si le Hub veut un jour exposer les stages custom dans son admin (analytics cross-app par exemple), prévoir l'endpoint contrat plus tard.

## Référence

- Schéma actuel : `prisma/schema.prisma:Outreach` (pipelineStage + status)
- Stages canoniques : `src/lib/outreach/status.ts:PIPELINE_STAGES`
- UI kanban : `src/components/dashboard/pipeline-board.tsx`
- UI lead-sheet : `src/components/dashboard/lead-sheet/stage-transition.tsx`
- Décision schéma table dédiée vs JSONB : voir §1, table dédiée recommandée
