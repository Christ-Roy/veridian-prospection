# [PROSPECTION] Brancher Notifuse pour l'envoi du mail d'invitation

> **Type** : Feature / UX flow invitation
> **Sévérité** : 🟡 P1 — sans envoi automatique, l'admin doit copier-coller
>   le lien invitation manuellement à chaque nouveau membre. Acceptable
>   temporairement, pas viable long terme.
> **Owner** : agent Prospection (+ coordination avec notifuse-veridian)
> **Créé** : 2026-05-23
> **Suite directe de** : hotfix `a5f38c0` (migration invitations Supabase
>   Auth → Auth.js v5 Prisma). Le helper `createInvitation` retourne
>   maintenant `emailSent: false` car l'ancien envoi via Supabase
>   `generateLink` est mort. L'invitation existe en DB, le lien est dans
>   `inviteUrl` — mais aucun mail ne part automatiquement.

## Contexte

Avant la migration Auth.js v5, l'envoi du mail d'invitation passait par
`POST /auth/v1/admin/generate_link` de Supabase GoTrue (qui s'occupait
du templating + SMTP). Ce service n'existe plus.

**Maintenant** : `src/lib/invitations.ts:createInvitation` insère la row
en DB et retourne `{ id, token, inviteUrl, expiresAt, emailSent: false }`.
L'UI admin (`/admin/invitations`) doit afficher le lien pour qu'un admin
le copie-colle dans un mail manuel — clunky.

## Demande

Brancher l'envoi automatique du mail d'invitation via **Notifuse**
(plateforme mail Veridian, déjà en prod sur `notifuse.veridian.site`).

### Flow attendu

```
admin crée invitation
   ↓
POST /api/admin/invitations
   ↓
createInvitation()
   ↓
INSERT invitations + ENVOI VIA NOTIFUSE
   ↓
emailSent: true  (si Notifuse répond 2xx)
```

### Spec mail à créer côté Notifuse

Template Veridian invitation, variables `{{ inviterEmail }}`,
`{{ workspaceName }}`, `{{ inviteUrl }}`, `{{ expiresAt }}`. CTA bouton
"Accepter l'invitation". Branding Veridian. À discuter avec l'agent
Notifuse pour le template + la séquence.

### Côté Prospection — câbler

1. Importer le client Notifuse (déjà utilisé ? — `grep -rn notifuse src/`
   pour voir s'il y a déjà un helper, sinon créer
   `src/lib/notifuse/client.ts`).
2. Dans `createInvitation`, après l'INSERT, appel `notifuseClient.send({
   to: email, template: 'invitation-prospection', vars: { inviterEmail,
   workspaceName, inviteUrl, expiresAt }})`.
3. Gérer le `emailSent: bool` sur la valeur de retour de Notifuse (best-effort,
   ne pas casser la création de l'invitation si Notifuse 503).
4. Test Vitest : mock le client Notifuse, vérifie l'appel.
5. E2E (cf ticket `2026-05-23-e2e-coverage-flows-entiers.md` flow 1) :
   après création, vérifier qu'un mail de test arrive (boîte de test
   Notifuse, ou inbox jetable).

### Sécurité

- Le token d'invitation est dans le lien — assurer que l'URL est en HTTPS
  uniquement (déjà OK : `getInviteBaseUrl` → `APP_URL`).
- Pas de password ou autre PII dans le mail (juste lien + contexte).

## Pourquoi pas P0

L'admin peut toujours créer l'invitation et copier le lien manuellement
depuis l'UI admin (`/admin/invitations` affiche le `inviteUrl`). C'est
moche mais non bloquant pour le business. P1 — à traiter dans la semaine.

## Référence

- Hotfix invitations migration : commit `a5f38c0`
- `src/lib/invitations.ts:createInvitation` (TODO documenté dans le code)
- Notifuse staging : `notifuse.staging.veridian.site`
- Notifuse prod : `notifuse.app.veridian.site`
