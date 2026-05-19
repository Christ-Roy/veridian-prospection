# Prompt à copier-coller dans la prochaine session Prospection

---

```
Lis et exécute le ticket Hub :

  /home/brunon5/Bureau/veridian-platform/veridian-prospection/todo/2026-05-19-hub-contract-conformity.md

Le contrat de référence est :

  /home/brunon5/Bureau/veridian-platform/CONTRAT-HUB.md

Procédure attendue :

1. Lis le ticket en entier + survol du CONTRAT-HUB.md (sections §5, §6, §7, §10 surtout)
2. Confirme-moi en 3-4 lignes ta compréhension de l'écart et l'ordre des phases
3. Attaque par la Phase 1 (HMAC standardisé) — c'est le pré-requis de tout le reste
4. Après chaque phase :
   - npm test (vitest unit + integration verts)
   - push staging → suivre gh run watch
   - smoke Chrome staging via le pattern [[project_chrome_mcp_login_pattern]]
   - si vert : promotion main → smoke Chrome prod
   - update du ticket (marquer la phase done + état des cases ✅/❌ de la matrice §10)
5. Coordonne avec moi quand tu poses un fichier ticket pour l'agent Hub
   (veridian-hub/todo/2026-05-19-prospection-conformity.md)

Règles du flow (rappel) :
- Ship fast direct, pas de PR, pas de branch protection main
- Trunk-based : staging → main via ff-merge ou no-ff
- Tu arbitres seul le niveau de vérif selon le risque (cf [[feedback-ship-fast-no-pr]])
- Pour les modifs lifecycle (suspend/restore/purge) : Chrome MCP obligatoire
- Pour les modifs HMAC : test curl + Chrome smoke staging suffisent

Mémoire utile à charger d'entrée :
- memory/MEMORY.md (index)
- memory/feedback-ship-fast-no-pr.md
- memory/feedback-test-strategy.md
- memory/project_chrome_mcp_login_pattern.md (pour login Chrome)
- memory/feedback_husky_strict_pending.md (Husky NUCLEAR — chaque nouvel endpoint
  doit avoir son test colocalisé immédiatement, sinon le push refuse)

Estimation : 3-4 jours focus, 8 phases. Démarre par P1 (HMAC) — quand validée,
tu enchaînes P2 (endpoints lifecycle de base) sans me redemander la permission.

Go.
```

---

## Notes pour Robert (pas à coller)

- Le ticket est dans `todo/` du repo Prospection, donc visible aussi côté Hub si l'agent Hub passe par là.
- Il faut faire un ticket symétrique côté `veridian-hub/todo/` pour que l'agent Hub migre son client HMAC en parallèle. Je peux le préparer si tu veux — dis-moi.
- Estimation 3-4 jours = un sprint. Si tu veux découper en plus petit, je peux fractionner en 2 sessions (P1+P2 ensemble = 12h pour livrer le bloc auth+lifecycle minimal, puis P3-P7 dans une 2e session).
