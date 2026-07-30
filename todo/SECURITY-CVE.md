# 🔒 Veille CVE automatique — veridian-prospection

> **Généré par** : `veridian-infra/.github/workflows/cron-trivy.yml`
> **Dernier run** : 2026-07-30 04:10 UTC
> **Run URL** : local-cron@mail.mybigserveur.local:2026-07-30
> **Image scannée** : `ghcr.io/christ-roy/prospection:latest`
> **CVE bruts détectés** : 33 (avant filtrage)
> **Scoring** : `veridian-infra/ci/trivy-scoring.yml`

## TL;DR

- 🚨 **1 RED** — fix prioritaire
- 🔴 **5 HIGH** — action recommandée cette semaine
- 🟡 **11 MEDIUM** — récap, pas urgent
- 🟢 **2 NOISE** — annexe collapse


---

## 🚨 RED — 1 CVE en 1 groupe

### 1. `next-auth` — 5.0.0-beta.30 → **5.0.0-beta.32**

- **CVE** : `GHSA-8fpg-xm3f-6cx3` (CRITICAL/Auth bypass)
- **Type** : Auth bypass
- **Score max** : 90
- **Title** : Auth.js: Configuration errors can cause existence-based auth checks to fail open (auth object populated with an error)
- **Source** : `package-lock.json`
- **Fix** : `pnpm up next-auth` (jusqu'à >= `5.0.0-beta.32`)


---

## 🔴 HIGH — 5 CVE en 4 groupes

### 1. `next` — 15.5.18 → **16.2.11**

- **CVE** : `CVE-2026-64645` (HIGH/SSRF), `CVE-2026-64649` (HIGH/SSRF)
- **Type** : SSRF
- **Score max** : 45
- **Title** : next: Next.js: Server-Side Request Forgery vulnerability
- **Source** : `package-lock.json`
- **Fix** : `pnpm up next` (jusqu'à >= `16.2.11`)

### 2. `@auth/core` — 0.41.0 → **0.41.3**

- **CVE** : `GHSA-7rqj-j65f-68wh` (CRITICAL/Unclassified)
- **Type** : Unclassified
- **Score max** : 30
- **Aussi affectés** (même CVE) : `next-auth`
- **Title** : Auth.js: Email normalizer validates the address before Unicode normalization, allowing a homoglyph @ bypass
- **Source** : `package-lock.json`
- **Fix** : `pnpm up @auth/core` (jusqu'à >= `0.41.3`)

### 3. `next-auth` — 5.0.0-beta.30 → **5.0.0-beta.32**

- **CVE** : `GHSA-7rqj-j65f-68wh` (CRITICAL/Unclassified)
- **Type** : Unclassified
- **Score max** : 30
- **Aussi affectés** (même CVE) : `@auth/core`
- **Title** : Auth.js: Email normalizer validates the address before Unicode normalization, allowing a homoglyph @ bypass
- **Source** : `package-lock.json`
- **Fix** : `pnpm up next-auth` (jusqu'à >= `5.0.0-beta.32`)

### 4. `postcss` — 8.5.15 → **8.5.18**

- **CVE** : `GHSA-r28c-9q8g-f849` (HIGH/Data leak)
- **Type** : Data leak
- **Score max** : 30
- **Title** : PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure
- **Source** : `package-lock.json`
- **Fix** : `pnpm up postcss` (jusqu'à >= `8.5.18`)


---

## 🟡 MEDIUM — 11 CVE en 6 groupes

### 1. `@auth/core` — 0.41.0 → **0.41.3**

- **CVE** : `GHSA-xmf8-cvqr-rfgj` (HIGH/DoS), `GHSA-x445-f3h2-j279` (MEDIUM/CSRF)
- **Type** : CSRF, DoS
- **Score max** : 15
- **Aussi affectés** (même CVE) : `next-auth`
- **Title** : Auth.js: getToken() throws an uncaught exception on malformed Bearer authorization headers
- **Source** : `package-lock.json`
- **Fix** : `pnpm up @auth/core` (jusqu'à >= `0.41.3`)

### 2. `linkify-it` — 5.0.1 → **5.0.2**

- **CVE** : `CVE-2026-59887` (HIGH/Unclassified)
- **Type** : Unclassified
- **Score max** : 15
- **Title** : linkify-it: Quadratic-complexity DoS via the `mailto:` validator scan-loop on attacker text
- **Source** : `package-lock.json`
- **Fix** : `pnpm up linkify-it` (jusqu'à >= `5.0.2`)

### 3. `next` — 15.5.18 → **16.2.11**

- **CVE** : `CVE-2026-64641` (HIGH/DoS), `CVE-2026-64643` (MEDIUM/Data leak), `CVE-2026-64647` (MEDIUM/Data leak), `CVE-2026-64648` (MEDIUM/Data leak)
- **Type** : Data leak, DoS
- **Score max** : 15
- **Title** : next: Next.js: Denial of Service via crafted requests to App Router with Server Actions
- **Source** : `package-lock.json`
- **Fix** : `pnpm up next` (jusqu'à >= `16.2.11`)

### 4. `next-auth` — 5.0.0-beta.30 → **5.0.0-beta.32**

- **CVE** : `GHSA-xmf8-cvqr-rfgj` (HIGH/DoS), `GHSA-x445-f3h2-j279` (MEDIUM/CSRF)
- **Type** : CSRF, DoS
- **Score max** : 15
- **Aussi affectés** (même CVE) : `@auth/core`
- **Title** : Auth.js: getToken() throws an uncaught exception on malformed Bearer authorization headers
- **Source** : `package-lock.json`
- **Fix** : `pnpm up next-auth` (jusqu'à >= `5.0.0-beta.32`)

### 5. `sharp` — 0.34.5 → **0.35.0**

- **CVE** : `GHSA-f88m-g3jw-g9cj` (HIGH/Unclassified)
- **Type** : Unclassified
- **Score max** : 15
- **Title** : sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591
- **Source** : `package-lock.json`
- **Fix** : `pnpm up sharp` (jusqu'à >= `0.35.0`)

### 6. `uuid` — 7.0.3 → **13.0.1**

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
