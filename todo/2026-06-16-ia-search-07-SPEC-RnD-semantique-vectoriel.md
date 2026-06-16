# [PROSPECTION] 🔬 SPEC R&D — couche sémantique / vectorielle (DOC ONLY, à définir ensemble)

> **Sévérité** : 🔵 P3 (R&D — trace écrite, PAS à coder en V1)
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Statut** : SPÉCULATIF. À définir EN DÉTAIL avec Robert APRÈS audit + tests du
> moteur structuré V1. Robert (verbatim) : *"je veux garder une trace écrite pour
> la partie plus sophistiquée qui devra être définie en détail ensemble après
> audit et test"*.

## Pourquoi ce ticket existe (et pourquoi il n'est PAS en V1)

Le moteur V1 est **structuré** (JSON filtres → SQL). Il couvre ~90% du cold
call/emailing parce que les critères de ciblage sont des FAITS (CA, NAF, géo,
signaux web, âge dirigeant) → du SQL `WHERE`, pas du sens.

Le **sémantique/vectoriel** ne se justifie QUE pour les ~10% de besoins FLOUS :
- "Trouve-moi des boîtes qui **ressemblent à mon meilleur client X**" (similarité).
- "Des artisans qui **galèrent avec leur présence en ligne**" (concept flou →
  combinaison de signaux non triviale).
- Requête en **langage naturel libre** → traduction en filtres (NL→filters).

⚠️ Décision Robert : NE PAS coder ça en V1. D'abord prouver la valeur du moteur
structuré, mesurer où il bute réellement, PUIS décider si/où le vectoriel apporte.

## Pistes à creuser (quand on y sera)

### Piste A — NL → filtres structurés (le plus rentable, pas besoin de vectoriel)
L'IA traduit une demande en langage naturel ("coiffeurs sans site dans le Rhône,
CA moyen") en JSON de filtres du moteur V1. C'est du **prompt engineering sur le
schéma -02**, PAS du vectoriel. Probablement la vraie réponse à 80% du "sophistiqué".
→ À tester en premier, quasi gratuit une fois -02 + `/api/search/fields` livrés.

### Piste B — Embeddings + pgvector (le "ressemble à…")
- **pgvector** dans le même Postgres (pas d'infra séparée — cohérent avec la règle
  d'or zéro-contournement).
- Embeddings sur quoi ? : descriptif d'activité (NAF libellé + secteur + signaux
  agrégés), pour une similarité "profil d'entreprise". À définir : modèle d'embed,
  coût de calcul sur 996K, fraîcheur (recalcul à l'enrichissement ETL).
- Use case : "voici 5 de mes clients signés → trouve les 200 plus similaires".
- Coût/bénéfice à PROUVER : 996K embeddings = stockage + compute non négligeable.

### Piste C — Recherche hybride (structuré + vectoriel)
Filtrer d'abord en SQL (réduit 996K → quelques milliers), PUIS ranker par
similarité vectorielle dans le sous-ensemble. Le plus efficace si B se justifie :
le vectoriel ne tourne jamais sur 996K, seulement sur le pré-filtré.

## Questions ouvertes à trancher ensemble (après audit V1)
- Le besoin "ressemble à mon meilleur client" est-il réel pour TON cold, ou
  théorique ? (mesurer sur l'usage V1).
- NL→filtres (piste A) suffit-il à couvrir le "sophistiqué" sans vectoriel ?
- Si vectoriel : quel signal embedder, quel coût, quelle fraîcheur ?
- Multi-tenant : les embeddings sont sur le référentiel partagé (pas par tenant) —
  mais le "ressemble à MES clients" implique un seed par tenant. Archi à penser.

## DoD (de CE ticket = doc)
- [ ] Ce fichier sert de point de départ à la session de cadrage post-audit V1.
- [ ] NE RIEN coder tant que Robert n'a pas validé l'archi en détail.
