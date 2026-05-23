# `todo/` — convention d'organisation

## Structure

```
todo/
├── *.md             ← BACKLOG (pas encore commencé OU en cours d'analyse/cadrage)
├── staging/         ← LIVRÉ EN STAGING (en attente validation Robert ou promo prod)
├── blocked/         ← EN ATTENTE EXTERNE (autre app, décision business, fenêtre temporelle)
├── done/            ← MERGÉ EN PROD (archive)
├── apps/            ← sous-tickets app-specific (cas Hub multi-app)
├── SECURITY-CVE.md  ← veille CVE auto-régénérée par cron Trivy
└── UI-BACKLOG.md    ← index vivant UI (mis à jour à chaque session UI)
```

## Workflow d'un ticket

```
[créé]
   │
   └── todo/2026-MM-DD-<slug>.md
       │
       │ (agent travaille, livre commit, push staging)
       │
       ▼
   todo/staging/<slug>.md
       │
       │ (validation Robert ou cycle observation : 7j logs, captures UI, smoke prod-like)
       │
       │ ─── si OK ─── ▶ promo prod (merge staging→main) ─── ▶ todo/done/<slug>.md
       │
       │ ─── si KO ─── ▶ retour todo/<slug>.md avec note "Retour correction YYYY-MM-DD"
       │
       │ (ou bloqué par événement externe)
       │
       ▼
   todo/blocked/<slug>.md ─── (notif quand débloqué) ─── ▶ retour staging/ ou done/
```

## Règles

### Quand bouger un ticket vers `staging/`

- Le code est **mergé sur la branche `staging`** ET déployé sur `prospection.staging.veridian.site`
- Mais **pas encore en prod** (`main` non merged) — parce que :
  - UI gelée en attente validation visuelle de Robert sur captures
  - Migration DB destructive en attente go explicite
  - Fenêtre d'observation en cours (ex : 7j logs sans `legacy_*` avant flip flags)
  - Décision business en attente (ex : pricing, scope feature)

### Quand bouger un ticket vers `done/`

- Le code est **en prod** (`main` ↔ `prospection.app.veridian.site`)
- Le smoke prod a validé le comportement attendu
- Le monitoring post-deploy n'a remonté aucune régression

### Quand bouger un ticket vers `blocked/`

- L'agent ne peut **plus avancer seul** (ex : attend l'agent Hub pour patcher la matrice §10, attend une décision Robert sur le scope, attend la fenêtre 7j d'observation prod)
- Le ticket doit avoir une **condition de déblocage** explicite (date, événement, dépendance nommée)

### Sévérités

- 🔴 **P0** : bloque la prod ou risque immédiat
- 🟡 **P1** : feature importante ou dette qui mord à court terme
- 🟢 **P2** : amélioration UX, dette qui peut attendre
- 🔵 **P3** : cosmétique, idéal, plaisir de bien faire
- 🔵 **P5** : à dégainer si un argument commercial/client le réclame
- 💀 **CRITIQUE** : tier §20 CI-ARCHITECTURE — go explicite Robert (DROP DB, rotation secret, suppression tenant prod)

### Header ticket minimum

Pour que le scanner cross-repo `scripts/refresh-todo.sh` parse correctement :

```markdown
# Titre clair du ticket

> **Type** : <bug / feature / dette / cleanup / audit>
> **Sévérité** : 🔴 P0 / 🟡 P1 / 🟢 P2 / 🔵 P3 / 💀 CRITIQUE
> **Owner** : agent <repo>
> **Créé** : YYYY-MM-DD
```

## Pourquoi pas un statut dans le header

Bouger les fichiers physiquement (au lieu de modifier un `status:` dans le header) :
- Force la décision (impossible de laisser pourrir un ticket dans le faux statut)
- Index dynamique `TODO.md` racine `veridian-platform/` voit immédiatement les changements
- `git log --diff-filter=R` montre l'historique des promotions
- `ls todo/staging/ | wc -l` = backlog "à valider" instantané
- Pas besoin de parser le markdown pour connaître l'état

## 🚨 Règles de travail pour les agents (durcies 2026-05-23)

### Pas de build local, pas de hot reload sur la machine de Robert

La machine locale (mail) est chroniquement saturée. **Aucun agent ne lance** :

- `npm run build` / `npm run dev` en local
- `next dev` en local
- Tests Vitest en local (sauf valider 1 fichier ponctuel < 30s)
- Playwright en local (interdit, ça met la machine à genoux)
- Docker compose up en local

**Tout passe par** :

1. **CI staging** (`prospection-deploy-staging.yml`) : c'est elle qui tranche vert/rouge. L'agent push staging, attend, lit le résultat. Point.
2. **Container Playwright sur dev-pub** : pour les E2E lourds, pattern éprouvé (cf `2026-05-23-maj-mega-battery-e2e-staging.md`).
3. **Hot reload `ui-dev.staging.veridian.site`** sur dev-pub : pour les revues UI uniquement (skill `ui-polish-team`), pas pour le travail quotidien des agents.

### Les agents ne re-testent pas en boucle leur propre code

L'agent code, push staging, **lit le retour CI**. Si rouge → fix → re-push. Pas de boucle locale `npm test` / `playwright test` en attendant que ça passe. La CI staging est l'autorité.

**Sanction** : un agent qui met la machine locale à genoux (load > 8, RAM > 7G) parce qu'il a lancé un build/test local en boucle = faute, je l'arrête et je redirige sur dev-pub.

### Plus aucun push prod sans mega battery E2E à jour

Toute feature livrée DOIT étendre `e2e/staging-full/critical-journeys.spec.ts` (ou équivalent dans `e2e/core/`) avec sa couverture avant promo prod. Le team-lead refuse toute promo `staging → main` qui ne passe pas le gate. Cf `2026-05-23-maj-mega-battery-e2e-staging.md`.

## Mise à jour de l'index racine

Après chaque déplacement, exécuter depuis la racine `veridian-platform/` :

```bash
./scripts/refresh-todo.sh
```

Met à jour `TODO.md` qui agrège tous les tickets pending+staging+blocked+done de toutes les apps.
