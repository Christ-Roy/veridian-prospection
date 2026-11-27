# Segmentation des leads par provider destinataire + export batch outbound

> **Sévérité** : 🟢 P2 (monte P1 quand Notifuse est prêt)
> **Owner** : agent prospection
> **Créé** : 2026-06-10 (par l'agent tunnel-de-vente)
> **Réf archi** : `../veridian-tunnel-de-vente/CLAUDE.md` §1.1

## Contexte

Tunnel outbound acté par Robert (2026-06-10). La première brique côté
Prospection : savoir produire des **batchs de prospects qualifiés,
segmentés par provider email destinataire** (Gmail / Microsoft / OVH /
Orange / autre via résolution MX), pour alimenter Notifuse avec un débit
adapté à chaque infra receveuse.

Il existe déjà un pipeline local de re-qualification qui fait ce travail
en one-shot (live-check site + extraction email + MX) :
`~/Bureau/prospection-requalif-2026-06-10/` (script + 148 leads prêts).
À industrialiser dans l'app.

## À faire

- [ ] Audit du modèle actuel (`LeadSegment`, `LeadEmail`, `LeadOrder`…) :
      où stocker `email_provider` (classe MX) + `site_issues`
      (https/responsive/copyright) + `last_verified_at` ?
- [ ] Job de qualification : résolution MX → classe provider ; live-check
      du site (réutiliser la logique du script local).
- [ ] Export batch (JSON/CSV) filtrable : segment, provider, score,
      fraîcheur de vérification — format consommable par Notifuse et par
      le générateur de pages audit (veridian-site).
- [ ] Pousser chaque batch dans Twenty (Person + champ statut outbound) —
      voir la structure posée par l'agent tunnel (vue "Mailing").
