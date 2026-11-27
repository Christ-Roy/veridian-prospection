# [PROSPECTION] 🎯 Vision — Moteur de sourcing IA sur la DB entreprises (V1 structuré)

> **Sévérité** : 🟡 P1 (chantier structurant — épine dorsale du tunnel de vente)
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Décideur** : Robert (session 2026-06-16)

## Le contexte stratégique (décisions Robert)

Le CRM de Prospection va être **remplacé par Twenty**. Prospection est donc
**relégué à son vrai rôle** : un **référentiel d'entreprises françaises** (996K,
coordonnées fines) + un **moteur de sourcing** piloté par IA.

⚠️ **Distinction d'archi gravée** (à ne JAMAIS confondre) :
- `entreprises` (996K) **n'a PAS de tenant_id** → c'est un **référentiel PARTAGÉ**,
  loué en lecture à tous les tenants. Personne ne le "possède".
- La couche d'interaction (`outreach`, `pipeline`, `call_log`, `followups`,
  `lead_emails`…) **a un tenant_id** → c'est la donnée PROPRE au tenant.
- **Twenty = customisable par tenant** (le CRM du client, ses champs custom).
- **Prospection = référentiel commun + moteur de recherche** (PAS un CRM, PAS
  "customisable par tenant" — ce serait dupliquer 996K lignes × N tenants pour rien).

## L'objectif V1

Une **IA (= moi, l'agent Veridian)** doit pouvoir **trouver les segments de
prospects pertinents** dans la DB pour faire du **cold call** ou de l'**emailing**,
**par itération** : composer une requête → estimer le volume → affiner →
échantillonner → exporter.

### Périmètre V1 (acté)
- **Cible** : Veridian-only (1 tenant logique). MAIS l'API est conçue
  **universelle / multi-tenant-ready** dès V1 (param `tenant_id` dans la
  signature, même inutilisé en V1) pour **ne rien défaire** quand on l'ouvrira
  aux clients SaaS.
- **Moteur** : **structuré d'abord** (JSON de filtres validé → SQL paramétré).
  Couvre 90% du cold call/emailing. PAS de vectoriel en V1 (cf ticket -07 R&D).
- **Interface** : **API REST clean et fine** d'abord. MCP = surcouche plus tard
  (le MCP s'appuie sur l'API → API propre = prérequis). Pas de MCP en V1.
- **Export** : pluggable — Notifuse (emailing), CRM (cold call), Excel/CSV.

### Principes de sécurité NON-NÉGOCIABLES (parano by design)
1. **ZÉRO SQL libre exposé à l'IA.** L'IA envoie du **JSON structuré validé Zod**,
   traduit en **SQL paramétré** par NOTRE code, contre la **whitelist `COLUMN_MAP`**
   (src/lib/queries/shared.ts) qui existe déjà. Jamais d'interpolation de champ
   utilisateur dans le SQL.
2. **Auth machine-to-machine** (bearer/HMAC, pattern `CRON_SECRET` existant) —
   jamais d'accès anonyme, jamais la session UI détournée.
3. **Rate-limit + anti-DoS** : la base fait 996K lignes, un COUNT mal borné la
   met à genoux. Rate-limit par clé, bornes numériques, timeouts.
4. **Anti-scraping** : l'estimate retourne un COUNT, pas les leads. La
   matérialisation (export réel) est tracée et (à terme) quota-gated par tenant.

## L'existant sur lequel on s'appuie (NE PAS réinventer)

Audit 2026-06-16 — il y a déjà ~60% du moteur :
- ✅ **`COLUMN_MAP`** (src/lib/queries/shared.ts) : whitelist de ~80 dimensions
  filtrables (identité, dirigeant+âge, contact normalisé, géo, CA/résultat/marge/INPI,
  NAF/secteur, scoring, ~30 signaux web, 8 certifs, marchés publics).
- ✅ **`RefillIcpFiltersSchema` + `buildIcpWhereSql`** (src/lib/refill-icp/filters.ts) :
  schéma JSON validé Zod → SQL paramétré, DÉJÀ l'archi sûre voulue. Couvre ~7
  dimensions (régions, secteurs+presets, effectifs, CA, âge, qualifiers).
- ✅ **`/api/leads/estimate-count`** : COUNT live d'un segment sans le matérialiser,
  rate-limité, validé. Le patron exact de la boucle d'itération.
- ✅ **Auth machine** : pattern `CRON_SECRET`/bearer sur /api/cron/*, /api/users/by-email.
- ✅ **`ui-dev`** (dev-pub, next dev hot-reload :3100) : banc d'itération existant
  (manque juste une DB clonée de prod — cf ticket -06).

## ⚠️ Pré-requis BLOQUANT découvert le 2026-06-16

La DB staging tourne sur **1 entreprise** (recréée vide). **Aucune API de
recherche n'a jamais été testée sur de la vraie data.** "Ça répond 200 sur une
base vide" ne prouve RIEN (ni la justesse des filtres, ni la perf/index sur 996K).
→ **Le ticket -06 (banc d'essai DB clonée prod) est prioritaire** : sans data
réelle, on code à l'aveugle. Robert (verbatim) : *"il me semble que les api sont
cassé et qu'il a full truc à régler il faut vraiment tout contrôler en mode
parano… un mode next dev sur la db cloné de prod serait pertinent pour itérer"*.

## Les tickets (ordre d'attaque)

0. **-00** (ce fichier) — vision.
1. **-06** — Banc d'essai : next dev sur DB clonée prod + AUDIT PARANO des API existantes. ⚠️ EN PREMIER.
2. **-01** — Endpoint `/api/search/companies` (cœur : JSON filtres → résultats, auth M2M, multi-tenant-ready).
3. **-02** — Étendre le schéma de filtres à tout `COLUMN_MAP` + opérateurs (gte/lte/in/exists/between).
4. **-03** — `/api/search/estimate` généralisé (count + breakdown par dimension) — boucle d'itération.
5. **-04** — `/api/search/sample` (échantillon représentatif sans consommer de quota).
6. **-05** — `/api/search/export` (Notifuse / CRM / Excel-CSV, pluggable, tracé).
7. **-07** — SPEC R&D couche sémantique/vectorielle (pgvector, NL→filtres, "ressemble à…") — DOC ONLY, à définir ensemble après audit.
