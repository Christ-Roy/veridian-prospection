# 🔒 Veille CVE automatique — veridian-prospection

> **Généré par** : `veridian-infra/.github/workflows/cron-trivy.yml`
> **Dernier run** : 2026-08-01 04:13 UTC
> **Run URL** : local-cron@mail.mybigserveur.local:2026-08-01
> **Image scannée** : `ghcr.io/christ-roy/prospection:latest`
> **CVE bruts détectés** : 12 (avant filtrage)
> **Scoring** : `veridian-infra/ci/trivy-scoring.yml`

## TL;DR

- 🚨 **0 RED** — fix prioritaire
- 🔴 **3 HIGH** — action recommandée cette semaine
- 🟡 **6 MEDIUM** — récap, pas urgent
- 🟢 **2 NOISE** — annexe collapse


---

## 🔴 HIGH — 3 CVE en 2 groupes

### 1. `next` — 15.5.18 → **16.2.11**

- **CVE** : `CVE-2026-64645` (HIGH/SSRF), `CVE-2026-64649` (HIGH/SSRF)
- **Type** : SSRF
- **Score max** : 45
- **Title** : next: Next.js: Server-Side Request Forgery vulnerability
- **Source** : `Node.js`
- **Fix** : `pnpm up next` (jusqu'à >= `16.2.11`)

### 2. `postcss` — 8.5.15 → **8.5.18**

- **CVE** : `GHSA-r28c-9q8g-f849` (HIGH/Data leak)
- **Type** : Data leak
- **Score max** : 30
- **Title** : PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure
- **Source** : `Node.js`
- **Fix** : `pnpm up postcss` (jusqu'à >= `8.5.18`)


---

## 🟡 MEDIUM — 6 CVE en 3 groupes

### 1. `next` — 15.5.18 → **16.2.11**

- **CVE** : `CVE-2026-64641` (HIGH/DoS), `CVE-2026-64643` (MEDIUM/Data leak), `CVE-2026-64647` (MEDIUM/Data leak), `CVE-2026-64648` (MEDIUM/Data leak)
- **Type** : Data leak, DoS
- **Score max** : 15
- **Title** : next: Next.js: Denial of Service via crafted requests to App Router with Server Actions
- **Source** : `Node.js`
- **Fix** : `pnpm up next` (jusqu'à >= `16.2.11`)

### 2. `sharp` — 0.34.5 → **0.35.0**

- **CVE** : `GHSA-f88m-g3jw-g9cj` (HIGH/Unclassified)
- **Type** : Unclassified
- **Score max** : 15
- **Title** : sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591
- **Source** : `Node.js`
- **Fix** : `pnpm up sharp` (jusqu'à >= `0.35.0`)

### 3. `uuid` — 7.0.3 → **13.0.1**

- **CVE** : `CVE-2026-41907` (MEDIUM/Memory corruption)
- **Type** : Memory corruption
- **Score max** : 12
- **Title** : uuid: uuid: Out-of-bounds write vulnerability impacts data integrity and confidentiality
- **Source** : `package-lock.json`
- **Fix** : `pnpm up uuid` (jusqu'à >= `13.0.1`)


---

## 🟢 NOISE filtré (2 CVE)

<details>
<summary>Liste complète (1 groupe — clique pour déplier)</summary>

| Package | Installed | Fix | CVE count | Max score |
|---|---|---|---|---|
| `next` | 15.5.18 | 16.2.11 | 2 | 6 |

</details>


---

## Comment réagir

1. **Tu fixes** → bump la dep / la base image, push sur `staging`. Le prochain tick (24h) confirme.
2. **Tu acks le risque** → ajoute un override dans [`veridian-infra/ci/trivy-overrides.yml`](https://github.com/Christ-Roy/veridian-infra/blob/main/ci/trivy-overrides.yml) avec date d'expiration + raison.
3. **Tu ignores** → ne fais rien, le tick recréera ce fichier demain à l'identique.

> Tu peux **supprimer ce fichier librement**. Il sera recréé au prochain tick s'il reste des items à signaler. C'est l'idempotence qui garantit qu'on ne perd rien.

*Pour ajuster les règles : [`veridian-infra/ci/trivy-scoring.yml`](https://github.com/Christ-Roy/veridian-infra/blob/main/ci/trivy-scoring.yml). Ping infra-agent.*
