# [PROSPECTION] Audit défensif : setters async sans guard

> **Type** : Hardening — anti-régression bug intermittent
> **Sévérité** : 🟡 P1 — patterns à risque latents, dérivés du bug `bug-intermittent-prospects-undefined-length`
> **Owner** : agent Prospection
> **Créé** : 2026-05-23

## Contexte

Le ticket `2026-05-23-bug-intermittent-prospects-undefined-length` a corrigé
3 patterns `setX(data.y)` sans guard (`pipeline-board`, `sans-site-sidebar`,
`segment-page`). Audit rapide post-fix a révélé **3 patterns identiques
encore en place** dans d'autres composants, même classe de bug.

## Patterns à durcir

### 1. `src/components/dashboard/stats-cards.tsx:34`

```ts
fetch("/api/stats")
  .then((r) => r.json())   // pas de r.ok check
  .then(setStats);          // pas de .catch
```

- Si API renvoie 401/500 avec body JSON → `setStats({error: "..."})` valide
  TS mais cassera `stats[s.key]` au render (heureusement déjà gardé par
  `value != null` ligne 50).
- Si `r.json()` throw (body HTML) → `unhandledrejection` bruit
  `/api/errors` sans utilité.

**Fix** : `r.ok ? r.json() : null`, `.then(d => setStats(d && typeof d === "object" ? d : null))`, `.catch(() => {})`.

### 2. `src/components/layout/app-nav.tsx:53`

```ts
fetch("/api/settings")
  .then(setSettings)        // pas de .json() ! pas de guard
```

- `setSettings(Response)` → store l'objet Response dans le state, cassera
  toute lecture `settings[key]` ailleurs.
- À vérifier en lisant le fichier complet — possible que ce soit déjà
  défensif via wrapper plus haut, mais le pattern visible est suspect.

**Fix** : explicite `.then(r => r.ok ? r.json() : {}).then(setSettings)`.

### 3. `src/components/dashboard/segment-table.tsx:78`

```ts
const res = await fetch(`/api/segments/${segment}?${params}`);
const json = await res.json();
setData(json);
```

- Pas de `res.ok` check.
- `data.data.map(...)` ligne 105 throw si `json = {error: "..."}`.
- Composant utilisé sur `/segments/<id>` — exactement le path du bug
  intermittent original.

**Fix** : `if (!res.ok) { setData(null); return; }` + cast défensif
`setData(json && Array.isArray(json.data) ? json : null)`.

## Pourquoi P1 pas P2

Même classe de bug que celui qu'on vient de corriger. Si on attend
qu'un user voit une page blanche pour fixer, on a appris zéro chose
du précédent incident. C'est exactement le rôle de l'audit post-fix.

## Test

Suivre le pattern établi dans `__tests__/components/dashboard/pipeline-board.test.tsx`
(describe "guard défensif fetchPipeline (bug intermittent 2026-05-23)") :
- 1 describe par composant
- Tests source-level qui valident l'absence du pattern dangereux
- Sabotage-test : retirer le guard doit faire rougir le test

## Estimation

~30 min total. 3 fichiers × 2-4 lignes chacun + 3 describe Vitest.

## Référence

- Bug original : `todo/done/2026-05-23-bug-intermittent-prospects-undefined-length.md`
  (post fix commit `d5ae9e8`)
- Audit grep : `grep -rn "setData\|setStats\|setSettings" src/components/`
