# [PROSPECTION] Pipeline — voir le pipeline d'un autre membre du workspace (view-as)

> **Type** : Feature multi-membre / pilotage équipe
> **Sévérité** : 🟡 P1 — bloque le cas d'usage "manager d'équipe commerciale qui veut suivre l'avancement de ses commerciaux". Sans ça, un workspace multi-membre est un dashboard collectif sans visibilité par membre.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Demandeur** : Robert
> **⚠️ Statut** : 🟡 EN ATTENTE CADRAGE — Robert a dit "j'ai trouvé une
> solution" le 2026-05-23 sans la détailler. NE PAS lancer un agent
> avant qu'il ait précisé son approche (peut différer de la spec
> ci-dessous, ex : impersonate complet via Hub vs filtre view-as local).
> Garder ce ticket en référence pour le cadrage à venir.

## Besoin

Dans un workspace multi-membre, un user avec `visibilityScope=all` (typiquement le manager/owner) doit pouvoir **voir le pipeline d'un autre membre du même workspace** pour suivre son état d'avancement (qui a contacté qui, quelle étape kanban, dernière interaction).

Pas un vrai "login as" qui ouvre une session sous l'identité de l'autre — c'est juste un **filtre de vue** sur le pipeline existant. L'audit log reste sur l'identité réelle du viewer.

## Ce qui existe déjà (bonne nouvelle)

- `WorkspaceMember.visibilityScope` : `"all"` (voit tous les outreach du workspace) vs `"own"` (voit uniquement les siens). Posé en schéma Prisma.
- `outreach.user_id` : chaque ligne de pipeline a un owner. Le filtre est déjà implémenté dans `src/lib/queries/pipeline.ts:104` :
  ```
  ${userFilter ? `AND o.user_id = '${userFilter}'` : ""}
  ```
- `/api/me` retourne `workspaces[].members[]` (vérifier — sinon ajouter)
- L'admin Hub a un endpoint `admin/impersonate` mais c'est un VRAI login as (régénère token, ouvre session sous l'identité). Pas ce qu'on veut ici.

## Ce qu'il faut ajouter

### Backend

1. **`/api/pipeline`** : accepter un query param `?viewAsUserId=<uuid>` :
   - Vérifie côté serveur que l'appelant a `visibilityScope=all` sur le workspace courant ET que `viewAsUserId` est bien un membre du même workspace (sinon 403). C'est CRITIQUE — sans ces deux checks, n'importe quel membre peut voir le pipeline de n'importe qui d'autre.
   - Si OK, passe `userFilter=viewAsUserId` à `listPipelineCards()` (ou équivalent — cf `src/lib/queries/pipeline.ts`).
   - Sinon (scope=own ou viewAsUserId d'un autre workspace) → 403, logger un warn audit (`audit.ts` a déjà `admin.impersonate`, ajouter `pipeline.view_as_other_member` ? À voir).
2. **`/api/workspaces/[id]/members`** ou équivalent : endpoint qui liste les membres du workspace courant avec leur rôle et email — utilisé par l'UI pour peupler le sélecteur. Vérifier s'il existe déjà (cherche `src/app/api/admin/members/` ou `src/app/api/workspaces/`).
3. **Audit log** : chaque consultation pipeline avec `viewAsUserId` différent du caller → ligne dans `audit_events` (`event="pipeline.view_as"`, `target_user_id=viewAsUserId`, `actor_user_id=caller`). Permet d'enquêter si un member abuse.

### Frontend

1. **Sélecteur "Voir le pipeline de" dans `/pipeline`** :
   - Visible UNIQUEMENT si `useSession().user` a `scope=all` (passer `scope` dans la session via callback Auth.js, ou refetch `/api/me`)
   - Dropdown qui liste les membres du workspace (label = email + nom)
   - Sélection par défaut = "Moi" (= pas de param `viewAsUserId`)
   - Quand on sélectionne un autre membre → l'URL devient `/pipeline?viewAsMember=<email-ou-uuid>` (préfère email pour la lisibilité de l'URL, conversion côté serveur)
   - Le composant `pipeline-board.tsx` lit ce param et l'envoie à `/api/pipeline`
2. **Banderole "Vous regardez le pipeline de Bob (consultation only)"** quand le filtre est actif, avec un bouton "Revenir au mien".
3. **Read-only quand on view-as** : pas de drag-and-drop kanban, pas d'édition d'outreach, pas de création de followup. Greyed-out + tooltip "Vous consultez le pipeline d'un autre membre — actions désactivées". Sinon le viewer pourrait modifier le travail de Bob, ce qui n'est pas le besoin.
4. Mobile : sélecteur dans le burger ou en haut de la vue pipeline (`pipeline-view.tsx`).

### UX décisions à trancher avant code

- **Qui peut viewer qui ?** Reco : `scope=all` sur le workspace → peut viewer TOUS les membres du même workspace. Pas plus granulaire pour la v1.
- **Affichage des stats par membre ?** Reco v1 : non, on garde juste la vue pipeline filtrée. Stats par membre = ticket séparé si demandé.
- **Mode "voir tout le monde en même temps" (vue manager) ?** Reco v1 : non, juste "moi" vs "un autre membre". Vue agrégée par owner = ticket séparé.
- **Persistance de la sélection** : reco v1 = via URL param uniquement, pas de cookie. Fermer l'onglet = retour à "moi".

## Garde-fous sécu (anti-CVE)

Trois vérifications côté API ABSOLUMENT obligatoires :

```ts
// 1. Le caller doit avoir scope=all
const callerMember = await prisma.workspaceMember.findFirst({
  where: { workspaceId, userId: callerUserId, deletedAt: null },
});
if (!callerMember || callerMember.visibilityScope !== "all") {
  return 403;
}

// 2. La cible doit être un membre du même workspace
const targetMember = await prisma.workspaceMember.findFirst({
  where: { workspaceId, userId: viewAsUserId, deletedAt: null },
});
if (!targetMember) {
  return 403;
}

// 3. Le workspace doit être actif (pas soft-deleted)
const workspace = await prisma.workspace.findUnique({
  where: { id: workspaceId },
  select: { deletedAt: true },
});
if (!workspace || workspace.deletedAt) {
  return 404;
}
```

Sans ces 3 checks, n'importe quel membre pourrait sniffer le pipeline de n'importe qui d'autre via un simple query param. **C'est le vrai risque sécu de la feature.**

## Tests obligatoires

### Unit (Vitest)
- `viewAsUserId` accepté si caller `scope=all` + target dans le même workspace → 200
- `viewAsUserId` refusé si caller `scope=own` → 403
- `viewAsUserId` refusé si target dans un AUTRE workspace → 403
- `viewAsUserId` refusé si target user n'existe pas → 403 (pas 404, on ne révèle pas l'existence)
- `viewAsUserId` accepté sur soi-même (pas de filtre, no-op) → 200
- Audit event posé dès qu'on view-as un membre différent du caller

### E2E (Playwright, à brancher avec le sprint coverage E2E)
- Spec "manager view-as commercial" : login admin scope=all → /pipeline → sélectionne Bob → URL change → cards de Bob s'affichent → drag-and-drop désactivé.
- Spec "commercial ne peut pas view-as son collègue" : login member scope=own → /pipeline → pas de sélecteur visible → forcer le param URL → 403.

## Effort

- Backend : ~3h (1 endpoint à étendre + 1 nouvel endpoint members + audit + tests)
- Frontend : ~4h (sélecteur + banderole + read-only states + responsive)
- E2E : ~2h (2 specs avec setup multi-membre)
- Total : ~1 jour. Tier 🔴 HAUT (auth/scope cross-membre sensible).

## Référence

- Schéma : `prisma/schema.prisma:WorkspaceMember.visibilityScope`
- Filtre déjà câblé : `src/lib/queries/pipeline.ts:104` (userFilter)
- Pattern admin.impersonate Hub (différent, à NE PAS confondre) :
  `src/app/api/admin/impersonate/route.ts` + memory `feedback_team_lead_mode_sprint`

## Coordination

Pas de dépendance cross-app forte — c'est 100% Prospection, pas besoin de toucher Hub ou autres. Mais si le sélecteur de workspace actif (multi-workspace user) se généralise, brancher dans la même UX (« workspace courant » + « voir le pipeline de [membre] »).
