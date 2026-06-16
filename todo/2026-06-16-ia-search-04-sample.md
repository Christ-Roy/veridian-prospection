# [PROSPECTION] `/api/search/sample` — échantillon représentatif (jugement qualitatif IA)

> **Sévérité** : 🟢 P2
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Dépend de** : -02 (schéma). Complète -03 (estimate = quantitatif, sample = qualitatif).

## But

Avant de matérialiser/exporter un segment (qui coûte/consomme), l'IA doit pouvoir
**regarder quelques exemples concrets** pour juger la pertinence : "ces 10 boîtes
ressemblent-elles à ce que je cherche ?". C'est le pendant qualitatif de l'estimate.

## Contrat

`POST /api/search/sample`
```jsonc
// Request : { tenant_id, filters, size: 10 }   // size borné (max 25)
// Response : { sample: [ { siren, denomination, ca, commune, secteur, web_domain,
//                          best_phone_e164, best_email_normalized, prospect_score, … } ] }
```

## Exigences
- **Échantillon représentatif**, pas juste les 10 premiers (qui seraient tous le
  même top-score). Options à tester au banc : `ORDER BY random()` (lent sur 996K),
  `TABLESAMPLE`, ou échantillon stratifié par score/secteur. Mesurer.
- **size borné** (max 25) — c'est un aperçu, pas un export déguisé (anti-scraping).
- Tracé : un sample n'est pas un export, mais on log la requête (query_id).
- Mêmes champs projetables que -01.

## Pièges
- `ORDER BY random()` fait un seq scan complet sur 996K → catastrophique. Préférer
  `TABLESAMPLE SYSTEM` + filtre, ou tirer des SIREN au hasard dans le résultat
  filtré via une CTE bornée. À benchmarker.
- Ne pas confondre "représentatif" et "meilleurs" — l'IA veut voir le segment
  RÉEL, y compris les boîtes moyennes, pour juger honnêtement.

## DoD
- [ ] Sample représentatif, rapide (< 500ms), borné, tracé.
- [ ] Testé sur vraie data : l'échantillon reflète bien le segment filtré.
