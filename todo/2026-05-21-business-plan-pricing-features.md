# Business plan, pricing et roadmap features Veridian Prospection

> **Type** : Document business vivant (pas un dev ticket)
> **Owner** : Robert + agent Prospection
> **Créé** : 2026-05-21
> **Statut** : 🟡 Brouillon en cours d'affinage — éléments captés depuis la session 2026-05-21 nuit. À itérer.

## Objectif du document

Centraliser les décisions business sur Prospection : positionnement marché, pricing, features de différenciation, roadmap commerciale. Sert de source de vérité pour aligner :
- Les développements code (priorisation features)
- La communication marketing (landing, pitch)
- Les arbitrages produit ("on fait pour qui, pourquoi, contre qui")

Ce document est **vivant** — chaque décision business le met à jour. Les zones de flou identifiées sont listées en fin pour traitement itératif.

---

## 1. Positionnement marché

### 1.1 Cible

**Décision** : pas de niche tranchée pour le lancement. Vendre à tout le monde avec un maximum de features, observer les usages réels, puis affiner par segment.

**Hypothèses de segments cible (à valider terrain)** :
- **A — Indépendants / freelances / TPE solo** (1-3 personnes)
- **B — PME équipe commerciale** (5-25 commerciaux)
- **C — Agences de prospection / outsourcing commercial**

**Stratégie d'adaptation** : prévoir des "switch dans l'app" pour avoir plusieurs modes (notamment sur le facteur de pré-qualification), permettant à chaque segment de configurer son usage sans changer de produit.

### 1.2 Différenciation vs concurrence

**Concurrents identifiés** : Apollo, Lusha, Cognism, Kaspr, Pharow, Surfe.

**Risque sans différenciation** : si on lance avec uniquement "zone géographique + code NAF", on est commodité interchangeable avec Apollo et Kaspr (qui font ça depuis 5 ans).

**Avantage différenciant déjà disponible (sous-exploité)** : **les données INPI** (statuts d'entreprise, gérants, capitaux, événements légaux). C'est ce qui fait la puissance de Pharow et Surfe en France.

---

## 2. Pricing — modèle figé (session 2026-05-21)

> 🔒 **Source de vérité code** : `src/lib/billing/plans.ts` (plan-as-code).
> Toute évolution de pricing modifie d'abord ce fichier, puis ce doc, puis
> côté Hub (Stripe products + matrice `PROSPECTION_PLANS`).

### 2.1 Modèle business — 2 flux de revenus distincts

**Flux 1 — Abonnement récurrent SaaS (l'app)**
Ce qu'on vend : l'accès à l'outil (CRM, recherche, pipeline, intégration newsletter Notifuse, scoring ICP, multi-membre seats, intégrations).
Le quota leads n'est **PAS** lié à ce flux.

**Flux 2 — Achat de leads à la commande (la data)**
Ce qu'on vend : import de lots de leads dans le workspace du tenant.
Achat one-shot, prix dégressif selon quantité + selon plan.
Une fois achetés, les leads restent dans le workspace pour toujours (mécanique "j'ai acheté ma data, elle est à moi").

**Cadeau bienvenue** : à chaque souscription d'un plan payant, l'user reçoit un lot de leads offert (`welcomeLeads`) pour démarrer / tester l'outil sans payer la data tout de suite.

### 2.2 Plans (3 plans publics + 3 plans offerts)

| Plan | Prix mensuel HT | Annual (-17%) | Welcome leads | Seats | Workspaces |
|---|---|---|---|---|---|
| **Freemium** | 0€ | — | 100 | illimité* | illimité |
| **Pro** | **29€** | 290€/an | 2 000 | 5 | illimité |
| **Business** | **89€** | 890€/an | 8 000 | 25 | illimité |

**Prix arrêtés** 2026-05-21 (Robert).

*Freemium "seats illimités" = growth hack : chaque invité devient un freemium séparé côté Hub (déclenche son propre workspace freemium, multiplie l'acquisition virale). Pour partager un workspace avec d'autres membres comptés en seats, prendre Pro ou Business.

**Plans offerts** (assignés manuellement par admin Hub, immunes au downgrade Stripe) :
- `lifetime_site_vitrine` — client qui a pris un site vitrine Veridian
- `lifetime_partner` — partenaire revendeur
- `internal` — usage interne équipe Veridian

### 2.3 Refill leads — prix dégressif par tranche

Tarifs **draft** en centimes d'euro (cf `LEAD_REFILL_PRICING` dans plans.ts) :

| Plan | 1-99 leads | 100-999 | 1k-9k | 10k-49k | 50k+ |
|---|---|---|---|---|---|
| Freemium | 0,50€ | 0,40€ | 0,30€ | — | — |
| Pro | 0,30€ | 0,25€ | 0,18€ | 0,12€ | — |
| Business | 0,20€ | 0,15€ | 0,10€ | 0,06€ | 0,04€ |

Cap de sécurité : `MAX_LEADS_PER_REFILL_ORDER = 100 000` leads par commande.

### 2.4 Découpage features par plan

Source figée dans `src/lib/billing/plans.ts:PLANS[*].features`.

| Feature | Freemium | Pro | Business |
|---|---|---|---|
| `search_basic` (zone + secteur) | ✓ | ✓ | ✓ |
| `search_advanced` (INPI fraîcheur, growth, web) | — | ✓ | ✓ |
| `icp_scoring` (scoring ICP personnalisé) | — | ✓ | ✓ |
| `pipeline_basic` (contacté / non contacté) | ✓ | ✓ | ✓ |
| `pipeline_advanced` (kanban, statuts custom, followups) | — | ✓ | ✓ |
| `multi_seat` (collègues sur MÊME workspace) | — | ✓ | ✓ |
| `workspace_unlimited` (créer plusieurs workspaces) | ✓ | ✓ | ✓ |
| `notifuse_sequences` (enrôler dans séquence email) | — | ✓ | ✓ |
| `csv_export` (export CSV des leads) | — | ✓ | ✓ |
| `api_access` (clés API publiques) | — | — | ✓ |
| `verified_emails` (emails pro devinés + validés MX) | — | ✓ | ✓ |
| `growth_signals` (recrutements, événements INPI) | — | — | ✓ |

### 2.5 Décisions arrêtées

- ✅ **Pas de quota leads/mois** sur l'abonnement (modèle initial abandonné). L'abonnement débloque l'app, point.
- ✅ **Welcome pack** : 100 / 2000 / 8000 leads selon plan (one-shot à la souscription)
- ✅ **Leads achetés = permanents** dans le workspace (pas de récupération si downgrade)
- ✅ **Freemium peut inviter** des membres = growth hack (invité devient un freemium séparé)
- ✅ **Refill dégressif** par tranche + par plan
- ✅ **Cap 100k leads** par commande

### 2.6 Mécanique de paiement — Option B Stripe Checkout one-shot

**Décision tranchée 2026-05-21 par agent (Robert delegate)** :

**Abonnement SaaS** = Stripe Subscription récurrente classique (mensuel ou annuel -17%).
**Achat de leads** = Stripe Checkout one-shot par commande, prix calculé serveur via `calculateRefillCostCents(plan, quantity)`.

**Pourquoi pas Stripe Metered** : modèle Veridian = leads permanents dans workspace, pas de quota mensuel à mesurer. Metered Stripe ne sert que si on facture "cumul fin de mois". Inutile et confusing pour l'user.

**Pourquoi pas Crédits Wallet** : sur-engineering tant qu'on n'a qu'une seule action monétisable (commande de leads). À reconsidérer en v2 si on monétise d'autres actions (envoi séquence Notifuse, scoring premium, etc.).

**Roadmap v1.1** : Option D auto-topup (re-commande automatique quand stock workspace < 10% du dernier achat) pour les heavy users qui le demandent.

### 2.7 Valorisation DB et justification des prix

**Marché de référence (France 2026)** : lead enrichi B2B = 0,05€ (commodity SIREN brut) à 0,50€ (haut de gamme avec email vérifié + intent data).

**Veridian aujourd'hui (Niveau 2 — INPI enrichi)** : 0,10-0,20€/lead réaliste.
**Veridian cible v1 (Niveau 3 — INPI + email vérifié + ICP score)** : 0,30-0,40€/lead.

**Catalogue actuel** : 996 657 leads × 0,15€ moyen = ~150 000€ valeur brute catalogue. Vendable en non-exclusif → fontaine, pas stock.

### 2.8 Modèle revenu prévisionnel (prudent, 12 mois)

| Mois | Freemium actifs | Pro payants | Business payants | MRR app | Refill mensuel | Total mensuel |
|---|---|---|---|---|---|---|
| M3 | 100 | 10 | 1 | 689€ | 200€ | ~900€ |
| M6 | 400 | 40 | 5 | 2 955€ | 1 200€ | ~4 200€ |
| M12 | 1 500 | 150 | 25 | 12 325€ | 6 000€ | ~18 300€ |

**ARR à M12 prudent = 220k€**. Cible M24 = 500-700k€ si exécution OK.

### 2.9 Comparaison cross-app — Notifuse (référence Veridian) vs Prospection

> Importé depuis `notifuse-veridian/todo/2026-05-20-pricing-plans-implementation.md`
> et `VISION-BUSINESS.md` à la racine veridian-platform.
> Notifuse a 4 plans (Free/Pro/Business/Enterprise), Prospection 3 (Freemium/Pro/Business)
> — décision à challenger : on ajoute "Enterprise" pour Prospection aussi ?

#### Grille Notifuse (live en code Notifuse, V37)

| | **Free** | **Pro 29€/mo** | **Business 99€/mo** | **Enterprise sur devis** |
|---|---|---|---|---|
| **Emails/mois** | 300 | 10 000 | 50 000 | Illimité |
| **Contacts en base** | 500 | 5 000 | 25 000 | Illimité |
| **Seats** | 1 | 5 | 25 | Illimité |
| **Comptes OAuth (BYO Gmail/Outlook)** | 1 | 5 | 25 | Illimité |
| **Domaines custom** | 0 | 1 | 5 | Illimité |
| **Templates MJML** | Illimités | Illimités | Illimités | Illimités |
| **Automation sequences** | 1 active | Illimitée | Illimitée + branches | Illimitée |
| **A/B testing** | ❌ | ✅ | ✅ multi-variant | ✅ |
| **Tracking opens/clicks** | Basique | Avancé (heatmap, geo) | + reports exportables | + custom |
| **Branding "Powered by Veridian"** | ✅ obligatoire | ❌ retiré | ❌ + option white-label complet | ❌ |
| **Support** | Communauté/docs | Email < 24h | Email prioritaire < 4h | Slack dédié + SLA |
| **Historique** | 30 jours | 12 mois | Illimité | Illimité |
| **API access** | ❌ | ✅ | ✅ + webhooks sortants | ✅ |
| **SSO/SAML** | ❌ | ❌ | Coming soon | ✅ |

#### Grille Prospection — proposée 2026-05-21 (cette session)

| | **Freemium** | **Pro 49€/mo** | **Business 199€/mo** | **Enterprise** |
|---|---|---|---|---|
| **Welcome leads (one-shot)** | 100 | 2 000 | 8 000 | À cadrer |
| **Refill leads min unit** | 0,40€ | 0,25€ | 0,15€ | Sur devis |
| **Seats (sur MÊME workspace)** | 1* | 5 | 25 | Illimité |
| **Workspaces internes** | Illimité | Illimité | Illimité | Illimité |
| **Recherche basique (zone+secteur)** | ✓ | ✓ | ✓ | ✓ |
| **Filtres INPI avancés (fraîcheur, growth, web)** | ❌ | ✓ | ✓ | ✓ |
| **Scoring ICP personnalisé** | ❌ | ✓ | ✓ | ✓ |
| **Pipeline kanban + statuts custom** | ❌ | ✓ | ✓ | ✓ |
| **Notifuse séquences email** | ❌ | ✓ | ✓ | ✓ |
| **Export CSV** | ❌ | ✓ | ✓ | ✓ |
| **Emails pro vérifiés MX** | ❌ | ✓ | ✓ | ✓ |
| **API access** | ❌ | ❌ | ✓ | ✓ |
| **Growth signals (recrutements, événements)** | ❌ | ❌ | ✓ | ✓ |
| **Branding "Powered by Veridian"** | ✅ obligatoire | ❌ retiré | ❌ + white-label | ❌ |
| **Support** | Communauté/docs | Email < 24h | Email prioritaire < 4h | Slack dédié + SLA |

*Freemium 1 seat sur le workspace propre, mais peut inviter d'autres user qui deviendront freemium séparés (growth hack).

#### Observations clés

**Cohérences cross-app voulues** :
- 4 paliers Free/Pro/Business/Enterprise (à confirmer pour Prospection — actuellement 3, manque Enterprise)
- Trial 15j basé activité réelle (cf. `VISION-BUSINESS.md` §"Trial Free")
- Free strict + branding obligatoire ✓
- Pro retire branding ✓
- Business multi-seat ✓ + features avancées (API, growth signals)
- Enterprise sur devis

**Différences justifiées** :
- **Notifuse Pro 29€ < Prospection Pro 49€** : Notifuse a une infra mail coûteuse à servir (BYO atténue), Prospection a une DB enrichie qui coûte cher à constituer + droits intellectuels données INPI.
- **Notifuse Business 99€ < Prospection Business 199€** : idem + Prospection segment plus haut de gamme (commerciaux PME qui ont déjà des process, Notifuse touche aussi indépendants/asso/PME).
- **Notifuse facture quota mensuel récurrent** (10k emails/mois renouvelés) ; **Prospection facture welcome one-shot + commandes à la demande**. Modèles distincts car la valeur est différente : 1 email envoyé chez Notifuse = action récurrente d'usage ; 1 lead chez Prospection = data permanente acquise (propriété).

**Incohérences à arbitrer** :
- ❗ Prospection n'a actuellement pas de plan Enterprise — à ajouter pour cohérence cross-app (sur devis, sales-driven).
- ❗ Prospection n'a pas de trial Pro/Business 15j basé activité — décision agent 2026-05-21 : welcome pack 2000 leads remplace, mais pas 100% aligné avec la vision cross-app. À rediscuter.
- ❗ Notifuse a un quota OAuth accounts (BYO Gmail/Outlook), Prospection n'en parle pas alors qu'on intégrera probablement Gmail/Outlook pour le contact direct depuis l'app.

### 2.9bis Bundles cross-app — pricing arrêté

**Décision arrêtée 2026-05-21 (Robert + agent)**. Le Hub avait déjà câblé un pricing Prospection en parallèle (`veridian-hub/lib/pricing/plans.ts`) qui divergeait — alignement effectué.

#### Pricing standalone arrêté

| Composant | Prix HT/mois | Annual (-17%) |
|---|---|---|
| Notifuse Free | 0€ | — |
| Notifuse Pro | **29€** | 290€/an |
| Notifuse Business | **99€** | 990€/an |
| Prospection Freemium | 0€ | — |
| Prospection Pro | **29€** | 290€/an |
| Prospection Business | **89€** | 890€/an |

#### Bundles cross-app Veridian

| Bundle | Prix HT/mois | Composition | Économie vs à la carte |
|---|---|---|---|
| **Veridian Pro** | **49€** | Notifuse Pro (50k emails) + Prospection Pro (2k welcome leads) + 5 seats cross-app | -15% vs 58€ à la carte = **108€/an économisés** |
| **Veridian Business** | **149€** | Notifuse Business (500k emails) + Prospection Business (8k welcome leads) + 25 seats cross-app + SLA 99,9% | -20% vs 188€ à la carte = **468€/an économisés** |

Veridian Pro reste **hero CTA** (`recommended: true`) — palier psychologique sub-50€, économie nette de 108€/an lisible.

#### Logique des prix arrêtés

- **Pro standalone à 29€** : aligné Notifuse Pro pour cohérence stack, palier d'entrée SaaS B2B FR.
- **Business standalone à 89€** : palier sub-100€ accessible PME 10-25 commerciaux, aligné Notifuse Business 99€ tout en restant -10€ pour conserver l'incentive Business < Pack.
- **Bundle Pro -15% (49€)** : économie réelle mais palier sub-50€ préservé. Standalone reste attractif pour les "Prosp-only".
- **Bundle Business -20% (149€)** : sub-150€ palier psychologique, économie 468€/an = ROI évident. Pousse vers la stack intégrée.

**Stratégie business** : mass-market accessible PME française, course au volume. La marge unitaire est sacrifiée au profit du volume d'acquisition + de la **rentabilité refill leads Prospection** (où la vraie marge se fait, cf §2.3).

#### Ticket aligement Hub déposé

Cf `veridian-hub/todo/2026-05-21-align-prospection-pricing-from-prosp-session.md` — agent Hub doit :
1. Renommer `prospection-enterprise` → `prospection-business`
2. Mettre à jour quotas Prosp Pro et Business pour refléter le modèle welcome+refill
3. Mettre à jour bundles : Veridian Pro 39€→49€, Veridian Business 79€→149€
4. Mettre à jour Notifuse Pro 19€→29€ (alignement cross-app)
5. Mettre à jour Notifuse Business 49€→99€
6. Vérifier page `/pricing` live après deploy

### 2.10 Questions encore ouvertes côté pricing

- **Plan Enterprise à ajouter** (cohérence cross-app Notifuse) ?
  - Reco agent : oui, sur devis, déclenché à partir de 50k leads/mois ou besoin SSO/SAML/SLA. Pas en self-service, juste un CTA "Contactez-nous".
- **Trial 15j basé activité** comme Notifuse, ou rester sur "freemium permanent + welcome pack"** ?
  - Reco agent : modèle Prospection différent, le welcome pack 2000 leads pour Pro est déjà 400€ de cadeau. **Garde freemium permanent**, c'est cohérent avec mécanique "lead = data permanente acquise".
- **Quota OAuth accounts (Gmail/Outlook) pour intégration sortante depuis Prospection** ?
  - À cadrer quand on définit les intégrations v1 (§4.9 plus bas).
- Annual billing -17% confirmé ? (= 2 mois offerts)
- Bundles marketing limités dans le temps (Pack Lancement Commercial, Booster Q4) ?
- Politique remboursement (30 jours satisfait/remboursé sur abo récurrent ? Non-remboursable sur data achetée ?)

---

## 3. Roadmap features — différenciation qualité des leads

### 3.1 Quickwins déjà dans la DB ou triviaux à ajouter

Classés par ROI décroissant pour le lancement.

#### 3.1.1 — Score "fit ICP" personnalisé par tenant (~3-5 jours)

L'user décrit son client idéal (secteur, taille, géo, CA) → on calcule un score 0-100 par lead → tri par score décroissant.

**Pourquoi** : passe Prospection de "moteur de recherche plat" à "moteur de recommandation". Différenciation forte vs Apollo.

**Branche dans le schéma actuel** : nouvelle table `tenant_icp_profile (tenant_id, criteria_json, weights_json)` + scoring computed côté query.

#### 3.1.2 — Email pro deviné + validé MX (~1 semaine)

Format `prenom.nom@domain.fr` pour chaque dirigeant INPI, validé par MX check.

**Pourquoi** : feature #1 demandée par les commerciaux. Vaut 3x plus cher dès qu'inclus. On a déjà nom du gérant + domaine, deviner avec 80% de match est faisable sans scraping LinkedIn risqué.

#### 3.1.3 — Fraîcheur INPI (~2 jours)

Filtres temporels sur événements légaux :
- "Entreprise créée dans les 12 derniers mois" = besoin de tout (CRM, compta, site, équipement)
- "Changement de gérant 6 derniers mois" = nouveau décideur, opportunité

**Pourquoi** : signal "intent" temporel français, c'est ce que vend Cognism cher. On l'a en data INPI.

#### 3.1.4 — Détection "sans site / site mort" (~1 jour)

Job qui flag les leads selon état web :
- Aucun site = TPE qui a besoin de digitalisation
- Site WordPress sans HTTPS = besoin sécu/refonte
- Site qui retourne 5xx = entreprise en difficulté technique

**Pourquoi** : quickwin énorme pour le segment "agences web qui prospectent". Exploite le scoring "technique" qui existe déjà dans la table mais pas exposé.

### 3.2 Quickwins effort modéré (post-launch v1.1)

#### 3.2.1 — Détection "growth signal" (~1 semaine)

Croiser INPI avec recrutements (LinkedIn / Welcome to the Jungle) : entreprise qui poste 3+ offres en 30 jours = en croissance = budget = bon timing.

**Pourquoi** : signal qui vaut très cher (Sales Navigator + ZoomInfo Intent). Ouvre upsell Business.

### 3.3 Pas pour la v1

#### 3.3.1 — Tracking pixel visiteurs anonymes (mois+)

Détecter les visiteurs du site du client → identifier l'entreprise par IP reverse → push lead chaud "est venu sur ta page pricing hier".

**Pourquoi pas v1** : gros chantier (build du pixel, ingestion, reverse IP), peut bundler dans Business plus tard. Vendu 200€/mois par Albacross/Leadfeeder.

#### 3.3.2 — Intent data (mois++)

Scrape job boards / forums / réseaux sociaux pour détecter "cherche fournisseur X" ou "RFP en cours" et matcher avec entreprises DB.

**Pourquoi pas v1** : trop ambitieux. C'est le différenciant haut de gamme de ZoomInfo Pro.

### 3.4 Ordre de bataille proposé v1 (3-4 semaines avant pricing live)

1. **Score fit ICP par tenant** (#3.1.1) — l'avantage UX vs Apollo
2. **Email pro deviné + validé** (#3.1.2) — feature qui ferme la vente
3. **Fraîcheur INPI** (#3.1.3) — signal différenciant français
4. **Détection "sans site / site mort"** (#3.1.4) — quickwin segment agence web

Avec ces 4 features la thèse devient : *"la solution prospection française qui comprend l'ICP du client et donne les bonnes données INPI au bon moment"* — vendable.

### 3.5 Roadmap v1.1 (3 mois après lancement)

5. Growth signals (#3.2.1)

---

## 4. Zones de flou — questions ouvertes à traiter

> 🔥 À traiter une par une dans des sessions dédiées. L'agent pose les questions, Robert tranche, le doc est mis à jour.

### 4.1 Plans payants — montants en euros

Aucun prix € fixé pour Pro / Business / refill. Hypothèse à challenger : Pro 49-99€/mois, Business 199-499€/mois.

### 4.2 Granularité de la dégressivité refill

Quel barème exact ? Par exemple :
- 1-1000 leads refill = prix unitaire X
- 1001-5000 = prix unitaire Y
- 5001+ = prix unitaire Z
- Différencié par plan (Freemium plus cher, Business moins cher)

### 4.3 Trial gratuit en plus du freemium ?

Aujourd'hui le code parle d'un `TRIAL_DAYS=7` env. Est-ce qu'on garde un trial Pro/Business 7-14 jours en plus du freemium permanent ? Ou freemium suffit comme acquisition ?

### 4.4 Multi-membre — gratuit ou payant ?

Position actuelle (décision session précédente) : freemium peut inviter aussi (growth hack — chaque invité déclenche son propre freemium). Mais sur Pro/Business les seats sont limités à 5/25.

À confirmer : un freemium peut inviter combien de membres ? 0 (vraiment solo) ? 1 (binôme) ? Illimité (growth hack max) ?

### 4.5 Mécanique "vus vs exportés"

Trancher définitivement : on facture la consultation ou l'export ? Cf §2.2.

### 4.6 Modes pré-qualification — quels switches concrètement ?

Robert mentionne "des switch dans l'app pour avoir plusieurs modes pour le facteur de pré-qualification". Définir précisément ces modes :
- Mode "tout-venant" (volume max, qualité moyenne) ?
- Mode "haute qualité" (filtres ICP stricts, score min) ?
- Mode "découverte" (présentation marketing, démo) ?

### 4.7 Segments à couvrir explicitement par features dédiées

On a identifié 3 segments (TPE solo / PME équipe / Agences). Est-ce qu'on crée des features explicitement segmentées (genre "vue agence multi-client") ou on garde une UI commune ?

### 4.8 Stratégie d'acquisition

Aucune décision sur :
- Canal d'acquisition (SEO, paid, partenariats, content)
- Pricing display (page pricing en €, demo call, free trial CTA)
- Onboarding (form long ? walkthrough ? signup magic-link only ?)

### 4.9 Intégrations prioritaires v1

Quelles intégrations on livre dès v1 ?
- Gmail / Outlook (sync email contact) ?
- Notifuse (envoi séquence email) — déjà câblé infra
- LinkedIn (export contact) — risque ToS
- Zapier / Make ? — bridge multi-tools
- CRM tiers (HubSpot, Pipedrive) ?

### 4.10 Coûts de servage à modéliser

Avant de fixer les prix, modéliser le coût marginal d'un lead servi :
- Coût DB (PostgreSQL prod = ~5€/mois pour 100k+ leads, donc négligeable)
- Coût API enrichissement (INPI = gratuit, MX check = gratuit, mais scoring complexe = compute)
- Coût bande passante / R2 si export massif

Permet de fixer les paliers refill avec marge confortable.

---

## 5. État de la base technique pour supporter le pricing

### 5.1 Ce qui existe déjà côté code

- Plans déclarés dans `src/lib/trial.ts` + `src/lib/queries/lead-quota.ts` : `freemium`, `starter` (5000 quota), `pro`, `enterprise`, `lifetime_site_vitrine`, `lifetime_partner`, `internal`
- Quota leads géré via `buildQuotaFilter`
- Helper `isGiftedPlan()` pour les plans offerts (lifetime + internal)
- Multi-tenant + multi-membre opérationnels
- Contrat Hub §5 → endpoint `update-plan` pour piloter depuis le Hub (Stripe webhook)

### 5.2 Ce qui manque pour aligner avec le brouillon §2

- Le brouillon dit "Business 20000" mais le code parle de "starter 5000" et "pro/enterprise" sans quota explicite — à harmoniser quand pricing tranché.
- Pas encore de mécanique refill (pas de table `lead_pack_purchases` ou équivalent).
- Pas de scoring ICP côté DB.
- Pas de table de profil ICP par tenant.

### 5.3 Dépendance Hub (billing Stripe)

Le Hub porte le billing Stripe. Quand un user achète Pro, Hub appelle `update-plan` côté Prospection avec `plan_source=stripe`. Les plans `lifetime_*` et `internal` ont immunité plan_source (ne peuvent pas être downgradés par un webhook Stripe).

→ Toute nouvelle ligne de pricing doit être déclarée **côté Hub d'abord** (Stripe products + `PROSPECTION_PLANS` matrix), puis répercutée Prospection via la matrice.

---

## 6. Définition de done de ce document

- [ ] Prix € fixés pour Pro / Business / refill
- [ ] Mécanique "vus vs exportés" tranchée
- [ ] Quota multi-membre freemium tranché
- [ ] Modes pré-qualification définis (3-4 modes nommés + critères)
- [ ] Intégrations v1 listées
- [ ] Coûts modélisés (table avec coût marginal par lead servi)
- [ ] Roadmap v1 priorisée définitivement (les 4 features sont validées ou amendées)
- [ ] Roadmap v1.1 priorisée
- [ ] Document partagé / révisé / approuvé par Robert
