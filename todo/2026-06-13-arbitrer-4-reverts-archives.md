# Arbitrer 4 reverts [risk:high] archivés (worktrees nettoyés)

> **Sévérité** : 🟡 P1
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-13 (par lead, ménage repos)

## Contexte
4 worktrees d'agents abandonnés (26 mai) traînaient à la racine `veridian-platform/`.
Ils ont été démontés pour ranger. Chacun portait **1 commit `[risk:high]` jamais
poussé sur staging**. Pour ne RIEN perdre, les 4 commits ont été **archivés sur
le remote** sous `archive/2026-05-26-*` avant démontage.

## Les 4 reverts à arbitrer (branches sur le remote)
| Branche archive | Commit | Sujet |
|---|---|---|
| `archive/2026-05-26-agent-revert-mail-outbox` | f5bff47 | revert : supprime queue mail_outbox + cron flush, retour synchrone direct |
| `archive/2026-05-26-agent-revert-openrouter-pkce` | fa9549d | revert : drop Palier 2 OAuth PKCE user link |
| `archive/2026-05-26-agent-revert-w7b-refill-icp` | d25ff8c | revert : drop W7b page native refill ICP (sur-ingénierie audit) |
| `archive/2026-05-26-agent-simplify-hub-gateway` | c254607 | refactor : simplifie Hub Gateway — DROP workspace.mail_provider abstraction |

## À faire
Pour chacun : décider s'il est **encore pertinent** (staging a avancé de 18 commits
depuis le 26 mai — peut-être déjà appliqué autrement, ou caduc). Si pertinent →
`git cherry-pick` sur staging + tester + promouvoir. Sinon → supprimer la branche
archive (`git push origin --delete archive/2026-05-26-<nom>`).

Ces reverts touchent du sensible (mail outbox, OAuth, Hub Gateway) → ne pas
appliquer à l'aveugle, lire le diff de chacun vs l'état actuel de staging.
