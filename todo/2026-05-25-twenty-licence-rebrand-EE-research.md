# [VERIDIAN] Recherche : peut-on rebrand Twenty CRM (CE + EE) pour Veridian CRM ?

> **Type** : Recherche juridique + tech (pas de code)
> **Sévérité** : 🔴 P0 — décision business structurante avant lancement nouveau produit
> **Créé** : 2026-05-25
> **Owner** : Robert (décideur)
> **TL;DR** : **À CLARIFIER (penche vers "autorisé mais lourd")**. AGPLv3 autorise fork + rebrand + revente SaaS. MAIS (1) obligation de publier le code source sous AGPL aux utilisateurs SaaS (Section 13), (2) interdiction d'utiliser la marque "Twenty" et le trade dress, (3) features EE (SSO, RBAC avancé, custom domain) sont sous licence commerciale séparée — interdites en prod sans abonnement, donc à **réécrire from scratch** côté Veridian. Voie viable mais coût élevé.

---

## 1. Contexte

Robert (Veridian, solo) envisage de lancer un nouveau produit **Veridian CRM** — un méta-modèle customisable type Twenty CRM (objets custom, vues, workflows). Plutôt que coder from scratch (effort 6-12 mois minimum), il évalue la possibilité de **forker Twenty + rebrand** pour accélérer le time-to-market.

L'enjeu business : Veridian est positionné en SaaS B2B + consulting haut ticket. Un fork rebrand permettrait de proposer un CRM custom-fit aux clients existants Prospection/Analytics sans repartir de zéro.

Mais Twenty a un **modèle de licence dual** (AGPLv3 + Commercial Enterprise) qu'il faut décortiquer avant tout investissement.

---

## 2. Licence Twenty Community Edition (CE)

### Licence principale : **AGPL v3.0**

Source : [github.com/twentyhq/twenty/blob/main/LICENSE](https://github.com/twentyhq/twenty/blob/main/LICENSE)

**Détenteur** : Twenty.com PBC (Public Benefit Corporation, Delaware, fondée 2023, ex-Airbnb Paris).

**Droits accordés par AGPL v3** :
- ✅ Utilisation commerciale (y compris SaaS)
- ✅ Modification du code source
- ✅ Distribution
- ✅ Sous-licence (toujours en AGPL)
- ✅ **Fork autorisé sans permission préalable**

**Obligations AGPL v3 (les pièges)** :
- ⚠️ **Section 13 (le "SaaS clause")** : *"If you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network an opportunity to receive the Corresponding Source"*. Traduction : **si tu modifies Twenty et que tu l'exposes via réseau (SaaS), tu DOIS rendre TON code modifié disponible sous AGPL à tes utilisateurs SaaS**.
- ⚠️ Toute redistribution doit rester sous AGPL (copyleft fort)
- ⚠️ Inclure le texte de la licence + notices de copyright dans toutes les redistributions
- ⚠️ Documenter les modifications apportées

**Conséquence concrète pour Veridian CRM** :
- Tes clients SaaS peuvent **exiger le code source** de Veridian CRM, et tu dois le leur fournir sous AGPL
- Donc tout concurrent peut **prendre ton code modifié et le re-forker** sous sa propre marque
- Le moat n'est pas le code, c'est l'**exécution + la marque + la distribution**

**Sources** :
- [FOSSA — AGPL License Guide](https://fossa.com/blog/open-source-software-licenses-101-agpl-license/)
- [Open Core Ventures — AGPL is a non-starter](https://www.opencoreventures.com/blog/agpl-license-is-a-non-starter-for-most-companies)

---

## 3. Licence Twenty Enterprise Edition (EE)

### Modèle : **dual-licensing AGPL + Commercial**

Twenty utilise un pattern de **code mixte** : certains fichiers du repo public sont marqués `/* @license Enterprise */` et **NE SONT PAS sous AGPL** — ils sont sous une **licence commerciale propriétaire** définie dans le LICENSE file.

**Texte clé de la licence commerciale** (extrait LICENSE Twenty) :
> *"This part of the software may only be used in production, if you (and any entity that you represent) have agreed to, and are in compliance with, the Terms available at https://twenty.com/legal/terms, or other agreements governing the use of the Software."*

> *"It is forbidden to copy, merge, publish, distribute, sublicense, and/or sell the Software"* (sans licence commerciale valide).

> *"You may copy and modify the Software for development and testing purposes, without requiring a subscription."*

**Traduction business** :
- 🚫 **Tu ne peux PAS utiliser les fichiers EE en production sans abonnement Twenty Cloud**
- 🚫 Tu ne peux pas revendre / sous-licencier les fichiers EE
- ✅ Tu peux les regarder, les modifier, les forker **pour dev/test uniquement**
- ⚠️ Pas de licence "OEM" ou "white-label" publique pour les fichiers EE

**Tarification EE actuelle** ([twenty.com/pricing](https://twenty.com/pricing)) :
| Plan | Prix | Cible |
|---|---|---|
| **Pro** (Cloud) | $9/user/mois | TPE/PME |
| **Organization** (Cloud, ex-EE) | $19/user/mois | Equipe avec besoins SSO/RBAC |
| **Self-hosted CE** | Gratuit (AGPL) | DIY, sans features EE |
| **Self-hosted EE** | **Pas de prix public** — contact sales | Entreprises voulant SSO+RBAC self-hosted |

**Pas de prix OEM/white-label publié**. Il faut demander à `contact@twenty.com` pour négocier un accord custom.

**Sources** :
- [twenty.com/pricing](https://twenty.com/pricing)
- [LICENSE file](https://github.com/twentyhq/twenty/blob/main/LICENSE)

---

## 4. Features EE vs CE — comparatif 2026

D'après [docs.twenty.com](https://docs.twenty.com) + page pricing + analyse des commentaires `@license Enterprise` dans le repo public.

| Feature | CE (AGPL) | EE (Commercial) |
|---|---|---|
| Objets custom (méta-modèle) | ✅ | ✅ |
| Vues custom (Kanban, table, calendrier) | ✅ | ✅ |
| Workflow automation (basique) | ✅ | ✅ |
| Agents IA | ✅ Pro+ | ✅ |
| API REST + GraphQL | ✅ | ✅ |
| Multi-workspace | ✅ | ✅ |
| Auth email/password + Google OAuth | ✅ | ✅ |
| **SSO SAML / OIDC** | ❌ | ✅ EE-only |
| **RBAC granulaire (row-level permissions, custom roles)** | ⚠️ Basique uniquement | ✅ EE-only |
| **Custom domain** | ❌ | ✅ EE-only |
| **Audit logs avancés** | ⚠️ Basique | ✅ EE-only |
| Implementation partners support | ❌ | ✅ |

**Constat clé** : les features EE sont **exactement celles qui font la différence en B2B premium** (SSO entreprise, RBAC fine, white-label de l'URL). C'est la stratégie classique "open core" — la CE attire les devs, l'EE monétise les boîtes sérieuses.

**Source** : [Twenty docs — capabilities](https://docs.twenty.com/user-guide/getting-started/capabilities/what-is-twenty)

---

## 5. Cas de fork+rebrand légaux (précédents)

### Cas 1 — **SuiteCRM fork de SugarCRM** (2014)
- SugarCRM était open-source jusqu'en 2014, puis passé en commercial. SalesAgility a forké la dernière version OSS → SuiteCRM, AGPL.
- **Issue** : SugarCRM a attaqué SuiteCRM sur la **trademark** (utilisation du nom "Sugar" dans certaines pages). SuiteCRM a dû **purger toute trace** du nom et logo Sugar.
- **Leçon** : le **code peut être forké**, mais la **marque ne peut JAMAIS être utilisée** sans accord. Rebrand strict obligatoire.

### Cas 2 — **EspoCRM**
- Forké à l'origine d'un autre projet, lui-même fork. Licence GPL v3.
- Modèle dual-licensing (open-source + Extensions commerciales).
- **Leçon** : la stratégie "core open + extensions commerciales" est la norme dans l'écosystème CRM open-source. C'est ce que fait Twenty.

### Cas 3 — **ERPNext / Frappe**
- Discussion publique sur le forum Frappe ([discuss.frappe.io](https://discuss.frappe.io/t/any-legal-issues-to-sell-erpnext-as-my-product/14159)) : "Can I sell ERPNext as my product ?"
- Réponse de la communauté : **oui, tant que tu respectes GPL (publication du code modifié)**, **tu rebrand** (remplaces "ERPNext" par "MyProduct" partout), **tu n'utilises pas leur trademark**. Plusieurs intégrateurs revendent ERPNext rebrand sans problème légal.
- **Leçon** : c'est faisable, c'est fait, c'est documenté.

### Cas 4 — **Sentry → Functional Source License (FSL)**
- Sentry était BSD-3, passé en BSL en 2019, puis FSL en 2023. Pourquoi ? **Empêcher les fork-and-resell** (genre AWS qui prend Elastic).
- **Leçon importante pour Veridian** : **Twenty peut faire pareil demain**. Si Twenty passe en BSL/FSL, **ton fork resterait sur la dernière version AGPL**, mais tu n'aurais plus accès aux nouveautés. Risque réel.

**Sources** :
- [Sentry — Functional Source License](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/)
- [Sentry blog — Fair Source](https://blog.sentry.io/sentry-is-now-fair-source/)

---

## 6. Risque trademark "Twenty"

### Faits

- **Twenty.com PBC** détient le trademark **"20"** déposé à l'USPTO le 7 août 2023, serial number 98119420, catégorie : "Providing temporary use of on-line non-downloadable open-source software for customer relationship management."
- Source : [Justia Trademarks — Twenty.com PBC](https://trademarks.justia.com/owners/twenty-com-pbc-5607520/)
- Terms of Service Twenty : *"Our trademarks and trade dress may not be used in connection with any product or service"* sans autorisation écrite préalable.

### Conséquences pour Veridian CRM

- ✅ **Tu peux fork le code AGPL** sans demander la permission
- 🚫 **Tu DOIS retirer absolument tout** : nom "Twenty", logo, couleurs spécifiques, slogans, screenshots officiels, favicon, mentions "Twenty" dans le code ou la doc
- 🚫 Le "trade dress" (look-and-feel distinctif) est aussi protégé — donc **ne pas copier pixel-perfect l'UI Twenty**. Repenser le design system Veridian de toute façon (déjà OKLCH custom, donc on est bons)
- 🚫 Pas de "Powered by Twenty" — au contraire, **purger les mentions** sauf attribution AGPL minimale légalement requise (notice copyright dans LICENSE/credits)

### Cas connus

- Aucun cas public connu de **procès Twenty Inc. vs fork rebrand** à date (2026-05-25). Twenty est jeune (fondé 2023), peu de forks commerciaux visibles.
- Le seul fork visible est `youngsecurity/crm-twenty` qui semble être un mirror sans rebrand.

### Risque réel

- **Faible si rebrand strict** : pas de mention "Twenty", design refondu, marketing autonome
- **Moyen** si tu fais "Veridian CRM, powered by Twenty fork" ou tu reprends l'UI à l'identique → risque trademark dilution
- **Élevé** si tu prétends être "Twenty Enterprise" ou utilises leur marque comme accroche

---

## 7. Voies possibles pour Veridian CRM

### Voie 1 — **Fork CE pur + rebrand + dev nos features EE-like**

**Description** : Tu fork `twentyhq/twenty`, tu retires tous les fichiers `@license Enterprise`, tu rebrand intégralement (nom, logo, design system Veridian, domaine `crm.veridian.site`), tu développes **toi-même** les équivalents EE (SSO via Hub Veridian — déjà fait pour Prospection ! — , RBAC custom, custom domain, audit logs).

**Faisabilité** : ✅ Légalement OK (AGPL autorise fork + rebrand + revente SaaS)

**Effort** :
- Rebrand initial : 1-2 semaines (search/replace + refonte design system)
- Retirer/réimplémenter les features EE : 4-8 semaines (SSO réutilise déjà l'infra Hub Veridian, RBAC = 2-3 semaines)
- Maintenir le fork à jour avec upstream Twenty : 1-2j/mois récurrent (rebase + résolution conflits, surtout sur le méta-modèle)

**Risque** :
- 🟡 Obligation AGPL : publier ton code modifié à tes clients SaaS (Section 13). Le moat = exécution, pas code.
- 🟢 Trademark : 0 problème si rebrand strict
- 🟡 Pivot risk : si Twenty passe en BSL demain, tu restes sur la dernière version AGPL et tu maintiens seul

**Coût** : Quasi-zéro cash (juste ton temps). Total dev : ~2-3 mois solo.

**Verdict** : 🟢 **Voie la plus rationnelle si tu veux du CRM brandé Veridian sans investir 12 mois.**

---

### Voie 2 — **Acheter licence EE Twenty + rebrand officiel**

**Description** : Tu contactes Twenty.com PBC pour négocier un accord OEM/white-label. Tu paies une licence qui autorise (a) usage prod des fichiers EE, (b) rebrand légal sous Veridian, (c) revente SaaS.

**Faisabilité** : ⚠️ **Pas de programme OEM public**. Il faut négocier custom. La page [twenty.com/partners](https://twenty.com/partners) parle uniquement de "Technology Partners", "Content & Community Partners", "Solutions Partners" (intégrateurs certifiés) — **aucune mention de OEM ou white-label**.

**Effort** : Négociation 1-3 mois, contrat custom, NDA, accord redistribution.

**Risque** :
- 🔴 Twenty est en early stage (~50M$ Series A, valorisation modeste). Ils peuvent refuser un OEM par peur de cannibaliser leur cloud.
- 🔴 Prix probable : **plusieurs k€/mois minimum** + revenue share. Veridian solo pré-commercial ne peut pas absorber ça.
- 🟡 Dépendance forte : si Twenty change de stratégie, ton produit est mort

**Coût** : Inconnu, probablement >5k€/mois floor + revshare 20-30%.

**Verdict** : 🔴 **Hors budget pour Veridian solo. À réserver à un Veridian post-Series A.**

---

### Voie 3 — **Inspiration UX/archi only (clean room reimplementation)**

**Description** : Tu n'utilises **PAS une ligne du code Twenty**. Tu étudies leur archi (objets custom, méta-modèle, workflows), tu codes from scratch en Next.js + Prisma (stack Veridian déjà maîtrisée), tu t'inspires des concepts mais tout le code est neuf.

**Faisabilité** : ✅ Légalement bétonné (zéro contamination AGPL, zéro risque trademark)

**Effort** : **6-12 mois solo** pour un MVP comparable à Twenty CE. Lourd.

**Risque** :
- 🟢 Aucun risque légal
- 🟢 Aucune dépendance Twenty
- 🟢 Stack 100% Veridian (Next.js + Prisma + Hub auth déjà câblé)
- 🔴 Time-to-market : tu rates la fenêtre commerciale

**Coût** : Ton temps × 6-12 mois.

**Verdict** : 🟡 **Voie noble mais coût opportunité énorme. Faisable si tu veux un produit 100% Veridian-owned long terme.**

---

### Voie 4 — **Partnership Twenty (Solutions Partner / reseller)**

**Description** : Tu rejoins le programme "Solutions Partners" de Twenty ([twenty.com/partners](https://twenty.com/partners)). Tu deviens intégrateur certifié, tu vends Twenty Cloud à tes clients avec **revenue share + remise revente**. Tu ne rebrand PAS — tu vends Twenty officiel + tes services consulting/customisation par-dessus.

**Faisabilité** : ✅ Programme public et accessible

**Effort** : Inscription, certification (probablement quelques jours/semaines de formation), pas de dev produit

**Risque** :
- 🟢 Aucun risque légal
- 🔴 Tu vends "Twenty" sous leur marque, pas "Veridian CRM" → ça ne crée pas de produit Veridian, juste un revenu de consulting
- 🟡 Tu es prisonnier des évolutions Twenty + de leur pricing

**Coût** : Zéro investissement, revenue share ~20-30% probable.

**Verdict** : 🟡 **Pas un produit Veridian, c'est du consulting Twenty. Bon revenue d'appoint mais pas l'objectif initial de Robert.**

---

## 8. Ma recommandation

### Reco principale : **Voie 1 — Fork CE + rebrand + dev features EE-like en interne** (~75% de confiance)

**Pourquoi cette reco** :

1. **Faisabilité légale claire** : AGPL autorise expressément ce flow. Pas de zone grise.
2. **Effort raisonnable** : 2-3 mois solo, vs 6-12 mois en clean room. Time-to-market acceptable.
3. **Features EE déjà faisables maison** : Veridian Hub fait déjà SSO multi-app (OAuth Google/Microsoft + magic link), RBAC custom (rôles workspace + impersonate), custom domain (CMS + Analytics le font déjà). Ce sont les briques que Twenty vend en EE — **tu les as déjà**.
4. **Obligation AGPL = pas un blocker** : tu publies ton code modifié à tes clients SaaS. Le moat Veridian, c'est : (a) intégration native avec Hub/Prospection/Analytics/CMS/Notifuse, (b) marque, (c) consulting français premium. Pas le code CRM lui-même.
5. **Pivot risk acceptable** : même si Twenty passe en BSL dans 6 mois, ton fork est figé au dernier commit AGPL et tu maintiens seul.

**Conditions de succès** :
- Rebrand **strict** dès le jour 1 (purge "Twenty" partout dans code/UI/doc)
- Refonte design system Veridian (déjà fait pour Prospection, à dupliquer)
- Publier le repo Veridian CRM en public (obligation AGPL Section 13) — peut être un "feature marketing" en se positionnant "open source friendly"
- Documenter publiquement l'attribution upstream (LICENSE + NOTICES file mentionnant "Based on Twenty CRM, licensed under AGPL v3")

**Garde-fou** : **avant de pousser un seul commit de fork**, audit légal de 1-2h avec un avocat spécialisé open-source (genre Heer Law, Gesmer, ou un cabinet français comme @Crémades + Calvo). Coût ~500-1000€. À budgétiser.

### Reco secondaire (si Voie 1 trop lourde) : **Voie 4 — Solutions Partner**

Si Robert veut tester le marché CRM **sans investir 2-3 mois dev**, devenir Solutions Partner Twenty est le test cheap : 0 effort produit, revenue share immédiat. Si traction → bascule en Voie 1.

### Anti-recos claires

- ❌ **Voie 2 (acheter EE OEM)** : pas de programme public, prix prohibitif pour Veridian solo
- ❌ **Voie 3 (clean room from scratch)** : 6-12 mois solo, coût opportunité énorme vs Voie 1
- ❌ **Mixer code EE et fork CE** : interdit par la licence commerciale Twenty, risque procès

---

## 9. Questions ouvertes pour Robert

1. **Quelle est ta timeline cible** pour livrer un premier MVP Veridian CRM à un client ? Si <2 mois → Voie 1 obligatoire. Si <1 semaine → seule la Voie 4 (revente Twenty) marche.

2. **Es-tu OK avec l'obligation AGPL** de publier ton code Veridian CRM modifié à tes clients SaaS (Section 13) ? Si non → seule la Voie 3 (clean room from scratch) marche.

3. **Veux-tu un produit SaaS scalable** (B2B multi-tenant à grande échelle) ou un **produit consulting custom-fit** (1 instance par gros client) ? Si consulting custom-fit, l'obligation AGPL Section 13 est triviale (tu publies à 5 clients, c'est rien).

4. **Budget audit légal initial** : OK pour ~500-1000€ d'avocat open-source avant le premier commit de fork ? Indispensable pour bétonner la voie 1.

5. **Tolérance au "pivot risk"** : si Twenty change de licence dans 6 mois et que tu te retrouves à maintenir le fork seul, est-ce acceptable ? Si non → Voie 3 (clean room).

---

## Annexe — Sources consultées

- [Twenty CRM LICENSE file](https://github.com/twentyhq/twenty/blob/main/LICENSE) — dual licensing AGPL + Commercial
- [Twenty Pricing](https://twenty.com/pricing) — Pro $9, Organization $19, self-hosted CE gratuit
- [Twenty Partners](https://twenty.com/partners) — Solutions, Tech, Content (pas d'OEM)
- [Twenty Terms of Service](https://twenty.com/legal/terms) — trademark restrictions
- [Justia Trademarks — Twenty.com PBC](https://trademarks.justia.com/owners/twenty-com-pbc-5607520/) — TM "20" déposé USPTO 2023
- [FOSSA — AGPL Guide](https://fossa.com/blog/open-source-software-licenses-101-agpl-license/) — obligations AGPL Section 13
- [Open Core Ventures — AGPL non-starter](https://www.opencoreventures.com/blog/agpl-license-is-a-non-starter-for-most-companies) — contraintes commerciales
- [ERPNext fork legal discussion](https://discuss.frappe.io/t/any-legal-issues-to-sell-erpnext-as-my-product/14159) — précédent rebrand AGPL/GPL
- [Sentry FSL announcement](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/) — pivot risk licence
- [Vaultinum — AGPL Compliance Guide](https://vaultinum.com/blog/essential-guide-to-agpl-compliance-for-tech-companies) — best practices conformité
