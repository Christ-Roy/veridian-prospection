# [PROSPECTION] Workflow CVE Trivy cassé — checkout sans submodule

> **Type** : Bug CI — workflow
> **Sévérité** : 🟡 P1 — la veille CVE ne tourne plus (mais pas de prod en danger)
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Découvert** : promo prod sprint UI 2026-05-22

## Problème

Le workflow `Prospection — security CVE (Trivy)` échoue à chaque run.
L'étape "Build image locally (no push, scan-only)" plante :

```
Type error: Cannot find module '@veridian/shared' or its
corresponding type declarations.
ERROR: process "npx prisma generate && npm run build" exit code: 1
```

Conséquence en cascade : pas d'image buildée → le scan Trivy est
`skipped` → l'étape SARIF échoue (`unable to find the specified image`)
→ job en `failure`.

## Cause

Le repo a un submodule Git `shared` (`veridian-infra`, alias
`@veridian/shared` — constantes business cross-app, cf `.gitmodules`).

Le workflow Trivy fait `actions/checkout` **sans `submodules: recursive`**.
Le dossier `shared/` reste vide → le typecheck du build échoue.

Le workflow de déploiement `prospection-ci.yml` checkout bien
`submodules: recursive` (6 occurrences) — c'est pour ça que la prod
build et déploie correctement. SEUL le workflow Trivy a oublié l'option.

## Fix

Dans le workflow Trivy (`cron-trivy.yml` côté veridian-infra, ou le
workflow `Prospection — security CVE (Trivy)` selon où il est défini —
à localiser), ajouter au step `actions/checkout` :

```yaml
- uses: actions/checkout@v6
  with:
    submodules: recursive   # shared/ submodule veridian-infra
```

## Impact

Pas de prod en danger — le déploiement prod fonctionne (build CI/CD OK).
Mais la **veille CVE est aveugle** depuis que le submodule a été
introduit : aucune image n'est scannée. À corriger pour rétablir le
scan de sécurité automatique.

## Note

Le workflow Trivy est probablement défini dans `veridian-infra`
(`.github/workflows/cron-trivy.yml` — référencé dans `SECURITY-CVE.md`).
Si c'est le cas, ce ticket doit être routé vers l'agent infra.
