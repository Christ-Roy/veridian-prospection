# [PROSPECTION] Audit code Supabase résiduel — bombes silencieuses post-migration Auth.js v5

> **Type** : Dette critique / risque prod silencieux
> **Sévérité** : 🔴 P0 (audit) puis P1-P0 par bombe trouvée
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Déclencheur** : hotfix invitations 2026-05-23 — `src/lib/invitations.ts`
>   appelait toujours Supabase GoTrue (mort), bug invisible jusqu'à ce qu'un
>   admin tente d'inviter quelqu'un.

## Constat

La migration Supabase → Auth.js v5 a été faite en plusieurs sprints
(2026-05-19, 2026-05-20). Mais le hotfix 2026-05-23 a révélé qu'**au
moins un fichier critique** (`src/lib/invitations.ts`) tapait encore sur
des endpoints Supabase morts depuis 5 jours, en silence.

**Question** : combien de bombes du même genre dorment encore ?

## Surface suspecte (grep partiel 2026-05-23 sur src/)

```
src/app/api/segments/route.ts:6:                       import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/checkout/route.ts:3:                       import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/segments/[...slug]/route.ts:5:             import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/outreach/[domain]/route.ts:5:              import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/settings/route.ts:4:                       import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/phone/telnyx-token/route.ts:3:             import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/phone/presence/route.ts:4:                 import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/phone/summarize-call/route.ts:4:           import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/phone/server-call/route.ts:4:              import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/phone/call-log/route.ts:4:                 import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/followups/route.ts:4:                      import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/followups/[id]/route.ts:4:                 import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/stats/today/route.ts:4:                    import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/history/route.ts:4:                        import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/stats/route.ts:5:                          import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/prospects/route.ts:7:                      import { getTenantId, getTenantProspectLimit } from "@/lib/supabase/tenant";
src/app/api/leads/route.ts:4:                          import { getTenantId, getTenantProspectLimit } from "@/lib/supabase/tenant";
src/app/api/stats/overview/route.ts:4:                 import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/leads/[domain]/route.ts:4:                 import { getTenantId, getTenantProspectLimit } from "@/lib/supabase/tenant";
src/app/api/pipeline/route.ts:4:                       import { getTenantId } from "@/lib/supabase/tenant";
src/app/api/tenants/attach-owner/route.ts:85:          data: { id: userId, email: owner_email, supabaseUserId: userId },
src/lib/hub/identity.ts:83:                            supabaseUserId: hubUserId,
src/lib/auth/user-context.ts:2: * Auth.js v5 user context resolution — remplace src/lib/supabase/user-context.ts
src/lib/auth/api-auth.ts:2: * Auth.js v5 — équivalent de src/lib/supabase/api-auth.ts
```

20+ fichiers importent toujours depuis `@/lib/supabase/*`. **Statut
réel inconnu** : il faut auditer chacun pour distinguer :

- ✅ **Bridge legacy fonctionnel** : `@/lib/supabase/tenant` exporte
  encore `getTenantId` mais c'est en réalité du Prisma sous le capot
  (resolution multi-tenant via JWT → workspace_members) — pas de call
  Supabase réseau. Aucun risque.
- ⚠️ **Bombe potentielle** : import qui finit par hit une URL GoTrue
  (`/auth/v1/...`) ou un service externe disparu. Test fonctionnel
  obligatoire.
- 🗑️ **Mort** : import dans du code routé jamais appelé.

## Action — audit ligne par ligne

Pour chaque import `supabase` dans `src/` :

1. **Lire** le fichier de la dépendance importée (`src/lib/supabase/*`).
   Cherche `fetch(`, `auth/v1`, `gotrue`, `supabaseAdmin.from(` — tout
   ce qui appelle vers l'extérieur.
2. **Smoke** la route si elle existe : `curl -sk` sur l'endpoint en
   staging, vérifier qu'elle retourne pas 500 / `Supabase not configured`.
3. **Classer** :
   - Si fonctionnel (bridge Prisma) → laisser tel quel, juste un rename
     d'import pour la lisibilité (P3 propre).
   - Si bombe → ticket P0 immédiat, fixer comme invitations.ts.
   - Si mort → supprimer.

## Fichiers prioritaires à auditer (smoke order)

Endpoints de hot path Prospection (utilisés tous les jours par les
clients) — à smoker en priorité :

1. `src/app/api/prospects/route.ts` (le hot path #1 — page principale)
2. `src/app/api/pipeline/route.ts` (Kanban — vu tous les jours)
3. `src/app/api/leads/[domain]/route.ts` (clic sur fiche lead)
4. `src/app/api/stats/route.ts` + `stats/today` + `stats/overview` (dashboard)
5. `src/app/api/followups/route.ts` + `followups/[id]`
6. `src/app/api/history/route.ts`
7. `src/app/api/settings/route.ts`
8. `src/app/api/segments/route.ts` + `segments/[...slug]`
9. `src/app/api/outreach/[domain]/route.ts`
10. `src/app/api/checkout/route.ts`
11. `src/app/api/phone/*` (5 fichiers)
12. `src/app/api/tenants/attach-owner/route.ts` (supabaseUserId field)
13. `src/lib/hub/identity.ts` (supabaseUserId — vraisemblablement Prisma
    field nom legacy, pas un call ; à confirmer)

## Pourquoi P0

L'incident 2026-05-23 (invitations) a duré **5 jours** en prod sans
qu'aucun test ne le voit. Si une autre bombe du même genre vit dans
`src/app/api/prospects/route.ts` (le hot path), elle peut casser le
dashboard entier d'un coup.

**Délai cible** : audit complet sous 48h. Tickets P0 ouverts au fil
de l'eau pour chaque bombe trouvée.

## Bonus connexe à traiter en suivant

- `.env.example` porte encore 4 vars Supabase mortes (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SMTP_CONFIGURED`). Le pre-push warning du 2026-05-23 les
  flagge en "dette doc". À retirer une fois l'audit complet (sinon on
  croit qu'elles servent encore).
- Dossier `src/lib/supabase/*` lui-même : combien de fichiers ? Combien
  exportent du code mort vs des bridges encore utilisés ?

## Référence

- Hotfix invitations 2026-05-23 (commit `a5f38c0`)
- Ticket cousin : `todo/2026-05-23-e2e-coverage-flows-entiers.md` —
  les vrais tests E2E auraient attrapé ces bombes à temps.
