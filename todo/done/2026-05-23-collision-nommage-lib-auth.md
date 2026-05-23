# [PROSPECTION] Collision de nommage `src/lib/auth.ts` (fichier) vs `src/lib/auth/` (dossier)

> **Type** : Hygiène structure / nommage trompeur
> **Sévérité** : 🟢 P2 (pas urgent, mais piège à éviter avant d'aggraver)
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Issu de** : refactor `chore(refactor): @/lib/supabase/tenant → @/lib/auth/tenant` (SHA `69ba7fa`)

## Constat

`src/lib/` contient **à la fois** :

- `src/lib/auth.ts` — config Auth.js v5 (NextAuth() complet, handlers, Prisma adapter, Credentials provider). 3 imports : `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/auth/api-auth.ts`, `src/lib/auth/user-context.ts`.
- `src/lib/auth/` — dossier des helpers de session (api-auth, middleware, roles, user-context, freeze, tenant). ~30 imports.

Les deux cohabitent grâce à la résolution Node : `@/lib/auth` cible le
fichier `.ts` (priorité au fichier), `@/lib/auth/<X>` cible le dossier.
Aucun bug aujourd'hui car le dossier n'a pas d'`index.ts`.

## Pourquoi c'est piégeux

1. **Lecture trompeuse** : un dev qui voit `import { auth } from "@/lib/auth"`
   et `import { requireAuth } from "@/lib/auth/api-auth"` dans le même fichier
   peut croire à du même module ou à des subexports. Ce sont deux entités.
2. **Bombe à retardement** : le jour où quelqu'un crée
   `src/lib/auth/index.ts` (pour grouper les exports du dossier), le bare
   `@/lib/auth` change silencieusement de cible — du fichier `auth.ts` vers
   `auth/index.ts` — et casse les 3 imports actuels d'Auth.js. Le tsc
   compilera potentiellement encore (selon les types ré-exportés) mais le
   runtime cassera (`handlers`/`auth`/`signIn` indéfinis).
3. **Ergonomie IDE** : le go-to-definition sur `@/lib/auth` peut se
   tromper de cible selon l'extension.

## Action proposée

Renommer le fichier `src/lib/auth.ts` pour lever l'ambiguïté :

**Option A — `src/lib/auth-config.ts`** (recommandé)
- Cohérent avec `src/lib/auth.config.ts` (la version edge-safe déjà
  séparée).
- Le pair (`auth-config.ts` + `auth.config.ts`) reste lisible.
- Update les 3 imports : `@/lib/auth` → `@/lib/auth-config`.

**Option B — déplacer dans le dossier : `src/lib/auth/index.ts`**
- Le bare `@/lib/auth` continuerait de marcher (zéro update d'import
  côté caller).
- Mais mélange la config NextAuth() (lourd, adapter Prisma, runtime Node)
  avec les helpers de session — Hub avait ce même piège, séparé depuis.
- ⚠️ `src/lib/auth/middleware.ts` doit rester edge-safe : pas d'import
  Prisma. Si `index.ts` réexporte le contenu Node, attention aux imports
  transitifs.

**Option C — `src/lib/nextauth.ts`**
- Très explicite sur "c'est la config NextAuth() vs nos helpers session".
- Update 3 imports.

### Reco agent : Option A (`auth-config.ts`)

- Minimal en bruit : 1 rename + 3 updates.
- Cohérent visuellement avec `auth.config.ts` (déjà splittée pour la
  même raison edge vs node).
- Pas de risque de mélanger un index.ts qui ré-exporte du Node-only
  dans le dossier auth/ où vivent des modules edge-safe.

## Pourquoi P2 et pas P3

- Pas une régression, pas un bug actif.
- Mais **piège latent** : la prochaine personne qui crée un `index.ts`
  dans `src/lib/auth/` casse silencieusement Auth.js. Vaut le coup de
  nettoyer avant d'aggraver.

## Effort estimé

~10 min : 1 git mv, sed sur 3 fichiers, vitest run, commit `[risk:low]`.

## Hors scope

- `src/lib/auth.config.ts` (déjà bien nommé, edge-safe distinct) — ne
  pas y toucher.
- Le contenu interne de `src/lib/auth.ts` — pas de refactor de la
  config NextAuth(), juste un rename de fichier.
