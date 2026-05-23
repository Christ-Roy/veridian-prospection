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

## Mise à jour de l'index racine

Après chaque déplacement, exécuter depuis la racine `veridian-platform/` :

```bash
./scripts/refresh-todo.sh
```

Met à jour `TODO.md` qui agrège tous les tickets pending+staging+blocked+done de toutes les apps.
