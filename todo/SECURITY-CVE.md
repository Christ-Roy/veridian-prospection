# 🔒 Veille CVE automatique — veridian-prospection

> **Généré par** : `veridian-infra/.github/workflows/cron-trivy.yml`
> **Dernier run** : 2026-08-04 04:12 UTC
> **Run URL** : local-cron@mail.mybigserveur.local:2026-08-04
> **Image scannée** : `ghcr.io/christ-roy/prospection:latest`
> **CVE bruts détectés** : 6 (avant filtrage)
> **Scoring** : `veridian-infra/ci/trivy-scoring.yml`

## TL;DR

- 🚨 **0 RED** — fix prioritaire
- 🔴 **1 HIGH** — action recommandée cette semaine
- 🟡 **3 MEDIUM** — récap, pas urgent
- 🟢 **1 NOISE** — annexe collapse


---

## 🔴 HIGH — 1 CVE en 1 groupe

### 1. `ip-address` — 10.2.0 → **10.3.1**

- **CVE** : `CVE-2026-69192` (HIGH/SSRF)
- **Type** : SSRF
- **Score max** : 45
- **Title** : ip-address: Address4 decodes leading-zero octets as decimal while resolvers decode them as octal, allowing SSRF and trust-boundary bypass
- **Source** : `package-lock.json`
- **Fix** : `pnpm up ip-address` (jusqu'à >= `10.3.1`)


---

## 🟡 MEDIUM — 3 CVE en 2 groupes

### 1. `ip-address` — 10.2.0 → **10.2.2**

- **CVE** : `CVE-2026-54272` (MEDIUM/SSRF), `CVE-2026-69198` (MEDIUM/SSRF)
- **Type** : SSRF
- **Score max** : 18
- **Title** : ip-address: ip-address: Server-Side Request Forgery via IPv4-mapped/NAT64 IPv6 address misclassification
- **Source** : `package-lock.json`
- **Fix** : `pnpm up ip-address` (jusqu'à >= `10.2.2`)

### 2. `uuid` — 7.0.3 → **13.0.1**

- **CVE** : `CVE-2026-41907` (MEDIUM/Memory corruption)
- **Type** : Memory corruption
- **Score max** : 12
- **Title** : uuid: uuid: Out-of-bounds write vulnerability impacts data integrity and confidentiality
- **Source** : `package-lock.json`
- **Fix** : `pnpm up uuid` (jusqu'à >= `13.0.1`)


---

## 🟢 NOISE filtré (1 CVE)

<details>
<summary>Liste complète (1 groupe — clique pour déplier)</summary>

| Package | Installed | Fix | CVE count | Max score |
|---|---|---|---|---|
| `postcss` | 8.5.18 | 8.5.23 | 1 | 6 |

</details>


---

## Comment réagir

1. **Tu fixes** → bump la dep / la base image, push sur `staging`. Le prochain tick (24h) confirme.
2. **Tu acks le risque** → ajoute un override dans [`veridian-infra/ci/trivy-overrides.yml`](https://github.com/Christ-Roy/veridian-infra/blob/main/ci/trivy-overrides.yml) avec date d'expiration + raison.
3. **Tu ignores** → ne fais rien, le tick recréera ce fichier demain à l'identique.

> Tu peux **supprimer ce fichier librement**. Il sera recréé au prochain tick s'il reste des items à signaler. C'est l'idempotence qui garantit qu'on ne perd rien.

*Pour ajuster les règles : [`veridian-infra/ci/trivy-scoring.yml`](https://github.com/Christ-Roy/veridian-infra/blob/main/ci/trivy-scoring.yml). Ping infra-agent.*
