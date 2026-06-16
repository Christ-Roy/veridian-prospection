# [PROSPECTION] `/api/search/export` — matérialiser un segment vers Notifuse / CRM / Excel

> **Sévérité** : 🟡 P1
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Dépend de** : -01, -02. Croise les contrats Notifuse (export contacts) et CRM.

## But

Le bout actionnable du tunnel : quand l'IA a trouvé un bon segment (estimate OK +
sample validé), elle l'**exporte** pour le rendre exploitable ailleurs.
Robert (verbatim) : *"elle doit être capable de l'exporter pour le mettre
ailleurs genre notifuse ou crm ou excel par exemple"*.

## Conception — export PLUGGABLE (destinations interchangeables)

`POST /api/search/export`
```jsonc
// Request
{
  "tenant_id": "veridian",
  "filters": { /* schéma -02 */ },   // OU "query_id" d'une recherche précédente
  "limit": 5000,                     // borné, quota-gated (à terme par tenant)
  "destination": {
    "type": "notifuse" | "crm" | "file",
    // notifuse : { list_id, with_provider_class: true }  (cf custom_string_5, ticket MX)
    // crm      : { workspace, pipeline_stage }            (Twenty quand prêt)
    // file     : { format: "csv" | "xlsx" | "json" }
  },
  "dedupe": true,                    // ne pas réexporter ce qui est déjà dans outreach du tenant
  "tag": "ia-segment-coiffeurs-69-2026-06"   // provenance, traçabilité
}
// Response : { export_id, count_exported, destination_ref, skipped_duplicates }
```

### Destinations V1
1. **`file`** (CSV/XLSX/JSON) — le plus simple, à livrer EN PREMIER : valide le
   moteur de bout en bout sans dépendre de Notifuse/CRM. L'IA sort un fichier,
   Robert route à la main au début.
2. **`notifuse`** — push contacts vers une liste Notifuse pour emailing. Réutiliser
   le contrat d'export contacts existant + remplir `custom_string_5` (classe
   provider MX, cf ticket `2026-06-14-enrichir-provider-class-mx`). Canal cold
   le plus avancé.
3. **`crm`** — alimenter le pipeline Twenty (cold call). DÉPEND de Twenty prêt
   (pas encore le cas) → câbler quand dispo, derrière la même interface pluggable.

## Exigences
- **Pattern adapter** : une interface `ExportDestination` + une impl par type.
  Ajouter une destination ≠ toucher le moteur de recherche.
- **Traçabilité** : chaque export logué (export_id, tag, filters, count, destination,
  qui/quand). Indispensable pour mesurer le ROI des segments et éviter les doublons.
- **Dedupe** : ne pas réexporter des SIREN déjà en `outreach` pour ce tenant
  (évite de re-contacter / re-mailer). Jointure tenant-scoped.
- **Quota-gated (multi-tenant-ready)** : en V1 Veridian = illimité, mais le hook
  quota/lead-credits est posé dès maintenant (le système `lead_consumption` /
  `lead_credit_events` existe déjà) pour l'ouverture clients.
- **Anti-abus** : `limit` borné, export tracé, pas d'export de la base entière.

## Pièges
- Notifuse attend des valeurs canoniques `custom_string_5` (cf ticket MX) — sinon
  fallback lookup à l'envoi. Remplir à l'export = perf.
- Excel : 996K lignes ne tiennent pas / ne servent à rien en .xlsx → borner dur,
  c'est un export de SEGMENT (quelques milliers max), pas un dump.
- RGPD : l'export sort des données perso. Tracer la finalité (tag), respecter
  doNotContact / désinscriptions (registre de suppression — cf archi tunnel CRM A4).

## DoD
- [ ] Interface `ExportDestination` pluggable + impl `file` (CSV/XLSX/JSON).
- [ ] Impl `notifuse` (avec provider_class) testée sur vraie data.
- [ ] Dedupe vs outreach tenant + traçabilité (export_id, tag).
- [ ] Hook quota posé (no-op V1, prêt multi-tenant).
- [ ] `crm` derrière l'interface (impl quand Twenty prêt — sous-ticket).
