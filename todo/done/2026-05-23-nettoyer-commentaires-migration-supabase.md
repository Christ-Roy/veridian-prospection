# [PROSPECTION] Nettoyer 3 commentaires historiques `src/lib/supabase/*` résiduels

> **Type** : Hygiène / doc rot
> **Sévérité** : 🔵 P3 (cosmétique pur, zéro impact runtime)
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Issu de** : refactor `chore(refactor): @/lib/supabase/tenant → @/lib/auth/tenant` (SHA `69ba7fa`)

## Constat

Après le rename `@/lib/supabase/tenant → @/lib/auth/tenant` et la
suppression du dossier `src/lib/supabase/`, il subsiste **3 commentaires
de doc** qui pointent vers des fichiers `src/lib/supabase/*.ts` qui
n'existent plus (supprimés lors de la migration Auth.js v5
2026-05-19/20) :

```
src/lib/auth/api-auth.ts:2:    * Auth.js v5 — équivalent de src/lib/supabase/api-auth.ts
src/lib/auth/middleware.ts:2:   * Auth.js v5 — équivalent edge-safe de src/lib/supabase/middleware.ts
src/lib/auth/user-context.ts:2: * Auth.js v5 user context resolution — remplace src/lib/supabase/user-context.ts
```

Ces commentaires ont été utiles pendant la migration pour tracer
l'origine. Aujourd'hui ils renvoient vers du néant — bruit de
doc obsolète qui fait croire qu'il existe encore quelque chose côté
Supabase.

## Action

Pour chaque fichier, **supprimer la ligne de commentaire historique**.
Le module est déjà documenté par le reste de son header (rôle, runtime
edge/node, etc.) — la phrase "équivalent de X" n'apporte plus rien
maintenant que X n'existe plus.

Pas de `git mv`, pas de changement d'API, juste 3 edits ponctuels.

### Bonus optionnel (même PR si trivial)

`__tests__/api/_helpers.ts:24-25` contient aussi un paragraphe sur les
chaînes `supabase.from(table).select(...)` qui décrit un pattern de mock
Supabase **obsolète** (la couche Supabase a été virée). Si le rédacteur
en a le courage, remplacer par un pattern Prisma ou virer la section.
Sinon, laisser tel quel et juste s'occuper des 3 fichiers du dossier
auth/.

## Pourquoi P3

Zéro risque, zéro user impact. Juste de la propreté. À faire en passant
quand quelqu'un touche déjà à `src/lib/auth/`, pas un sprint dédié.

## Statut 2026-05-23

- `middleware.ts:2` et `user-context.ts:2` : **déjà nettoyés** ailleurs avant
  l'archivage de ce ticket.
- `api-auth.ts:2` : **résiduel non-traité**. La modification (suppression
  d'une ligne JSDoc) déclenche la règle Husky `check-test-mapping`
  (modif fichier source = modif test associé exigée). Or aucun test
  pertinent ne peut être ajouté pour valider une suppression de
  commentaire — ce serait un test bidon. Coût/valeur défavorable
  pour un P3 cosmétique. À traiter en bundle si quelqu'un touche déjà
  à `api-auth.ts` pour un vrai changement comportemental.

## Hors scope

- Le champ Prisma `supabase_user_id` (colonne DB legacy) — déjà flag
  hors scope dans le ticket d'origine (`2026-05-23-rename-bridge-supabase-tenant.md`),
  destructif, doit être grouper avec une migration users plus large.
- Les commentaires de `prisma/schema.prisma` qui mentionnent la
  migration Supabase — utiles pour comprendre l'histoire du schéma,
  garder.
