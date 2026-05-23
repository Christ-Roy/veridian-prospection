# [PROSPECTION] Rename bridge `@/lib/supabase/tenant` → `@/lib/auth/tenant`

> **Type** : Hygiène / nommage trompeur
> **Sévérité** : 🔵 P3 (cosmétique, zéro impact runtime)
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Issu de** : audit `todo/2026-05-23-audit-code-supabase-residuel.md` (clos)

## Constat

L'audit Supabase résiduel 2026-05-23 a confirmé que `src/lib/supabase/tenant.ts`
est le **dernier fichier survivant** du dossier `src/lib/supabase/`, et c'est
un **bridge 100% Prisma** (zéro appel réseau, zéro mention `@supabase/*`).

Le dossier `src/lib/supabase/` ne contient plus que ce fichier. Le nom est
trompeur : un lecteur du code peut croire qu'il reste du Supabase actif,
alors qu'il n'y a que des `prisma.tenant.findFirst(...)`.

## 20 imports à renommer

```
src/app/api/checkout/route.ts
src/app/api/followups/[id]/route.ts
src/app/api/followups/route.ts
src/app/api/history/route.ts
src/app/api/leads/[domain]/route.ts
src/app/api/leads/route.ts
src/app/api/outreach/[domain]/route.ts
src/app/api/phone/call-log/route.ts
src/app/api/phone/presence/route.ts
src/app/api/phone/server-call/route.ts
src/app/api/phone/summarize-call/route.ts
src/app/api/phone/telnyx-token/route.ts
src/app/api/pipeline/route.ts
src/app/api/prospects/route.ts
src/app/api/segments/route.ts
src/app/api/segments/[...slug]/route.ts
src/app/api/settings/route.ts
src/app/api/stats/overview/route.ts
src/app/api/stats/route.ts
src/app/api/stats/today/route.ts
```

## Action

1. `git mv src/lib/supabase/tenant.ts src/lib/auth/tenant.ts`
2. `rmdir src/lib/supabase/` (vide)
3. Sed sur les 20 fichiers : `@/lib/supabase/tenant` → `@/lib/auth/tenant`
4. Smoke staging post-deploy (les 20 routes ci-dessus doivent rester en
   200/401 selon auth, comme aujourd'hui)

## Pourquoi P3 et pas urgent

- Zéro risque runtime (aucune URL Supabase appelée).
- Le nom trompeur n'a coûté QUE le temps de l'audit 2026-05-23, lui-même
  bouclé en <1h une fois la première lecture de `tenant.ts` faite.
- Faisable en 1 commit `[risk:low]` autonome.

## Hors scope

- Le champ Prisma `supabase_user_id` (colonne DB legacy) : rename DB
  destructif, à grouper dans une migration plus large quand on touchera
  vraiment au schéma users (pas maintenant).
