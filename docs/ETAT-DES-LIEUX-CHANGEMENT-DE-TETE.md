# État des lieux : changement de tête de Prospection

Mesuré le 06/11/2026 sur `origin/main` et sur la production (image `c70ba3c` avant ce lot).
Document de décision, sans code. Rien de ce chantier n'est commencé. Le sens de « changer de tête »
reste à trancher par Robert : refonte de l'interface, ou Twenty devenant l'interface.

## En bref

- L'interface est découplée de la base : 2 écrans seulement lisent la base en direct.
- Le verrou est l'API : aucune route leads, pipeline ou mail n'accepte autre chose qu'un cookie de session.
- 71 routes sur 118 portent encore du Prisma ou du SQL dans leur handler.
- Rien n'alimente Twenty aujourd'hui depuis Prospection : le code d'export n'existe pas.
- La stack consomme très peu de CPU. Le dimensionnement se joue sur le disque et le cache de la base.

## Ce qui est interface, ce qui est domaine

| Couche | Volume | Où |
|---|---|---|
| Pages | 22 `page.tsx`, très minces | `src/app` |
| Écrans | dashboard 13 175 lignes, mail 2 588, billing 1 821, softphone 838 | `src/components` |
| Requêtes métier | 3 614 lignes | `src/lib/queries` |
| Mail | 2 210 lignes | `src/lib/mail` |
| Contrat Hub | 1 047 lignes | `src/lib/hub` |
| IA et refill | 1 595 lignes | `src/lib/ai`, `src/lib/refill-icp` |

| Domaine | Routes | Lignes | Données |
|---|---|---|---|
| Leads, segments | 16 | ~1 490 | `entreprises` (partagée), `outreach`, `lead_segments` |
| Pipeline, rendez-vous, relances | 7 | ~450 | `pipeline_transitions`, `followups`, `appointments`, `workspace_pipeline_stages` |
| Enrichissement, scoring | 1 (`api/refill`) | 197 | logique en lib, tables `staging_*` en base |
| Mail | 14 + 3 crons | ~1 830 | `lead_emails`, `mail_outbox`, `tenant_mail_config`, `tenant_mail_templates` |
| Facturation, quotas | 4 | ~515 | `lead_credit_events`, `lead_orders`, `lead_consumption`, `veridian_plan_history` |
| Contrat Hub | 23 | ~3 580 | `tenants`, `workspaces`, `users` |
| Admin | 14 | 1 504 | `audit_log`, `invitations` |
| Téléphonie Telnyx | 6 | 960 | `call_log` |
| Recherche machine | 3 | 287 | `entreprises` |

Multi-tenant : sur 36 modèles, seuls `entreprises`, `users` et `verification_tokens` n'ont ni
`tenant_id` ni `workspace_id`.

## Degré de couplage

**Faible côté écrans.** 107 composants sur 135 sont clients et passent par `fetch("/api/...")`
(51 fichiers). Aucun composant de `src/components` n'importe Prisma. Deux exceptions à traiter :
`src/app/inbox/page.tsx` et `src/app/leads/buy/page.tsx`.

**Fort côté handlers.** 71 routes sur 118 parlent directement à la base, 22 seulement passent par
`lib/queries`. Les plus lourdes : `api/admin/members`, `api/phone/telnyx-webhook`, `api/phone/call-log`,
`api/admin/workspaces/[id]`, `api/tenants/provision`.

## Ce qu'il faudrait exposer si la tête changeait

1. **Une authentification machine ou utilisateur hors cookie** sur leads, pipeline et mail. La clé
   `Workspace.apiKeyHash` existe déjà (1 clé = 1 workspace) mais ne sert qu'au magic link. C'est le
   premier verrou, et le plus court à lever.
2. **Un contrat versionné et publié** : aucun OpenAPI aujourd'hui. Zod est présent dans 22 routes, base
   utilisable pour générer le schéma.
3. **La recherche multi-tenant** : `/api/search/*` est déjà une API machine propre, mais son tenant est
   figé sur `veridian`.
4. **`/inbox` et `/leads/buy` derrière l'API.**
5. **La logique sortie des handlers** vers `lib`, au fil de l'eau, en commençant par ce que la nouvelle
   tête consomme.

Déjà acquis : pagination sur `/api/leads` et `/api/prospects` (pas de curseur), plafond anti-scraping de
20 pages/min/utilisateur à revoir pour un client machine.

## Ce qui existe côté Twenty

Dépôt `veridian-crm-repo`, base upstream `e70776f705` synchronisée le 15/06/2026. Un chantier
`twenty-remontee` est en cours en parallèle : ce paragraphe décrit l'état lu le 06/11.

- **`VeridianProspectionFilterButtons`** (`packages/twenty-front/src/modules/veridian-prospection-filters/`,
  1 883 lignes, 10 fichiers, tests). Interface pure : Taille, Géo, Qualité, Avec/Sans site, Mobile sur
  l'objet `company`. Écrit dans le vrai système de filtres de Twenty, sans store parallèle ni appel réseau.
- **Autres modules front** : `veridian-record-open`, `veridian-prospect-card`, `veridian-tunnel-timeline`.
- **Serveur** : `veridian-sso`, `veridian-audit-log`, `veridian-custom-domain`.
- **Patchs upstream** : registre `VERIDIAN-PATCHES.md`, chacun verrouillé par un test de survie, sauf les
  patchs cosmétiques.
- **Pont d'événements** : il n'est **pas** dans `veridian-crm-repo`. Deux copies identiques vivent dans
  `veridian-tunnel-de-vente/bridge` et `acquisition-emailing/bridge`. Sens Notifuse → SQLite → API REST
  Twenty, plus un sync horaire de l'export Analytics. `DRY_RUN=1` par défaut, passage en écriture gelé
  d'après ses documents (valeur réelle sur dev-pub non vérifiée).

**Écarts entre ce qu'on croit et le terrain :**

- `scripts/leads-to-twenty.ts`, cité dans une ancienne note, n'existe pas, et `src/lib/twenty.ts`, cité
  dans le README, non plus. Prospection n'a aucun code d'export vers Twenty. Le seul lien restant : les
  colonnes `Tenant.twenty*` et une purge.
- `tenants.twenty_user_password` et `twenty_api_key` sont des colonnes secrètes à vérifier et à vider si
  elles ne servent plus (contenu non lu).
- Aucun job Nomad nommé `twenty` ou `crm` n'apparaît dans le cluster, et `crm.app.veridian.site` répond 404.

**Si Twenty devenait l'interface** : les filtres existent, mais il manque la donnée (1,8 M d'entreprises
face aux objets de Twenty), le pont, et tout le mail, le softphone, le quota et la facturation, qui n'ont
aucun équivalent côté Twenty aujourd'hui. Le bon arbitrage porte sur ce périmètre, pas sur les filtres.

## Identité : les portes encore ouvertes hors Hub

Cible de Robert : le Hub seule source de vérité. État après ce lot :

| Porte | Usage mesuré | État |
|---|---|---|
| HMAC `email:ts` et Bearer Hub | 0 appel légitime dans les logs conservés (`provision` ne journalisait pas ce mode), le Hub signe tout | **fermée** |
| Provider Google local | `client_id=undefined` en prod, donc inopérant, 0 compte | **fermée** |
| Mot de passe local `/login` | 20 lignes `accounts`, 18 comptes, usage réel journalisé depuis le 06/11 (`[auth/password-login]`) | ouverte, attend Robert |
| Invitation locale `/invite/[token]` (crée user + mot de passe) | 21 au total, 12 acceptées, dernière le 16/08, 0 ouverte | ouverte, attend Robert |
| `/api/admin/invites` (`magic_links`) | 0 ligne, aucun écran | **fermée** |
| `attach-owner`, `attach-member`, `provision`, `sync-member` | chemins Hub, en HMAC | conformes |

Aucune route ne permet de changer son email ou son nom hors Hub. Le rebond Hub est prouvé de bout en bout en
production le 06/11 pour une adresse prouvée au Hub ; une adresse non prouvée revient sur le tableau de bord.

## Ce que la stack consomme réellement

Mesures cgroup du 06/11 sur `ovh-prod` (6 cœurs, 11 Gio, 43 conteneurs, disque 75 %), sur 27 jours de vie
de l'allocation.

| Tâche | CPU moyen | Mémoire vive | Pic mémoire | Réservé Nomad |
|---|---|---|---|---|
| `prospection` (Next.js) | 0,3 % d'un cœur | 132 Mio | 239 Mio | 256 Mio, plafond 7 Gio |
| `prospection-saas-db` (Postgres 15) | 2,3 % d'un cœur | 998 Mio dont 973 de cache | 2 291 Mio | 1 184 Mio, plafond 7 Gio |
| `pgbackrest` | moins de 0,1 % | 1 Mio | 512 Mio | 64 Mio, plafond 512 Mio |

Mesure Mimir de la base sur 7 jours, échantillonnée à 30 min : moyenne 2,2 %, maximum 2,5 % d'un cœur.
Un échantillonnage aussi large lisse les pointes : ne pas le lire comme un plafond.

**Base** : 3,2 Go, dont `entreprises` 1,46 Go, `inpi_history` 657 Mo, `results` 612 Mo. Environ 445 Mo de
tables `staging_*` et `_backup_cm_0704` sont de possibles candidates au ménage (non touchées).
`shared_buffers` à 128 Mo pour 3,2 Go de données, taux de cache 96 %.

**Non mesuré ici** : la charge de pointe avec beaucoup d'utilisateurs (trafic actuel très faible, donc
extrapolation fragile), le staging endormi, les workers ODH qui ne servent pas l'app en direct, et Twenty,
qui ne tourne pas sur ce cluster sous ce nom. Son empreinte reste à mesurer avant d'acheter pour lui.

**Pour le choix des serveurs** : Prospection seule tient largement sur 1 cœur et 2 à 4 Gio. Ce n'est pas
elle qui justifie un achat. La question utile est ce que Twenty et ODH ajouteraient, et le disque
d'`ovh-prod` à 75 % est la contrainte la plus proche. Le scheduler compte les réservations, pas l'usage :
le plafond de 7 Gio et la réservation de 1 184 Mio de la base pèsent plus que sa consommation réelle.

## Décisions à prendre par Robert

1. Le sens du changement de tête : refonte ou Twenty comme interface.
2. La fermeture du mot de passe local et de l'invitation locale, une fois les comptes rattachés.
3. Le périmètre mail, softphone et facturation si Twenty devient l'interface.
