# [PROSPECTION] Feature mail SMTP/IMAP — inbox prospects + envoi sortant

> **Type** : Feature majeure (intégration mail bidirectionnelle)
> **Sévérité** : 🟡 P1 — différenciation forte vs Apollo/Kaspr, demandé pour pouvoir échanger des mails depuis Prospection avec les prospects du pipeline sans quitter l'app
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Demandeur** : Robert
> **Cadrage 2026-05-23** : découpé en v1 / v2 sur arbitrage Robert
>   - **v1 (à livrer)** : SMTP envoi + bouton "Envoyer mail" sur fiche lead + templates pré-définis (variables liquid). Pas d'IMAP, pas d'inbox réception, pas de worker background.
>   - **v2 (bonus, ticket dérivé)** : IMAP réception → alimente la **page historique prospect 360** (cf `todo/2026-05-23-fiche-historique-prospect-360.md`). Pas une inbox cross-prospects standalone, mais une timeline mails par prospect dans sa fiche historique.
>   - Pas de copie cross-prospect/inbox globale dans la v1. La timeline mail vit dans la fiche historique du prospect concerné.

## ✅ Statut v1 — LIVRÉE EN PROD 2026-05-25 (SHA 4f0cee6)

**v1 SMTP + IA livrée** : Agent Q vague 5 (commit 6b7892e) + Agent V vague 6 batteries tests (ebb88da) + Agent W vague 6 IA templates (4f0cee6).

Composants prod actifs :
- Migration 0022 tenant_mail_config + lead_emails
- Migration 0024 tenant_ai_config
- src/lib/mail/ + src/lib/crypto/encrypt-password.ts
- src/lib/ai/ (4 providers BYO clé chiffrée AES-256-GCM)
- Routes /api/mail/{config,send,test-connection,generate,ai-config}
- Page /settings/mail (onglets SMTP + IA)
- 5 specs E2E flows-mail + 110 unit tests Vitest

**Ce qui reste — v2 IMAP** (ce ticket reste pending pour ça) :
- Worker IMAP container séparé qui poll/IDLE
- Réception mails → table lead_emails (direction=incoming)
- Alimente Phase 2 fiche historique 360° (cf `todo/2026-05-24-fiche-360-phase-2-mails.md`)
- Page /inbox globale (filtre rattaché/non-rattaché)

## Vision

Permettre au commercial d'**envoyer** et **recevoir** ses mails directement depuis l'app Prospection, en utilisant ses propres credentials SMTP/IMAP (BYO — Bring Your Own). Pas besoin de quitter Prospection pour rédiger une réponse à un prospect : l'inbox + le compose vivent dans la fiche lead ou dans un onglet dédié.

**Différenciation business** : Apollo et Kaspr poussent leur propre infra mail (relay + tracking) — coûteux et opaque. Veridian Prospection laisse l'user contrôler 100% son canal mail (DKIM/SPF de son domaine, pas d'envoi via tiers, RGPD propre).

## Ne PAS confondre avec Notifuse

- **Notifuse** = envoi TRANSACTIONNEL plateforme Veridian (invitations, notifications système, mails automatisés). Déjà câblé via `src/lib/notifuse/client.ts`. **Owner = Veridian** côté mail server.
- **Cette feature** = envoi + réception mail PERSONNEL du commercial avec **ses** credentials. Pas de relay Veridian. **Owner = le user** côté mail server.

## Périmètre v1

### Configuration

- Page `/settings/mail` (nouvelle) :
  - Onglet SMTP (envoi) : host, port, username, password (ou OAuth), TLS/STARTTLS, from address
  - Onglet IMAP (réception) : host, port, username, password (ou OAuth), TLS/SSL, dossiers à monitorer (INBOX par défaut, custom mappable)
  - Bouton "Tester la connexion" (smoke SMTP + IMAP avant save)
  - Stockage : `tenants.smtp_config` + `tenants.imap_config` (JSONB chiffré, à voir le schéma préféré)

### Envoi sortant

- Bouton "Envoyer un mail" dans la fiche lead (`lead-sheet`) — pré-rempli avec l'email du contact si dispo
- Compose modal avec : To, Cc, Subject, Body (HTML + plain text fallback), pièces jointes
- Templates : variables liquid sur nom/société du prospect (réutiliser le pattern Notifuse — `{{ prospect.name }}`, etc.)
- Send via SMTP avec les creds tenant
- Trace côté DB : `outreach_emails` (table déjà supprimée 2026-05-22, à recréer avec un schéma moderne — sujet à trancher) OU nouvelle table `lead_emails`

### Réception

- Worker IMAP background (cron node ? job container séparé ?) qui poll/IDLE la boîte
- Pour chaque mail entrant :
  - Parse headers (From, Subject, In-Reply-To, References, Message-ID)
  - Match avec un prospect du workspace via email From → si match, attache à la fiche
  - Si pas de match : inbox "non rattaché" visible dans `/settings/mail/inbox` pour rattachement manuel
- Notification temps réel (push web) ou indicateur dans la nav

### UI

- Fiche lead : nouvelle section "Conversation mail" avec timeline des échanges (sortants + entrants), threading via `In-Reply-To`/`References`
- Onglet `/inbox` global : timeline cross-prospects, filtre "rattaché / non-rattaché"

## Architecture

### Choix techniques à trancher

1. **Worker IMAP** : process séparé (container Docker dédié) ou cron Node tâche dans l'app principale ? Reco : **container séparé** pour ne pas bloquer l'app (IMAP IDLE = connection longue durée, mal supporté par serverless / Vercel-like).
2. **Stockage mails** : intégral en DB (lourd) ou juste métadonnées + lien IMAP UID (léger mais dépendance à la persistance serveur user) ? Reco : **métadonnées + body parsé en DB** (snapshot durable, indexable). Pas de copie pièces jointes (lien vers serveur user via URL signée).
3. **Auth SMTP** : password en clair chiffré OU OAuth pour Gmail/Outlook/Microsoft ? V1 = **password chiffré** (universel). V2 = ajouter OAuth providers.
4. **Lib** : `nodemailer` (envoi SMTP standard) + `node-imap` / `imapflow` (réception IMAP) — éprouvés.
5. **Chiffrement** : password SMTP/IMAP en DB chiffré avec `AUTH_SECRET` (already en env) via `crypto.createCipheriv`. Pas en clair.

### Modèle DB

```prisma
model TenantMailConfig {
  id            String  @id @default(uuid()) @db.Uuid
  tenantId      String  @unique @map("tenant_id") @db.Uuid
  tenant        Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // SMTP (envoi)
  smtpHost      String? @map("smtp_host")
  smtpPort      Int?    @map("smtp_port")
  smtpUsername  String? @map("smtp_username")
  smtpPasswordEnc String? @map("smtp_password_enc")  // chiffré AES-256-GCM
  smtpTls       Boolean @default(true) @map("smtp_tls")
  smtpFromEmail String? @map("smtp_from_email")
  smtpFromName  String? @map("smtp_from_name")

  // IMAP (réception)
  imapHost      String? @map("imap_host")
  imapPort      Int?    @map("imap_port")
  imapUsername  String? @map("imap_username")
  imapPasswordEnc String? @map("imap_password_enc")
  imapTls       Boolean @default(true) @map("imap_tls")
  imapFolders   String[] @default(["INBOX"]) @map("imap_folders")

  // Statut sync IMAP
  lastSyncAt    DateTime? @map("last_sync_at") @db.Timestamptz
  lastSyncError String?   @map("last_sync_error")

  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@map("tenant_mail_config")
}

model LeadEmail {
  id            String  @id @default(uuid()) @db.Uuid
  tenantId      String  @map("tenant_id") @db.Uuid
  workspaceId   String  @map("workspace_id") @db.Uuid

  // Référence au prospect (siren)
  siren         String?
  // Direction du mail
  direction     String  // "outgoing" | "incoming"

  // Headers normalisés
  messageId     String  @unique @map("message_id") @db.VarChar(255)
  inReplyTo     String? @map("in_reply_to") @db.VarChar(255)
  references    String? @map("references") // CSV des Message-IDs parents

  fromEmail     String  @map("from_email") @db.VarChar(320)
  fromName      String? @map("from_name") @db.VarChar(120)
  toEmails      String[] @map("to_emails")
  ccEmails      String[] @default([]) @map("cc_emails")

  subject       String? @db.VarChar(500)
  bodyText      String? @map("body_text")
  bodyHtml      String? @map("body_html")

  // Métadonnées
  receivedAt    DateTime? @map("received_at") @db.Timestamptz
  sentAt        DateTime? @map("sent_at") @db.Timestamptz
  imapUid       Int?      @map("imap_uid")
  imapFolder    String?   @map("imap_folder")

  // Statut envoi sortant
  sentStatus    String?   @map("sent_status") // "queued" | "sent" | "failed"
  sentError     String?   @map("sent_error")

  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz

  @@index([tenantId, workspaceId, siren, sentAt])
  @@index([tenantId, fromEmail])
  @@map("lead_emails")
}
```

## Sécurité

- **Password SMTP/IMAP** : chiffrement AES-256-GCM avec `AUTH_SECRET` (ne JAMAIS stocker en clair)
- **OAuth bonus v2** : tokens Gmail/Outlook avec scope minimal (envoi + lecture INBOX only)
- **IDOR** : tous les calls API/DB filtrent sur `workspaceId` du caller (cf pattern `lib-tests-coverage`)
- **DKIM/SPF** : doc explicite pour l'user comment configurer le DNS de son domaine pour que ses mails ne tombent pas en spam (responsabilité user, pas Veridian)
- **RGPD** : les mails restent chez l'user (pas de copie chez Veridian sauf snapshot metadata DB). Possibilité d'export/purge par tenant.

## Tests

### Unit
- SMTP client : mock nodemailer, vérifier le payload (To, Subject, body), gestion erreur connection
- IMAP client : mock imapflow, parsing headers, threading via In-Reply-To
- Chiffrement password : encrypt/decrypt round-trip + ne JAMAIS sortir le password en clair en logs

### E2E
- User configure SMTP → "Tester connexion" → OK
- Envoie mail depuis fiche lead → vérifier que mail apparaît dans la timeline
- Mail entrant (test inbox dédié) → vérifier rattachement automatique au lead matching

## Effort

- Modèle DB + migrations : ~2h
- Crypto password : ~2h (utilities + tests)
- Page `/settings/mail` UI : ~6h (2 onglets, validation, test connection)
- Envoi SMTP côté serveur (route POST + nodemailer wrapper + queue) : ~4h
- Worker IMAP réception (container séparé, poll) : ~1 jour (~8h)
- Threading + matching prospect : ~4h
- UI timeline conversation dans lead-sheet : ~4h
- Inbox globale `/inbox` : ~4h
- Tests : ~6h
- **Total : ~4-5 jours**. Tier 🔴 HAUT (PII + connexion infra externe + worker).

## Risques

- **IMAP IDLE qui drop** : retry/reconnect propre, alerte si plus de sync depuis X minutes
- **Spam outbound** : l'user qui envoie depuis SMTP mal configuré (DKIM/SPF cassé) peut se prendre des bounces — alerter clairement dans l'UI
- **Volume** : un user actif = 100s mails/jour. Pas un problème pour Postgres mais à monitorer
- **Worker container** : nouvelle pièce d'infra à monitorer (cf veridian-docker-monitor)

## Coordination

Pas de dépendance cross-app forte — 100% Prospection. Mais si plus tard on veut **partager** les mails entre tenants (rare), prévoir endpoint Hub.

## Définition de done

- [ ] Migration Prisma TenantMailConfig + LeadEmail + index
- [ ] Lib crypto AES-256-GCM (encrypt/decrypt password)
- [ ] Page `/settings/mail` 2 onglets + bouton test connexion
- [ ] API `/api/mail/send` (route POST avec rate limit)
- [ ] Worker IMAP container séparé + monitoring
- [ ] Section "Conversation" dans lead-sheet
- [ ] Page `/inbox` globale + filtre rattaché/non-rattaché
- [ ] Tests Vitest unit (crypto + clients SMTP/IMAP mockés)
- [ ] E2E flow envoi + réception sur inbox dédiée test
- [ ] Doc DKIM/SPF dans `/settings/mail`

## Référence

- `tenants.smtp_config` + `imap_config` JSONB déjà imaginé dans une vieille spec ? À vérifier
- Notifuse à ne PAS confondre : `src/lib/notifuse/client.ts` (mail transactionnel plateforme, pas BYO user)
- Lib mail prévues : `nodemailer` (SMTP), `imapflow` (IMAP)
- Pattern crypto : `AUTH_SECRET` déjà disponible côté env

## Lien éventuel avec autres features

- **Refill leads** : pas de lien
- **Pipeline stages custom** : la conversation mail peut être un déclencheur de changement de stage (futur, hors v1)
- **Hub** : aucun impact
