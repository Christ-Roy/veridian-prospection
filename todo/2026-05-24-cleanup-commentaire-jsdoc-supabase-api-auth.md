# [PROSPECTION] Cleanup résiduel commentaire JSDoc src/lib/auth/api-auth.ts

> **Type** : Hygiène / doc rot
> **Sévérité** : 🔵 P3 (cosmétique pur)
> **Owner** : agent Prospection — à grouper avec un prochain changement comportemental sur api-auth.ts
> **Créé** : 2026-05-24
> **Découvert par** : Agent D session 2026-05-23 (bloqué par Husky)

## Constat

Le ticket archivé `todo/done/2026-05-23-nettoyer-commentaires-migration-supabase.md` couvrait 3 commentaires JSDoc résiduels qui pointent vers `src/lib/supabase/*.ts` (fichiers supprimés post-migration Auth.js v5).

Agent D a livré 2/3 commentaires. **Le 3e (`src/lib/auth/api-auth.ts:2`) reste** car :

```
src/lib/auth/api-auth.ts:2:    * Auth.js v5 — équivalent de src/lib/supabase/api-auth.ts
```

Husky `check-test-mapping` refuse le commit : modif source = exige modif test associée. Or aucun test pertinent ne peut être ajouté pour la suppression d'une ligne JSDoc (test bidon refusé par règle Robert "ne bâcle pas les tests").

## Solution

À traiter en **bundle** avec un prochain changement comportemental sur `src/lib/auth/api-auth.ts` (refactor, ajout de fonction, durcissement RBAC, etc.). Le test associé sera modifié pour le changement comportemental, et la suppression de la ligne JSDoc passera dans le même commit.

Concrètement : si tu touches `api-auth.ts` pour autre chose, profite-en pour supprimer la ligne 2.

## Pas urgent

Zéro impact runtime. Juste de la propreté.

## Référence

- Ticket parent (archivé) : `todo/done/2026-05-23-nettoyer-commentaires-migration-supabase.md`
- Rapport Agent D : 2026-05-23 session vague 1
- Pattern Husky : check-test-mapping (memory [[feedback_husky_strict_pending]])
