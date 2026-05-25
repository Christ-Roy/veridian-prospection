# [PROSPECTION] Fiche historique 360° — Phase 2 : mails sortants & entrants

> **Type** : Feature backend + UI — extension timeline
> **Sévérité** : 🟡 P1 — la timeline reste muette sur le canal mail tant que cette phase n'est pas livrée.
> **Owner** : agent Prospection
> **Créé** : 2026-05-24
> **Suite de** : `todo/done/2026-05-23-fiche-historique-prospect-360.md` Phase 1 (livré 2026-05-24)

## Contexte

Phase 1 livrée : timeline agrège `pipeline_transitions` + `followups` + `appointments`. L'endpoint `GET /api/leads/[siren]/timeline` et le composant `HistoryTab` sont en place côté Prospection.

Phase 2 ajoute le canal mail :
- **v1** : mails sortants (SMTP transactional via Notifuse ou direct).
- **v2** : mails entrants (IMAP pull du compte commercial).

## Dépendances bloquantes

- Ticket mail v1 `todo/2026-05-23-feature-mail-smtp-imap-prospects.md` doit livrer la table `lead_emails` (ou nom équivalent) avec au minimum :
  ```
  id, tenant_id, workspace_id, user_id, siren, direction (out|in),
  from_email, to_email, subject, body_preview, template_used?,
  sent_at | received_at, status
  ```

Si la table n'existe pas encore, créer un ticket follow-up sur le repo mail.

## Travaux Phase 2

### Backend

1. Ajouter type `mail_out` et `mail_in` dans `TimelineEvent` (`src/lib/queries/timeline.ts`).
2. Étendre `getProspectTimeline` pour requêter `lead_emails` filtré par `siren + tenantId + workspaceFilter` :
   - 2 buckets séparés (direction=out → `mail_out`, direction=in → `mail_in`).
   - `occurredAt` = `sent_at` ou `received_at`.
3. Mettre à jour la route `/api/leads/[siren]/timeline` pour accepter les nouveaux types dans le filtre `?types=`.

### Front

1. Étendre `history-tab.tsx` :
   - Ajouter icônes `Mail` (out) + `Inbox` (in) depuis lucide.
   - Ajouter les buttons filtre "Mails envoyés" + "Mails reçus".
   - Rendu : sujet en gras + body_preview en grisé 2 lignes max + template? badge.
2. Mettre à jour `TYPE_LABELS` + `EventType` union.

### Tests

- Vitest endpoint : merge avec lead_emails, tri desc respecté, RBAC tenant.
- Source-level history-tab : ajout des nouveaux types attendus.
- Sabotage-test : marquer un mail comme sortant en base → la timeline doit le faire remonter dans les 5s.

## Estimation

~0.5j si la table mail existe avec les bonnes colonnes. +1j si schéma à négocier.

## Définition de done

- [ ] Timeline affiche les mails sortants (Phase 2 v1)
- [ ] Timeline affiche les mails entrants (Phase 2 v2)
- [ ] Filtres séparés "envoyés" / "reçus"
- [ ] Tests Vitest endpoint + source-level
- [ ] Mega battery E2E couvre le flow mail
