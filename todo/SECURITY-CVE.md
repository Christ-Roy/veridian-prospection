# 🔒 Veille CVE automatique — veridian-prospection

> **Généré par** : `veridian-infra/.github/workflows/cron-trivy.yml`
> **Dernier run** : 2026-08-08 04:11 UTC
> **Run URL** : local-cron@mail.mybigserveur.local:2026-08-08
> **Image scannée** : `ghcr.io/christ-roy/prospection:latest`
> **CVE bruts détectés** : 6 (avant filtrage)
> **Scoring** : `veridian-infra/ci/trivy-scoring.yml`

## TL;DR

- 🚨 **0 RED** — fix prioritaire
- 🔴 **0 HIGH** — action recommandée cette semaine
- 🟡 **4 MEDIUM** — récap, pas urgent
- 🟢 **0 NOISE** — annexe collapse

✅ **Rien d'urgent.** Quelques items MEDIUM à voir quand t'as 5 min.


---

## 🟡 MEDIUM — 4 CVE en 3 groupes

### 1. `nanoid` — 3.3.12 → **5.1.16**

- **CVE** : `CVE-2026-67213` (HIGH/DoS), `CVE-2026-67214` (HIGH/DoS)
- **Type** : DoS
- **Score max** : 15
- **Title** : nanoid (Nano ID) before 5.1.6 contains an infinite loop in the customA ...
- **Source** : `package-lock.json`
- **Fix** : `pnpm up nanoid` (jusqu'à >= `5.1.16`)

### 2. `postcss` — 8.5.18 → **8.5.23**

- **CVE** : `CVE-2026-69153` (MEDIUM/Data leak)
- **Type** : Data leak
- **Score max** : 12
- **Title** : postcss: PostCSS: Information disclosure via crafted sourceMappingURL
- **Source** : `package-lock.json`
- **Fix** : `pnpm up postcss` (jusqu'à >= `8.5.23`)

### 3. `uuid` — 7.0.3 → **13.0.1**

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
