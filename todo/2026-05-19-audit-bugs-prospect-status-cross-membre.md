# 2026-05-19 — Audit bugs prospection : désync statut + visibilité cross-membre

> **Demandé par Robert** (note `todo/apps/prospection/note-robert-todo-a-creer.txt`)
> **Auteur** : Agent Prospection
> **Type** : Audit + recommandations. **Pas de code** tant que Robert n'a pas
> tranché les options.

---

## TL;DR

Les bugs que tu décris ne sont **pas des bugs de rafraîchissement** ni de
cache, ce sont des bugs **structurels** :

1. **La table `outreach` a une PK `(siren, tenant_id)`** → il n'y a qu'**une
   seule ligne par lead par tenant**, partagée par tous les membres du
   workspace. Quand Bob ouvre une fiche, le `status` change pour **tout le
   monde**. Pas moyen d'avoir un "statut perso" par commercial sur le même
   lead.
2. **La visibility_scope `"all"` désactive complètement le filtre user**
   (`getUserFilter` ligne 173-180 → retourne null) → un user "all" voit
   tous les outreach de tous ses collègues mélangés dans `/historique`
   comme s'ils étaient les siens.
3. **`/prospects` ne filtre PAS sur `status != 'a_contacter'`** → un lead
   en négociation par Bob reste visible dans la liste de découverte de
   tous les autres. Robert dit : "*ceux qui ont un autre statut que à
   contacter ne devraient jamais être visibles dans la page prospection*".
4. **`recordVisit` (auto-trigger à l'ouverture de fiche) set le status à
   `fiche_ouverte` pour tout le tenant** → ouvre un lead = bloque le lead
   pour tous les autres, en valeur dégradée (`fiche_ouverte` ≠ "a contacter").

---

## Pré-requis : modèle mental métier (à confirmer par Robert)

D'après ta description :

| Vue | Doit afficher |
|---|---|
| `/prospects` (découverte) | Leads **frais** : pas d'outreach OU outreach `status = 'a_contacter'`. Si un collègue a déjà ouvert/contacté → **disparaît** de ma vue (sauf admin). |
| `/historique` | **MES** fiches consultées (pas celles des collègues). Le statut affiché = celui qui correspond à ma propre interaction. |
| `/pipeline` | **MES** deals en cours (déjà partiellement OK). |
| Admin (`/admin`) | Voit tout (override). |

**Question 1 — visibilité cross-membre** :
- **Option A (cloisonnement strict)** : chaque commercial voit uniquement
  ses propres leads ouverts. Si Bob ouvre `XYZ`, Carole ne le voit plus du
  tout — ni dans découverte (caché), ni dans historique (pas le sien).
  Modèle "territoire commercial pur".
- **Option B (cloisonnement softer)** : Bob ouvre `XYZ`, Carole ne le voit
  plus dans `/prospects` (pour pas qu'elle gaspille son temps), mais
  l'admin peut réassigner si besoin.

→ **Probablement Option A** d'après ton message ("les leads ouverts ne
soient pas affichés aux autres membres"). À confirmer.

**Question 2 — statut par membre vs statut partagé** :
- **Option A (status partagé par lead, owner exclusif)** : 1 lead =
  1 outreach = 1 status = 1 owner (`user_id`). Pas de notion de "statut
  perso par membre". C'est cohérent avec la table actuelle. Le bug n'est
  pas le statut mais la visibilité (cf Q1).
- **Option B (status perso par couple `user`+`lead`)** : il faut
  permettre que Bob ait le lead en "négo" et Carole l'ait en
  "a_contacter". Requiert refactor PK outreach en `(siren, tenantId, userId)`
  et migration data. **Beaucoup plus invasif.**

→ **Probablement Option A** : un lead n'a qu'un seul propriétaire dans la
relation commerciale. À confirmer.

---

## Inventaire détaillé des bugs

### Bug 1 — `/historique` montre les outreach des autres membres avec leur statut

**Fichiers** :
- `src/app/api/history/route.ts:11` → `getHistoryLeads(200, tenantId)` — ne passe **pas** d'userId.
- `src/lib/queries/leads.ts:217-234` (`getHistoryLeads`) — query brute :
  ```sql
  WHERE o.last_visited IS NOT NULL AND e.is_registrar=false AND NOT COALESCE(e.ca_suspect,false)
  ```
  Aucun filtre `o.user_id`. Le LEFT JOIN outreach (cf `buildLeadsSelect`)
  ne filtre que par `tenant_id`.
- `src/lib/queries/shared.ts:96` (`buildLeadsSelect`) — `LEFT JOIN outreach o ON o.siren = e.siren AND o.tenant_id = '<tid>'`. Pas de jointure user.

**Conséquence** : si Bob consulte 3 fiches et Carole 5 autres, `/historique`
de Bob montre les 8 fiches avec le statut courant de la ligne `outreach`
partagée — qui peut avoir été modifié par n'importe lequel des deux.

**Fix recommandé** :
1. Passer `userId` à `getHistoryLeads(limit, tenantId, userId)`.
2. Soit ajouter une table `outreach_visits` séparée `(siren, tenantId, userId, visited_at, status_at_visit)` — coûteux.
3. Soit (plus simple, cohérent avec Q1=A et Q2=A) : filtrer
   `WHERE o.user_id = <userId>` → l'historique = mes outreach (que j'ai
   ouverts ou contactés). On perd la sémantique "fiches consultées" pure
   au profit de "fiches dans mon territoire". Acceptable ?

### Bug 2 — `/prospects` n'exclut pas les outreach non-`a_contacter`

**Fichiers** :
- `src/app/api/prospects/route.ts:163-170` — récupère `userFilter` via
  `getWorkspaceScope()`. Si visibility=`all` → null. Si `own` → userId.
- `src/lib/queries/prospects.ts:374-377` — `if (filters.userFilter) clauses.push("o.user_id = ?")` — filtre **inclusif**, pas exclusif.

**Conséquence** :
- Un user `all` voit **tous** les leads, y compris ceux en négo par d'autres.
- Un user `own` voit **seulement** ses propres outreach existants, donc
  **rien** s'il n'a pas encore travaillé sur des leads (catastrophique pour
  un nouveau commercial).

**Fix recommandé** sur `/prospects` (peu importe scope) :
```sql
-- Toujours appliquer :
AND (
  o.siren IS NULL                                      -- jamais touché
  OR (o.user_id = '<currentUserId>' AND o.status = 'a_contacter')  -- mes leads frais
)
-- Admin override : si isAdmin && (param ?showAll=1), pas de filtre.
```

→ Logique : sur `/prospects` (page de découverte), on ne montre que ce qui
est **à contacter par moi** ou **non-touché**.

### Bug 3 — `recordVisit` "tag" tout le tenant à `fiche_ouverte`

**Fichiers** :
- `src/app/api/leads/[domain]/route.ts:38` — `recordVisit(siren, tenantId, workspaceId, userId)` appelé à chaque GET fiche.
- `src/lib/queries/pipeline.ts:254-283` (`recordVisit`) — UPSERT sur
  `(siren, tenant_id)` qui :
  1. Met `last_visited = NOW()`
  2. Force `status` à `'fiche_ouverte'` si nul/`a_contacter`
  3. Force `user_id` à celui qui a cliqué (via `COALESCE(EXCLUDED.user_id, outreach.user_id)`)
  4. Set `pipeline_stage` à `'fiche_ouverte'`

**Conséquence catastrophique** : Bob clique un lead sur `/prospects` →
le lead passe à `fiche_ouverte` côté DB → si Carole rafraîchit
`/prospects` 5 secondes plus tard, soit elle ne le voit plus (filtre
status), soit elle le voit en `fiche_ouverte` (bizarre, je ne l'ai pas
ouvert moi). Pire : le `user_id` se fige à **celui qui a cliqué en
premier** → Bob a maintenant ce lead "verrouillé" implicitement.

C'est **probablement la racine** de "*les leads ouverts ne soient pas
affichés aux autres membres*". Le mécanisme existe déjà (record_visit set
owner + fiche_ouverte), il manque juste le filtrage côté `/prospects`.

**Fix recommandé** : garder `recordVisit` tel quel (c'est la mécanique
d'assignation implicite), mais **filtrer `/prospects` cf Bug 2**.

### Bug 4 — Visibility scope `"all"` casse le contrat métier

**Fichier** : `src/lib/auth/user-context.ts:173-180` (`getUserFilter`).

Actuel :
```ts
if (ctx.isAdmin) return null;
const active = ctx.workspaces.find(...) ?? ctx.workspaces[0];
return active.visibilityScope === "own" ? ctx.userId : null;
```

**Problème** : si visibility=`all`, retourne `null` → aucun filtre. C'est
le default des nouveaux membres.

**Fix recommandé** : la sémantique de `visibility_scope` devrait être
"qu'est-ce que je vois en historique / pipeline" — pas une porte ouverte
sur la découverte. Sur `/prospects`, ignorer le scope et **toujours
appliquer le filtre cf Bug 2**. Sur `/historique` et `/pipeline` :
- `own` (default) → mes outreach uniquement
- `all` → tous les outreach du workspace (mode chef d'équipe / superviseur)

### Bug 5 — Le pipeline ignore aussi le scope par défaut

**Fichier** : `src/app/api/pipeline/route.ts` (à vérifier — je n'ai pas lu
mais cf `src/lib/queries/pipeline.ts:49-105`, `getPipelineLeads` accepte
`userFilter` qui est passé via `getWorkspaceScope()` → même bug que Bug 4
pour les users en `all`.)

### Bug 6 — Dette technique : logique status dispersée

Le filtrage par status / user_id est répété dans 5 fichiers différents
sans helper commun :

- `src/lib/queries/shared.ts:94-225` (buildLeadsSelect, COLUMN_MAP)
- `src/lib/queries/prospects.ts:374-377` (userFilter dans buildFilterWhere)
- `src/lib/queries/pipeline.ts:101-102` (status != 'a_contacter' + userFilter inline)
- `src/lib/queries/leads.ts:217-234` (getHistoryLeads sans userFilter)
- `src/lib/queries/segments.ts:97` + `137` (mêmes COALESCE/COLUMN_MAP)
- `src/lib/queries/stats.ts:25` (status != 'a_contacter' hardcoded)

→ **Refactor cible** : un module `src/lib/queries/visibility.ts` exportant :
```ts
export function buildOutreachJoin(scope: {
  tenantId: string;
  userId?: string | null;
  scope: 'all' | 'own' | 'discovery';
}): string;

export function buildVisibilityWhere(scope: ...): string;
```
appelé par chaque query → 1 seule source de vérité.

### Bug 7 — `recordVisit` écrase silencieusement le `user_id` legacy

`COALESCE(EXCLUDED.user_id, outreach.user_id)` ligne 281 :
- Si la ligne existait avec `user_id=Bob` → reste Bob (OK)
- Si la ligne existait avec `user_id=NULL` (legacy import sans owner)
  → la **première** ouverture par Carole la fige à Carole, sans qu'on
  ait demandé "veux-tu réclamer ce lead ?".

C'est un effet de bord acceptable si on assume Q1=A (auto-assignation à
l'ouverture). À documenter dans le code.

### Bug 8 — Page admin pour réassigner / unlock manquant

Si Bob "trust-blocks" un lead par accident (juste cliqué pour voir) puis
part en vacances, Carole ne peut pas le récupérer sans :
- Soit forcer un UPDATE SQL manuel
- Soit une UI admin `/admin/members/<id>/reassign-leads`

→ **À ajouter** : bouton "libérer ce lead" sur la fiche pour l'owner +
réassignation admin. Hors scope immédiat.

---

## Plan de fix proposé (à valider)

### Étape 1 — Refactor visibility (2h)

Créer `src/lib/queries/visibility.ts` :
```ts
type VisibilityMode = 'discovery' | 'mine' | 'team' | 'admin';

/**
 * - discovery : page /prospects → leads non touchés OU mes a_contacter
 * - mine      : historique/pipeline → mes outreach (any status)
 * - team      : visibility_scope=all dans WorkspaceMember → tous outreach du workspace
 * - admin     : tenant admin → tous outreach du tenant
 */
export function buildOutreachClause(opts: {
  mode: VisibilityMode;
  tenantId: string;
  userId: string;
  workspaceIds: string[] | null;  // null = tous (admin)
}): { joinClause: string; whereClause: string };
```

Migrer chaque query (`getProspects`, `getHistoryLeads`, `getPipelineLeads`,
segments, stats) pour utiliser ce helper.

### Étape 2 — Filtrer `/prospects` (15 min)

Modifier `src/app/api/prospects/route.ts` :
- Toujours appliquer `mode: 'discovery'` (peu importe scope).
- Admin peut passer `?showAll=1` pour bypass (UI optionnelle).

### Étape 3 — Filtrer `/historique` (15 min)

Modifier `src/app/api/history/route.ts` + `getHistoryLeads` :
- Passer `userId` + scope.
- Si scope `own` → `mode: 'mine'`
- Si scope `all` ou admin → `mode: 'team'`

### Étape 4 — Tests (1h)

- Unit : `buildOutreachClause` × 4 modes × cas limites.
- Intégration Vitest avec Postgres réel : seed 2 users (Bob/Carole), 3 leads,
  vérifier que /prospects, /historique, /pipeline retournent les bonnes
  rows pour chaque user.
- E2E (Playwright) : `e2e/extended/visibility-cross-member.spec.ts`.

### Étape 5 — Migration data (5 min)

Vérifier qu'il n'y a pas en prod de lignes outreach avec `user_id IS NULL`
en status non-`a_contacter` — sinon elles deviendraient invisibles.
```sql
SELECT COUNT(*) FROM outreach
WHERE user_id IS NULL AND status != 'a_contacter';
```

### Étape 6 — Doc + UI (1h)

- Settings → ajouter info-bulle sur visibility_scope ("all" / "own").
- Lead sheet : badge "ouvert par <prénom>" + bouton "libérer" si owner=moi.

**Estim. total** : ~4-5h focus.

---

## À trancher avant de coder

- [ ] **Q1** : Option A (cloisonnement strict) ou B (softer) ?
- [ ] **Q2** : Status partagé par lead (Option A) ou perso par membre (Option B refactor PK) ?
- [ ] **Q3** : Auto-assignation à l'ouverture (`recordVisit` qui fige
  `user_id`) ou opt-in explicite (bouton "prendre ce lead") ?
- [ ] **Q4** : Quoi faire des leads legacy `user_id IS NULL` en status
  avancé ? Les laisser visibles à tous, ou les attribuer à l'admin tenant
  par défaut ?
- [ ] **Q5** : Workspaces multiples par tenant — un commercial peut être
  dans 2 workspaces. Sa visibilité doit-elle s'additionner ? Aujourd'hui
  `getWorkspaceFilter` retourne `ctx.workspaces.map(w => w.id)` → tous
  les workspaces dont il est membre. C'est OK ?

---

## Annexe — Schéma cible

```
[Lead/Entreprise] ──1:N──> [Outreach (siren, tenantId)]
                                │
                                ├─ user_id      = owner exclusif
                                ├─ workspace_id = workspace assignation
                                ├─ status       = stage actuel
                                └─ last_visited = dernière interaction owner

VISIBLE SUR /prospects pour Bob (member, scope=own) :
  → outreach IS NULL  OR  (user_id=Bob AND status='a_contacter')

VISIBLE SUR /historique pour Bob :
  → user_id=Bob AND last_visited IS NOT NULL

VISIBLE SUR /pipeline pour Bob :
  → user_id=Bob AND status != 'a_contacter'

ADMIN (Robert) : voit tout, partout. Peut réassigner.
```
