# leads-to-twenty — Pont SEARCH → Twenty CRM

Pousse un **segment d'entreprises** trouvé via le moteur de recherche IA
(`POST /api/search/companies`) dans le **CRM Twenty** Veridian, de façon
**idempotente** (rejouable sans doublon).

> Cas d'usage type : un agent Claude a isolé un segment e-commerce
> (`ecom_platform` renseigné = boutique confirmée) via l'API search, et veut
> le charger dans le CRM pour lancer une campagne cold-call / outbound.

---

## TL;DR

```bash
# Dry-run (n'écrit RIEN, montre ce qui serait poussé) — TOUJOURS commencer par là
npx tsx scripts/leads-to-twenty.ts \
  --filters '{"all":[{"field":"ecom_platform","op":"exists","value":true}]}' \
  --limit 500 --object companies --campaign "Ecom boutique 0711" --dry-run

# Push réel dans Twenty prod
npx tsx scripts/leads-to-twenty.ts \
  --filters '{"all":[{"field":"ecom_platform","op":"exists","value":true}]}' \
  --limit 500 --object companies --campaign "Ecom boutique 0711"
```

---

## Comment ça marche

1. **Récupère le segment** via `POST {--api-url}/api/search/companies`
   (bearer `PROSPECTION_TENANT_API_SECRET` lu dans `~/credentials/.all-creds.env`),
   pagine jusqu'à `--limit` (page_size max 200), trié par `prospect_score` desc.
2. **Mappe** chaque entreprise → payload Twenty via `FIELD_MAP` (en tête du script).
3. **Upsert idempotent** par clé stable : lookup REST → `PATCH` si existant,
   `POST` sinon. Backoff exponentiel sur 429.
4. **Résumé** : créés / màj / skippés / erreurs. Exit code 0 (OK) ou 1 (erreurs).

Toute I/O Twenty passe par le CLI `~/bin/twenty` (skill `admin-twenty`) — le
script **ne réécrit pas l'auth CRM** : le CLI porte le Bearer admin + gère
prod/staging + absorbe les pièges REST.

---

## Options

| Flag | Défaut | Rôle |
|---|---|---|
| `--filters '<json>'` | — | Filtres SearchFilters (`{all:[],any:[]}`). Voir `/api/search/fields` pour le catalogue. |
| `--sirens 123,456` | — | Alternative : liste explicite de SIREN (le search API les résout). |
| `--limit N` | 500 | Nb max de leads. |
| `--object` | `companies` | Cible Twenty : `companies` \| `people` \| `cold_prospects`. |
| `--campaign "<nom>"` | — | Étiquette de campagne (ICP côté company, source côté cold_prospect). |
| `--dry-run` | off | N'écrit rien, affiche les payloads. |
| `--api-url <url>` | `https://prospection.staging.veridian.site` | Base du search API. |
| `--twenty-env` | `prod` | Workspace Twenty ciblé (`prod` \| `staging`). |

`--filters` **ou** `--sirens` est obligatoire (l'un des deux).

---

## Choix de l'objet Twenty

| Objet | Dédup | Quand l'utiliser |
|---|---|---|
| **`companies`** ⭐ | `siren` (field custom stable) | **Défaut recommandé.** Porte siren + secteur + CA + géo + score + obsolescence web. Dédup fiable. |
| `people` | `emails.primaryEmail` | Pour créer la fiche **dirigeant** (nom + email + phone + jobTitle). Dédup par email → skip si pas d'email. |
| `cold_prospects` | `societe` (faible) ⚠️ | Pile de cold-call minimaliste. **Pas de field siren** → dédup best-effort par raison sociale, les infos (siren/email/ecom) partent dans `notes`. |

> **Reco** : pousse d'abord les **`companies`** (référentiel propre, dédup
> solide), puis éventuellement les **`people`** pour les dirigeants avec email.
> `cold_prospects` seulement si tu veux alimenter directement le kanban de
> cold-call sans passer par la structure company/person.

---

## Mapping des champs (FIELD_MAP)

Composites Twenty utilisés (vérifiés sur le workspace 2026-07-11) :

- `name` (person) = `{firstName, lastName}` — `splitName()` gère "NOM Prénom" (INPI) et "Prénom Nom".
- `emails` = `{primaryEmail, additionalEmails:[]}`
- `phones` = `{primaryPhoneNumber, primaryPhoneCallingCode, primaryPhoneCountryCode}`
- `domainName` (company) = `{primaryLinkUrl, primaryLinkLabel, secondaryLinks:[]}`
- `annualRevenue` (company) = `{amountMicros, currencyCode}` — **CA € × 1 000 000** (micro-unités).

### company (par défaut)

| Search field | → Twenty company |
|---|---|
| `denomination` | `name` |
| `siren` | `siren` (dédup) |
| `web_domain` | `domainName` + `siteWebUrl` |
| `secteur_final` | `secteur` |
| `commune` / `departement` / `code_postal` | `commune` / `departement` / `codePostal` |
| `code_naf` | `codeNaf` |
| `chiffre_affaires` | `annualRevenue` (× 1e6 micros) |
| `prospect_score` | `prospectScore` |
| `web_obsolescence_score` | `webObsolescenceScore` |
| ecom (`ecom_level` + `ecom_platform`) + `--campaign` | `idealCustomerProfile` (tag texte, ex `ecom:boutique · woocommerce · Ecom 0711`) |

---

## ⚠️ FIELDS TWENTY À CONFIRMER par le lead

Le mapping ci-dessus suppose des **fields custom** déjà présents sur le
workspace Twenty. Ceux **confirmés existants** au 2026-07-11 (inspection REST
d'un record) :

- **company** : `siren`, `domainName`, `siteWebUrl`, `secteur`, `commune`,
  `departement`, `codePostal`, `codeNaf`, `annualRevenue`, `prospectScore`,
  `webObsolescenceScore`, `idealCustomerProfile`, `certifications`, `effectifs`,
  `employees` ✅
- **person** : `name`, `emails`, `phones`, `jobTitle`, `prospectScore`,
  `qualiteDirigeant`, `companyId` ✅
- **cold_prospect** : `name`, `societe`, `telephone`, `source`, `statut`,
  `notes`, `promu`, `doNotContact` ✅

**À faire côté Twenty (via `admin-twenty` / MCP) si on veut aller plus loin :**

1. **`ecom_platform` en field dédié** (company) — aujourd'hui l'info e-commerce
   est fondue dans `idealCustomerProfile` (texte). Pour **filtrer/segmenter** dans
   le CRM sur la plateforme, créer un field custom `ecomPlatform` (texte ou
   select) + `ecomLevel` (select boutique/catalogue/aucun). Puis ajouter les
   clés dans `FIELD_MAP.companies`.
2. **`siren` sur `cold_prospect`** — l'objet cold_prospect **n'a pas** de field
   siren, donc sa dédup est faible (par `societe`). Si on pousse régulièrement
   des cold_prospects, créer un field custom `siren` (unique) + basculer
   `REST_META.cold_prospects.dedupField` dessus.
3. **`source` sur `company`** — pour tracer la provenance (search vs manuel),
   créer un field `source` company et l'ajouter au mapping (aujourd'hui la
   provenance company vit dans `idealCustomerProfile`).
4. **Lier person → company** (`companyId`) — le script pousse company et person
   **séparément**. Pour rattacher le dirigeant à sa boîte, il faudra un 2e passage
   (résoudre le `companyId` via lookup siren puis PATCH person). Non implémenté
   pour rester simple — à câbler si besoin.

> Le lead/skill a le MCP `twenty-crm` pour créer ces fields
> (`create_one_field` / metadata) et confirmer les noms exacts.

---

## 🔴 Prérequis de secret (bloquant à ce jour)

Le search API (`/api/search/*`, staging **et** prod) répond **401** avec la
valeur de `PROSPECTION_TENANT_API_SECRET` du vault. La route est bien déployée
(elle renvoie 401, pas 404), donc le container attend un secret **différent** de
celui du vault (`SEARCH_API_SECRET` / `TENANT_API_SECRET` côté Dokploy).

**À réconcilier par le lead avant push réel** : aligner la clé du vault
`PROSPECTION_TENANT_API_SECRET` sur la valeur réellement injectée dans le
container Prospection (ENV `SEARCH_API_SECRET`), ou exporter le bon secret :

```bash
export PROSPECTION_TENANT_API_SECRET="<valeur ENV du container>"
# le script lit process.env en priorité sur le vault
```

Tant que ce n'est pas fait, le script s'arrête proprement sur
`search API 401: Unauthorized` (aucune écriture Twenty tentée).

---

## Idempotence & sécurité

- **Idempotent** : rejouer la même commande ne crée pas de doublon (lookup
  siren/email avant chaque write). Une 2e passe = des `UPDATE`.
- **Séquentiel** : un lead à la fois (pas de rafale) → respecte le rate-limit
  Twenty. Backoff exponentiel (500ms → 8s) sur 429, 4 retries.
- **Zéro secret en dur / en argv** : tout vient de `~/credentials/.all-creds.env`
  ou de `process.env`.
- **Timeouts** : 30s search, 30s par appel CLI Twenty.
- **`--dry-run`** ne fait **aucune** écriture (mais interroge quand même Twenty
  en lecture pour dire CREATE vs UPDATE).

---

## Exemples

```bash
# Segment e-commerce HAUTE CONFIANCE (plateforme détectée) → companies prod
npx tsx scripts/leads-to-twenty.ts \
  --filters '{"all":[{"field":"ecom_platform","op":"exists","value":true},{"field":"departement","op":"eq","value":"75"}]}' \
  --object companies --campaign "Ecom Paris" --limit 1000

# Les mêmes en fiches dirigeant (person), seulement ceux avec email
npx tsx scripts/leads-to-twenty.ts \
  --filters '{"all":[{"field":"ecom_platform","op":"exists","value":true},{"field":"email","op":"exists","value":true}]}' \
  --object people --limit 500

# Liste explicite de SIREN → dry-run
npx tsx scripts/leads-to-twenty.ts --sirens 546880139,552032534 --dry-run

# Cible le workspace Twenty staging (test isolé)
npx tsx scripts/leads-to-twenty.ts --filters '{"all":[]}' --limit 10 --twenty-env staging --dry-run
```
