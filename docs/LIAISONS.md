# Liaisons : « Envoyer au CRM » et « Envoyer vers Mail » (VER-246, INT-1 et INT-3)

Plan : `nomad-veridian/plan/INTEGRATIONS-NATIVES.md` (§2.1 à 2.3, F1, F2). Un humain clique ; jamais par MCP ni par clé API.

- **Drapeau** `ATLAS_LIAISONS` (HCL) : `crm=*;notifuse=<tenant Hub>,<tenant Hub>`. Vide = rien ne s'affiche, les routes répondent 404.
- **Poignées** : `delegations: [{hub_tenant_id, grant, expire_le}]` du rebond (Hub, VER-245 b.2), une par organisation. Chiffrées
  (AES-256-GCM, clé dérivée d'`AUTH_SECRET`), d'abord sur le lien de connexion, puis par (session, organisation) dans
  `session_delegations`. Illisibles : on entre quand même, sans liaison. Retirées à la déconnexion, à la suppression du compte, à la
  révocation des sessions, et dès que le Hub en refuse une.
- **Jeton** : `src/lib/liaisons/hub.ts`, `POST <Hub>/api/delegation/jeton`, HMAC-SHA256 de `ts.nonce.corps`, 60 par minute et par
  organisation. Refusé si `tenant_id` n'est pas l'espace de l'utilisateur, ou si l'adresse n'est pas en https sous `.veridian.site`
  (`url` de la réponse, sinon `LIAISON_URL_*`). Un jeton par appel.
- **CRM** : `tools/call app_envoyer_au_crm` sur son MCP, lot de 20 (plugin liaisons 0.4), un résultat par SIREN. Non traité ou absent de
  la réponse : la page entière se reprend.
- **Mail** : `POST <adresse>/<action>` (fiche 87 de Notifuse), `contacts.importer`, portée `notifuse:contacts.ecrire` ; attend de Mail
  `listes.lister` et `listes.creer`. Ni `allow_triggers` ni `existing` : Mail les fixe, rien ne peut partir.
- **Un geste** = un uuid choisi par l'écran, gardé s'il réessaie (`atlas_envois`, une ligne par étape, sans coordonnée). Rejoué : premier
  résultat. Deux clics simultanés : un seul travaille. Une étape morte se reprend après 120 s.
- **Plafonds** : ceux de l'extraction (plan payant, 5 000 lignes par jour et par espace, tracées dans `atlas_exports`, canal
  `liaison`). Segment vers CRM : pages de 20, 100 sociétés par geste. Segment vers Mail : pages de 1 000, simulation obligatoire puis
  confirmation de la même liste figée.
- **Session sans poignée** : un seul rebond silencieux par 5 min, puis l'écran rouvre la fiche ou le segment ; l'utilisateur confirme.
- **Épreuves** : `e2e/integration/liaisons.test.ts` (Hub, CRM et Mail simulés, vrais serveurs HTTP, PostgreSQL),
  `__tests__/lib/liaisons/`.
