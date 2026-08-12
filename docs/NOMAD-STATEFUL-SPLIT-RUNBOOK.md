# Prospection Nomad, séparation PostgreSQL stateful / app stateless

Ce runbook prépare le cutover du job production `prospection` depuis l'ancien groupe co-localisé `stack` vers deux groupes :

- `postgres` : PostgreSQL stateful, volume local `/opt/veridian-lab/prospection/db`, épinglé `ovh-prod`, sans `reschedule`.
- `app` : Next.js stateless + sidecar `pgproxy`, routage public Traefik, `reschedule`, canary et `auto_revert`.

Le but immédiat est de rendre le rightsizing applicatif non destructif : une modification de ressources app ne doit plus remplacer PostgreSQL.

## Interdit absolu

Ne jamais appliquer directement le HCL split tant que l'ancien groupe `stack` tourne. Un `job run` direct depuis le monolithe peut démarrer le nouveau groupe `postgres` avant que l'ancien `stack/prospection-saas-db` ait fermé le volume `/opt/veridian-lab/prospection/db`. Deux Postgres sur le même data-dir = risque de corruption.

Donc le cutover est une fenêtre contrôlée :

1. backup récent prouvé ;
2. plan relu ;
3. `nomad-v stop prospection` ;
4. attente que l'ancienne allocation `stack` soit terminée ;
5. preuve que `:15432` et le volume sont libres ;
6. `nomad-v deploy` seulement après ces preuves.

## Ce que ce changement ne promet pas

- Ce n'est pas une HA PostgreSQL. La donnée reste sur le volume local ovh-prod.
- Ce n'est pas un cutover automatique sans risque. Le premier passage coupe volontairement l'app pendant la fenêtre.
- Ce n'est pas une migration de données. Le volume existant est réutilisé tel quel.

## Pré-checks avant fenêtre

Depuis le bastion, sur une source Git propre et committée :

```bash
cd /home/brunon5/Bureau/veridian-platform/veridian-prospection
git fetch origin --prune
git checkout main
git pull --ff-only

python3 scripts/ci/check-nomad-stateful-split.py deploy/prospection.nomad.hcl
nomad job validate deploy/prospection.nomad.hcl
/home/brunon5/bin/nomad-v doctor
/home/brunon5/bin/nomad-v status
/home/brunon5/bin/nomad-v drift
```

Le tag image à déployer doit être rendu dans le HCL et committé avant `nomad-v deploy` : `deploy/prospection.nomad.hcl` contient `variable "image_tag" { default = "<sha7>" }`. Le wrapper `nomad-v deploy` ne passe pas de `-var` ni de `-check-index`, donc on ne déploie pas avec `nomad-v raw job run`.

## Plan, sans appliquer

```bash
/home/brunon5/bin/nomad-v plan deploy/prospection.nomad.hcl
```

Le plan depuis l'ancien monolithe doit montrer :

- `+ Task Group: "postgres" (1 create)`
- `+ Task Group: "app" (1 create)`
- `- Task Group: "stack" (1 destroy)`
- `Scheduler dry-run: All tasks successfully allocated.`

Ce plan prouve seulement que le job est schedulable. Il ne donne pas l'autorisation d'appliquer directement, parce que l'ordre interne create/destroy peut ouvrir deux Postgres sur le même volume.

## Cutover exact

1. Prouver le backup :

   ```bash
   find /home/brunon5/backups/veridian/bulk -mindepth 2 -maxdepth 2 -type f -name prospection.dump -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort | tail -3
   ```

   Il faut un `prospection.dump` non vide de moins de 26 h.

2. Stopper le job avant toute création du split :

   ```bash
   /home/brunon5/bin/nomad-v stop prospection
   ```

   Taper `oui` à la confirmation. C'est volontairement une fenêtre de coupure contrôlée.

3. Attendre que l'ancienne allocation `stack` ne soit plus active :

   ```bash
   watch -n 2 '/home/brunon5/bin/nomad-v raw job allocs prospection || true'
   ```

   Continuer seulement quand il n'y a plus d'alloc `stack` en `running`, `pending` ou `starting`.

4. Lancer le preflight exécutable :

   ```bash
   bash scripts/infra/preflight-prospection-split-cutover.sh
   ```

   Ce script refuse si :

   - une alloc `stack` tourne encore ;
   - `100.88.202.29:15432` ou `:15432` est déjà occupé sur `prod-pub` ;
   - un conteneur Docker monte encore `/opt/veridian-lab/prospection/db` ;
   - un process tient encore un fichier du volume ouvert ;
   - aucun backup `prospection.dump` récent et non vide n'est trouvé.

5. Déployer via le wrapper, pas via raw :

   ```bash
   /home/brunon5/bin/nomad-v deploy deploy/prospection.nomad.hcl
   ```

   Le HCL doit être committé, sinon `nomad-v deploy` refuse, et c'est voulu.

6. Suivre le rollout :

   ```bash
   /home/brunon5/bin/nomad-v job prospection
   /home/brunon5/bin/nomad-v logs prospection
   ```

7. Smoke externe :

   ```bash
   for i in 1 2 3 4 5 6 7 8 9 10; do
     curl -fsS -o /dev/null -w "%{http_code} " https://prospection.app.veridian.site/api/health
     sleep 3
   done
   echo
   curl -fsS https://prospection.app.veridian.site/api/status >/dev/null
   ```

8. Vérifier le drift :

   ```bash
   /home/brunon5/bin/nomad-v drift
   ```

## Rollback exact

Rollback applicatif si `app` est unhealthy mais `postgres` est sain :

1. Garder `postgres` séparé.
2. Changer `variable "image_tag".default` vers l'ancien tag image connu sain.
3. Committer le HCL.
4. Lancer `nomad-v plan`, puis `nomad-v deploy`.

Rollback structurel si le split lui-même casse le démarrage :

1. Revenir au commit HCL précédent qui contient le groupe `stack`, avec un tag image connu sain.
2. Committer ce rollback.
3. Stopper le job split :

   ```bash
   /home/brunon5/bin/nomad-v stop prospection
   ```

4. Attendre que `postgres` et `app` soient terminés, puis vérifier que le volume est libre :

   ```bash
   ssh prod-pub "ss -ltnpH 2>/dev/null | grep -E '(:15432\\b|:15432 )' || true"
   ssh prod-pub "docker ps --filter volume=/opt/veridian-lab/prospection/db --format '{{.ID}} {{.Names}}' 2>/dev/null || true"
   ssh prod-pub "timeout 20s sudo lsof -nP +D /opt/veridian-lab/prospection/db 2>/dev/null | sed -n '1,25p' || true"
   ```

   Les trois commandes doivent ne rien retourner.

5. Planifier puis déployer via wrapper :

   ```bash
   /home/brunon5/bin/nomad-v plan deploy/prospection.nomad.hcl
   /home/brunon5/bin/nomad-v deploy deploy/prospection.nomad.hcl
   ```

6. Smoke `https://prospection.app.veridian.site/api/health` puis `nomad-v drift`.

Le volume `/opt/veridian-lab/prospection/db` ne doit jamais être supprimé, déplacé ou réinitialisé dans ce rollback.
