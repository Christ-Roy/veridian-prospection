# 🔒 Veille CVE automatique — veridian-prospection

> **Généré par** : `veridian-infra/.github/workflows/cron-trivy.yml`
> **Dernier run** : 2026-06-11 04:11 UTC
> **Run URL** : local-cron@mail.mybigserveur.local:2026-06-11
> **Image scannée** : `ghcr.io/christ-roy/prospection:latest`
> **CVE bruts détectés** : 3 (avant filtrage)
> **Scoring** : `veridian-infra/ci/trivy-scoring.yml`

## TL;DR

- 🚨 **0 RED** — fix prioritaire
- 🔴 **1 HIGH** — action recommandée cette semaine
- 🟡 **1 MEDIUM** — récap, pas urgent
- 🟢 **0 NOISE** — annexe collapse


---

## 🔴 HIGH — 1 CVE en 1 groupe

### 1. `nodemailer` — 7.0.13 → **8.0.5**

- **CVE** : `GHSA-vvjj-xcjg-gr5g` (MEDIUM/RCE)
- **Type** : RCE
- **Score max** : 30
- **Title** : Nodemailer Vulnerable to SMTP Command Injection via CRLF in Transport name Option (EHLO/HELO) 
- **Source** : `package-lock.json`
- **Fix** : `pnpm up nodemailer` (jusqu'à >= `8.0.5`)


---

## 🟡 MEDIUM — 1 CVE en 1 groupe

### 1. `uuid` — 7.0.3 → **13.0.1**

- **CVE** : `CVE-2026-41907` (MEDIUM/Memory corruption)
- **Type** : Memory corruption
- **Score max** : 12
- **Title** : uuid: uuid: Out-of-bounds write vulnerability impacts data integrity and confidentiality
- **Source** : `package-lock.json`
- **Fix** : `pnpm up uuid` (jusqu'à >= `13.0.1`)


---

## Comment réagir

1. **Tu fixes** → bump la dep / la base image, push sur `staging`. Le prochain tick (24h) confirme.
2. **Tu acks le risque** → ajoute un override dans [`veridian-infra/ci/trivy-overrides.yml`](https://github.com/Christ-Roy/veridian-infra/blob/main/ci/trivy-overrides.yml) avec date d'expiration + raison.
3. **Tu ignores** → ne fais rien, le tick recréera ce fichier demain à l'identique.

> Tu peux **supprimer ce fichier librement**. Il sera recréé au prochain tick s'il reste des items à signaler. C'est l'idempotence qui garantit qu'on ne perd rien.

*Pour ajuster les règles : [`veridian-infra/ci/trivy-scoring.yml`](https://github.com/Christ-Roy/veridian-infra/blob/main/ci/trivy-scoring.yml). Ping infra-agent.*
