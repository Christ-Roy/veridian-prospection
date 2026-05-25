# [PROSPECTION] Fiche historique 360° — Phase 3 : appels Telnyx

> **Type** : Feature backend + UI — extension timeline
> **Sévérité** : 🟡 P1 — l'historique des appels est invisible sans ça.
> **Owner** : agent Prospection
> **Créé** : 2026-05-24
> **Suite de** : Phase 1 (livré 2026-05-24)

## Contexte

Le model `CallLog` existe déjà côté Prisma (`prisma/schema.prisma:241`) avec : `siren`, `tenantId`, `workspaceId`, `userId`, `direction`, `provider`, `startedAt`, `endedAt`, `durationSeconds`, `recordingPath`, `notes`, `status`, `telnyxCallControlId`.

La Phase 3 plug cette table dans la timeline. Pas besoin de nouvelle migration.

## Travaux Phase 3

### Backend

1. Ajouter type `call` dans `TimelineEvent` (`src/lib/queries/timeline.ts`) :
   ```ts
   { type: "call"; id; occurredAt; direction; status; durationSeconds; recordingPath?; notes?; }
   ```
2. Étendre `getProspectTimeline` pour requêter `prisma.callLog.findMany` filtré par `siren + tenantId + workspaceFilter`.
   - `occurredAt` = `startedAt`.
3. Route timeline : autoriser `call` dans `?types=`.

### Front

1. Étendre `history-tab.tsx` :
   - Icône `Phone` (sortant) / `PhoneIncoming` (entrant) lucide.
   - Rendu : durée mm:ss + statut badge + bouton "Écouter" si `recordingPath` (lien API audio).
2. Mettre à jour `TYPE_LABELS` + filtre type.

### Tests

- Vitest endpoint : merge avec callLog + tri desc + RBAC.
- Source-level history-tab : icône Phone présente, lien recording correct.
- Sabotage-test : passer un appel test (ou seed un CallLog) → la timeline doit le faire remonter en tête.

## Estimation

~0.5j (table existe, juste à câbler).

## Définition de done

- [ ] Timeline affiche les appels Telnyx (inbound + outbound)
- [ ] Bouton "Écouter" si recording disponible
- [ ] Filtre "Appels" dans la UI
- [ ] Tests Vitest + source-level
