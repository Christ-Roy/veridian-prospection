# Liaisons : « Envoyer au CRM » et « Envoyer vers Mail » (VER-246, INT-1 et INT-3)

Plan : `nomad-veridian/plan/INTEGRATIONS-NATIVES.md` (§2.1 à 2.3, F1, F2). Un humain clique ; jamais par MCP ni par clé API.

- **Drapeau** `ATLAS_LIAISONS` (HCL) : `crm=*;notifuse=<tenant Hub>,<tenant Hub>`. Vide = rien ne s'affiche, les routes répondent 404.
  En prod depuis le 26/11 : `crm=*;notifuse=*` (le CRM pose Liaisons à chaque nouvel espace, c8e67ad ; les 5 espaces clients
  exclus par `VERIDIAN_BASE_APPS_EXCLUDE` reçoivent « La liaison n'est pas encore disponible dans votre CRM. », 409).
- **Poignées** : `delegations: [{hub_tenant_id, grant, expire_le}]` du rebond (Hub, VER-245 b.2), une par organisation. Chiffrées
  (AES-256-GCM, clé dérivée d'`AUTH_SECRET`), d'abord sur le lien de connexion, puis par (session, organisation) dans
  `session_delegations`. Illisibles : on entre quand même, sans liaison. Retirées à la déconnexion, à la suppression du compte, à la
  révocation des sessions, et dès que le Hub en refuse une.
- **Jeton** : `src/lib/liaisons/hub.ts`, `POST <Hub>/api/delegation/jeton`, HMAC-SHA256 de `ts.nonce.corps`, 60 par minute et par
  organisation. Refusé si `tenant_id` n'est pas l'espace de l'utilisateur, ou si l'adresse n'est pas en https sous `.veridian.site`
  (`url` de la réponse, sinon `LIAISON_URL_*`). Un jeton par appel.
- **État** : `POST <Hub>/api/delegation/paires` à l'ouverture de l'écran. Éteinte : une phrase, pas de bouton. Indisponible : rien. Hub muet : le
  bouton reste, le clic dira.
- **CRM** : `tools/call app_envoyer_au_crm` sur son MCP, lot de 20 (plugin liaisons 0.4), un résultat par SIREN. Non traité ou absent de
  la réponse : la page entière se reprend.
- **Mail** : `POST <adresse>/<action>` (fiche 87 de Notifuse), `contacts.importer`, portée `notifuse:contacts.ecrire` ,
  `listes.lister` (`starts_sequence` : liste grisée) et `listes.creer`. Ni `allow_triggers` ni `existing` : Mail les fixe, rien ne peut partir.
- **Un geste** = un uuid choisi par l'écran, gardé s'il réessaie (`atlas_envois`, une ligne par étape, sans coordonnée). Rejoué : premier
  résultat. Deux clics simultanés : un seul travaille. Une étape morte se reprend après 420 s, toujours plus que l'appel le plus long (120 s, trois essais pendant l'installation de Liaisons).
- **Plafonds** : ceux de l'extraction (plan payant, 5 000 lignes par jour et par espace, tracées dans `atlas_exports`, canal
  `liaison`). Segment vers CRM : pages de 20, 100 sociétés par geste. Segment vers Mail : pages de 1 000, simulation obligatoire puis
  confirmation de la même liste figée.
- **Session sans poignée** : un seul rebond silencieux par 5 min, puis l'écran rouvre la fiche ou le segment ; l'utilisateur confirme.
- **Épreuves** : `e2e/integration/liaisons.test.ts` (Hub, CRM et Mail simulés, vrais serveurs HTTP, PostgreSQL),
  `__tests__/lib/liaisons/`.

## Sens inverse : les autres apps vers Atlas (`/api/veridian/actions/{action}`)

Même enveloppe et mêmes codes que Mail (fiche 87 de Notifuse). `src/lib/actions/jeton-action.ts`, `src/atlas/actions.ts`.

- **Jeton** du Hub : ES256, `aud` = `https://prospection.app.veridian.site/api/veridian/actions`, `act.sub = app:crm` sans chaîne, `tenant_id`,
  `jti` à usage unique (même refusé), 120 s au plus, portée `prospection:entreprise.lire`. Un jeton à `act` est refusé sur `/api/mcp`.
- **`entreprises.chercher`** `{q, code_postal?, limite (1 à 20)}` : nom, SIREN, SIRET ou domaine, dans toutes les entreprises de France.
  Aucune coordonnée, à aucun plan.
- **`entreprises.enrichir`** `{siren}` + `Idempotency-Key` (8 à 128) : identité, activité, lieu, dirigeant, web, finances, signaux, `url` de la fiche
  (`/?siren=`). `coordonnees` : `jointes` (plan payant, `contact {email, telephone}`, comptées dans les 5 000 par jour et tracées, une fois par
  clé), `plan` (`masque` dit ce qui existe), `aucune`, `non_prospectable` (identité publique seule). Rien n'est gardé : un rejeu relit sans recompter.
- **Refus** : 401 `jeton_refuse`, `jeton_deja_vu` ; 403 `portee_insuffisante`, `app_non_autorisee`, `utilisateur_inconnu`, `non_membre`,
  `espace_suspendu` ; 409 `espace_non_relie`, `en_cours` ; 400 `cle_requise`, `demande_invalide` ; 422 `cle_reutilisee` ; 404 `action_inconnue`,
  `entreprise_inconnue` ; 429 `quota`, `trop_de_demandes` (60 par minute) ; 503 `echec`.
- **Épreuve** : `e2e/integration/actions.test.ts`.
