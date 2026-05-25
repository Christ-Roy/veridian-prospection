# [PROSPECTION] Mega battery bloque sur xvfb-run dans container Playwright 1.55.0

> **Type** : Bug runtime container Playwright
> **Sévérité** : 🟡 P1 — bloque la validation E2E hard-core dev-pub container (FIX-MEGABATTERY-DEVPUB livré mais xvfb plante silencieusement)
> **Owner** : agent Prospection à spawner
> **Créé** : 2026-05-25 par team-lead après tentative mega battery Vague 10

## Symptôme

Le nouveau wrapper `staging-full.sh` (livré par FIX-MEGABATTERY-DEVPUB) qui lance Playwright dans un container sur dev-pub bloque indéfiniment après :

```
── xvfb-run npx playwright test ──
```

Plus aucune output. Le container reste actif 50+ min sans progresser. 2 tentatives consécutives → même blocage.

## Root cause probable

L'image `mcr.microsoft.com/playwright:v1.55.0-jammy` + `xvfb-run` + `npx playwright test --config=playwright.staging-full.config.ts` (qui force `headless: false`) ne libère pas le stdout / bloque sur l'init du display virtuel.

Hypothèses :
1. xvfb-run installé via `apt-get install -y xvfb` (commande dans la wrapper) qui ne fonctionne pas dans cette image
2. Conflit avec le user de l'image Playwright (peut-être pas root)
3. Display virtuel n'arrive jamais à se créer (driver Xorg manquant)
4. Playwright 1.55 nécessite une version différente de xvfb-run

## Fix proposé

### Option A — Upgrade image Playwright à 1.60.0+
```bash
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.60.0-jammy"
```
La version 1.60 a peut-être un xvfb intégré ou un binaire `playwright` qui gère le headfull mode autrement.

### Option B — Pré-installer xvfb dans une image custom
Build une image custom Docker basée sur `mcr.microsoft.com/playwright:v1.55.0-jammy` qui pre-install xvfb proprement :
```Dockerfile
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
RUN apt-get update && apt-get install -y --no-install-recommends xvfb && rm -rf /var/lib/apt/lists/*
```
Push sur ghcr.io/christ-roy/veridian-playwright et utiliser dans le wrapper.

### Option C — Repenser le mode headfull
Modifier `playwright.staging-full.config.ts` pour `headless: true` (visible via screenshots, pas via display). Plus simple, plus rapide, mais on perd le scroll/hover réaliste qui a justifié le mode headfull à l'origine.

### Option D — Garder local sur machine Robert pour la mega battery
Reverter le mode wrapper dev-pub et chercher une autre façon de résoudre `postgres-staging:5432` depuis le local. Tunnel SSH ? Override DATABASE_URL pour pointer sur un Postgres local cloné ?

## Recommendation

**Option A en premier** (rapide, juste un bump image). Si ne marche pas → Option B (image custom Veridian).

## Definition of done

- [ ] `bash scripts/e2e/staging-full.sh` tourne le mode wrapper dev-pub jusqu'au bout
- [ ] Output Playwright visible (spec par spec)
- [ ] Rapport JSON `e2e-headfull-staging.json` récupéré dans le repo local

## Estimation

~30 min - 1h selon option choisie.

## Référence

- FIX-MEGABATTERY-DEVPUB ticket original : `todo/done/2026-05-25-mega-battery-doit-tourner-sur-devpub-pas-local.md`
- 2 tentatives mega battery Vague 10 : containers `quizzical_engelbart` + `sweet_pike` killés après 50+ min sans progrès
- Image actuelle : `mcr.microsoft.com/playwright:v1.55.0-jammy`
