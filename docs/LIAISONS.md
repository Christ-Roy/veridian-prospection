# Liaisons : « Envoyer au CRM » et « Envoyer vers Mail » (VER-246, INT-1 et INT-3)

Plan : `nomad-veridian/plan/INTEGRATIONS-NATIVES.md` (§2.1 à 2.3, F1, F2). Un humain clique ; jamais par MCP ni par clé API.

- **Drapeau** `ATLAS_LIAISONS` (HCL) : `crm=*;notifuse=<tenant Hub>,<tenant Hub>`. Vide = rien ne s'affiche, les routes répondent 404.
- **Poignée** : `delegation_grant`, `delegation_tenant_id`, `delegation_expires_at` du rebond. Chiffrée (AES-256-GCM, clé dérivée
  d'`AUTH_SECRET`), d'abord sur le lien de connexion, puis liée au `sid` de la session (`session_delegations`). Illisible : on entre
  quand même, sans liaison. Retirée à la déconnexion, à la suppression du compte et à la révocation des sessions.
- **Jeton** : `src/lib/liaisons/hub.ts`, `POST <Hub>/api/delegation/jeton`, HMAC-SHA256 de `ts.nonce.corps`. Refusé si `tenant_id`
  n'est pas l'espace de l'utilisateur, ou si `url` n'est pas en https sous `.veridian.site`. Un jeton par appel.
- **Appel** : `src/lib/liaisons/action.ts`, `tools/call` sur le MCP de la cible. CRM : `app_envoyer_au_crm`. Mail : `lists_list`,
  `lists_create`, `contacts_import`, jamais `allow_triggers` : rien ne peut partir.
- **Un geste** = un uuid choisi par l'écran, gardé s'il réessaie (`atlas_envois`, une ligne par étape, sans coordonnée). Rejoué : premier
  résultat. Deux clics simultanés : un seul travaille. Une étape morte se reprend après 120 s.
- **Plafonds** : ceux de l'extraction (plan payant, 5 000 lignes par jour et par espace, tracées dans `atlas_exports`, canal
  `liaison`). Segment vers CRM : pages de 20, 100 sociétés par geste. Segment vers Mail : pages de 1 000, simulation obligatoire puis
  confirmation de la même liste figée.
- **Session sans poignée** : un seul rebond silencieux par 5 min, puis l'écran rouvre la fiche ou le segment ; l'utilisateur confirme.
- **Épreuves** : `e2e/integration/liaisons.test.ts` (Hub, CRM et Mail simulés, vrais serveurs HTTP, PostgreSQL),
  `__tests__/lib/liaisons/`.
