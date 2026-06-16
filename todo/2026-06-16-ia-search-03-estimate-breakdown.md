# [PROSPECTION] `/api/search/estimate` — count + breakdown pour la boucle d'itération IA

> **Sévérité** : 🟡 P1
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Dépend de** : -02 (schéma filtres). S'appuie sur `/api/leads/estimate-count` existant.

## But

Le mécanisme qui permet à l'IA d'**itérer** : "ce segment fait combien ? trop
large → j'affine → 340, parfait". Sans matérialiser (anti-scraping, perf).
C'est la brique qui transforme un filtrage en **recherche intelligente par
raffinement successif**.

## Contrat

`POST /api/search/estimate`
```jsonc
// Request : { tenant_id, filters }  (même schéma que -01/-02)
// Response
{
  "estimated_count": 12400,
  "breakdown": {                    // pour guider l'affinage de l'IA
    "by_secteur":     [ { "key": "coiffure", "count": 4200 }, … ],
    "by_departement": [ { "key": "69", "count": 1800 }, … ],
    "by_ca_range":    [ { "key": "80k-300k", "count": 6100 }, … ],
    "with_phone": 9800, "with_email": 5400, "with_website": 7200
  },
  "actionable": { "with_phone_and_email": 4100 }  // ce qui est vraiment exploitable
}
```

## Pourquoi le breakdown (≠ simple count)
Un COUNT seul ne dit pas à l'IA COMMENT affiner. Le breakdown lui donne les
leviers : "12400 dont 4200 en coiffure, 1800 dans le 69, 4100 avec tel+email" →
elle sait quelle dimension resserrer pour atteindre un volume actionnable.

## Exigences
- Réutiliser `buildSearchWhereSql` (-02) — un seul moteur de WHERE.
- **Perf** : les `GROUP BY` sur 996K sont coûteux → mesurer au banc, limiter le
  breakdown aux dimensions clés, cacher si besoin (TTL court). Envisager
  `reltuples` pour l'estimate global quand le segment est énorme.
- Rate-limit (déjà 30/min sur estimate-count — reprendre).
- Retourne des COUNTs, JAMAIS de leads (anti-scraping, comme estimate-count).
- `actionable` = le chiffre qui compte vraiment pour le cold (tel ET/OU email selon canal).

## DoD
- [ ] Endpoint testé sur vraie data, counts recoupés manuellement.
- [ ] Breakdown utile + assez rapide (sinon dimensions réduites / index).
- [ ] L'IA peut enchaîner estimate → affine → estimate en < 1s par tour.
