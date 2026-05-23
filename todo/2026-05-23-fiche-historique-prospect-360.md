# [PROSPECTION] Fiche historique prospect 360° — agrégat tout-ce-qu'on-sait

> **Type** : Feature UI — page agrégat par prospect
> **Sévérité** : 🟡 P1 — pré-requis commercialisation : un commercial doit pouvoir voir L'INTÉGRALITÉ de son historique avec un prospect d'un coup d'œil, sinon il reprend chaque RDV à zéro.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Demandeur** : Robert (cadrage 2026-05-23, en parallèle du switch agence / mail SMTP)

## Vision

Quand un commercial ouvre la fiche d'un prospect, il doit voir **tout ce qu'on sait de ce prospect** sur une seule page/onglet. Pas de fragmentation entre "mail", "appels", "RDV", "notes", "transitions pipeline" — un **fil chronologique unique** qui raconte la relation avec ce prospect.

C'est l'inverse d'un CRM par silos. C'est une page **prospect-centrique** qui agrège toutes les sources.

## Contenu à agréger (timeline unifiée, descending date)

| Source | Données | Statut existant |
|---|---|---|
| **Données entreprise** (header fixe) | nom, siren, secteur, effectif, CA, dette tech, score qualité, site web, géoloc | ✅ existe (composants `quality-*`, `lib/types`) |
| **Contacts identifiés** | noms + emails + téléphones connus | ✅ existe (extracted_contacts, lead-sheet) |
| **Mails sortants** (SMTP v1) | date, sujet, body preview, template utilisé | ⏳ v1 mail (ticket `2026-05-23-feature-mail-smtp-imap-prospects.md`) |
| **Mails entrants** (IMAP v2) | date, from, sujet, body preview | ⏳ v2 mail (même ticket) |
| **Appels** (Telnyx) | date, durée, statut, résumé GPT, recording URL | ✅ existe (`call_logs` ?) — à brancher |
| **RDV / events calendrier** | date, titre, statut (planned/done/cancelled), notes | ✅ partiellement (composants RDV + calendrier) |
| **Transitions pipeline** | kanban stage changes (qui, quand, depuis quel stage) | ⏳ pas d'historique trackable aujourd'hui — à ajouter (audit_events ?) |
| **Notes libres** | notes manuelles de l'utilisateur | À vérifier (champ `notes` sur outreach ?) |
| **Followups planifiés** | rappels créés via l'app | ✅ existe (followups) |
| **Visites de sites / scraping events** | si tracking activé, dernière visite, pages vues | 🔵 hors v1, future |

## UI

### Emplacement

**Onglet "Historique" dans la lead-sheet** (panel latéral existant) — pas une page séparée. L'utilisateur ouvre la fiche prospect comme aujourd'hui, et un nouvel onglet "Historique" (à côté des onglets actuels) affiche la timeline complète.

Alternative : page plein écran `/leads/<domain>/historique` accessible via un bouton dans la fiche. À trancher en design — reco onglet latéral (moins de friction, contexte préservé).

### Layout timeline

```
┌───────────────────────────────────────────────┐
│ [Header entreprise — nom, score, dette, etc.] │
├───────────────────────────────────────────────┤
│ [Contacts identifiés : Alice, Bob]            │
├───────────────────────────────────────────────┤
│ TIMELINE (récente → ancienne)                 │
│                                               │
│ 📧 2026-05-23 14h — Mail envoyé "Relance Q2" │
│     → "Bonjour Alice, suite à notre…"         │
│                                               │
│ 📞 2026-05-22 10h — Appel 8min (résumé GPT)  │
│     → "Discussion budget, intéressé Q3"       │
│                                               │
│ 📅 2026-05-20 16h — RDV démo planifié        │
│                                               │
│ 🔄 2026-05-19 — Stage : a_rappeler → site_demo│
│                                               │
│ 📝 2026-05-18 — Note : "BANT validé"          │
│                                               │
│ …                                             │
└───────────────────────────────────────────────┘
```

### Filtres timeline

- Toggle par type (mail / appel / RDV / transition / note) — masque les types qu'on ne veut pas voir
- Filtre date (7j / 30j / tout)
- Par défaut : tout, descending date

## Backend

### Endpoint d'agrégation

`GET /api/leads/<siren>/timeline` (ou `<domain>` si tu préfères la cohérence URL existante).

**Auth** : `requireAuth()` + check que le user a accès au workspace propriétaire de cet outreach (filtre tenant standard).

**Réponse** : liste d'events normalisés trié par `occurred_at desc` :

```ts
type TimelineEvent =
  | { type: "mail_out"; id; occurred_at; subject; body_preview; template? }
  | { type: "mail_in"; id; occurred_at; from_email; subject; body_preview }
  | { type: "call"; id; occurred_at; duration_s; status; summary?; recording_url? }
  | { type: "rdv"; id; occurred_at; title; status; notes? }
  | { type: "pipeline_transition"; id; occurred_at; from_stage; to_stage; user_id }
  | { type: "note"; id; occurred_at; body; user_id }
  | { type: "followup"; id; occurred_at; reason; status };
```

Pagination cursor-based si > 100 events. Cache 10s côté front (SWR).

### Sources DB

- `lead_emails` (à créer dans ticket mail v1)
- `call_logs` (existant si Telnyx posé)
- `appointments` / events calendrier (existant — à vérifier table exacte)
- **NOUVEAU** : `pipeline_transitions` — à ajouter, sinon on perd l'historique des changements de stage. Schéma minimal :
  ```prisma
  model PipelineTransition {
    id          String   @id @default(uuid()) @db.Uuid
    outreachId  String   @map("outreach_id") @db.Uuid
    workspaceId String   @map("workspace_id") @db.Uuid
    fromStage   String?  @map("from_stage") @db.VarChar(64)
    toStage     String   @map("to_stage") @db.VarChar(64)
    userId      String?  @map("user_id") @db.Uuid
    occurredAt  DateTime @default(now()) @map("occurred_at") @db.Timestamptz
    @@index([outreachId, occurredAt])
    @@map("pipeline_transitions")
  }
  ```
  Hook côté `updateOutreach` ou via trigger Prisma middleware : à chaque mutation `pipelineStage`, INSERT un transition row.
- `outreach.notes` (à vérifier — champ existant ou à créer)
- `followups` (existant)

## Dépendances ticket

- **Ticket mail v1** (`2026-05-23-feature-mail-smtp-imap-prospects.md`) : alimente `mail_out`. **Bloquant pour timeline mail sortant.**
- **Ticket mail v2** (extension du même ticket) : alimente `mail_in`. **Bloquant pour timeline mail entrant.**
- **Ticket pipeline stages custom** (`2026-05-23-pipeline-stages-customisables-par-workspace.md`) : si on customise les stages, la timeline doit afficher les labels custom, pas les slugs hardcodés.
- **Ticket Telnyx call logs** : si la table `call_logs` existe déjà, ok. Sinon ticket dérivé à créer.

## Découpage livraison

### Phase 1 — Squelette timeline (~1j)
- Endpoint `/api/leads/<siren>/timeline` qui agrège : pipeline_transitions + followups + appointments
- Onglet "Historique" dans lead-sheet, rendu basique
- Migration `pipeline_transitions` + hook insert sur `updateOutreach`
- Tests Vitest endpoint + source-level composant

### Phase 2 — Ajout mails (~0.5j, dépend ticket mail v1)
- Plug `lead_emails` (sortants) dans l'endpoint
- Rendu type `mail_out` dans timeline

### Phase 3 — Ajout appels (~0.5j)
- Plug `call_logs` dans l'endpoint
- Rendu type `call` dans timeline (durée, résumé GPT, lien recording)

### Phase 4 — Polish (~0.5j)
- Filtres par type
- Filtre date
- Pagination cursor si > 100 events
- Sabotage-test E2E : une transition pipeline ajoute un event timeline dans les 5s

## Tests

### Unit (Vitest)
- Endpoint timeline : agrégation multi-sources, tri descending, filtres
- Hook pipeline_transition : insert row à chaque update outreach
- RBAC : un user d'un autre workspace tente lire timeline d'un outreach hors scope → 403

### Source-level
- Composant `lead-history-tab.tsx` : rendu correct selon type d'event
- Filtres : toggle masque/affiche correctement

### E2E (mega battery)
- Login → fiche prospect → onglet Historique → voit ≥ 1 event de chaque type seedé
- Change le stage du prospect → reload → nouvel event "pipeline_transition" en tête de timeline

## Effort

- Phase 1 : ~1j
- Phase 2 : ~0.5j (post mail v1)
- Phase 3 : ~0.5j
- Phase 4 : ~0.5j
- **Total : ~2.5j** étalés sur les livraisons mail et call logs.

Tier 🟡 MOYEN (UI + 1 nouvelle table + endpoint d'agrégation, pas de surface API publique sensible).

## Définition de done

- [ ] Migration `pipeline_transitions` + hook insert
- [ ] Endpoint `/api/leads/<siren>/timeline` + tests RBAC
- [ ] Onglet "Historique" dans lead-sheet
- [ ] Phase 1 : transitions + RDV + followups affichés
- [ ] Phase 2 : mails sortants (dépend ticket mail v1)
- [ ] Phase 3 : appels Telnyx
- [ ] Phase 4 : filtres + pagination
- [ ] Mega battery E2E couvre le flow (event apparaît post-action)

## Référence

- Mail v1 : `todo/2026-05-23-feature-mail-smtp-imap-prospects.md`
- Pipeline stages custom : `todo/2026-05-23-pipeline-stages-customisables-par-workspace.md`
- Cadre robustesse : `todo/2026-05-23-app-robustness-cadre.md`
