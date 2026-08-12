# Prospection Nomad, séparation PostgreSQL stateful / app stateless

Ce runbook prépare le cutover du job production `prospection` depuis l'ancien groupe co-localisé `stack` vers deux groupes :

- `postgres` : PostgreSQL stateful, volume local `/opt/veridian-lab/prospection/db`, épinglé `ovh-prod`, sans `reschedule`.
- `app` : Next.js stateless + sidecar `pgproxy`, routage public Traefik, `reschedule`, canary et `auto_revert`.

Le but immédiat est de rendre le rightsizing applicatif non destructif : une modification de ressources app ne doit plus remplacer PostgreSQL.

## Ce que ce changement ne promet pas

- Ce n'est pas une HA PostgreSQL. La donnée reste sur le volume local ovh-prod.
- Ce n'est pas un cutover automatique sans risque. Le premier passage remplace l'ancien groupe `stack`, donc il doit être traité comme une fenêtre contrôlée.
- Ce n'est pas une migration de données. Le volume existant est réutilisé tel quel.

## Pré-checks avant cutover

Depuis le bastion :

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
ssh prod-pub "ss -ltnH | awk '{print \$4}' | grep -E '(:15432|100\\.88\\.202\\.29:15432)$' || true"
```

Le dernier check doit ne rien retourner : `15432` doit être libre sur ovh-prod.

## Cutover exact

1. Identifier le tag image GHCR à promouvoir, normalement le SHA court du commit `main` validé par CI.
2. Lancer le plan, sans appliquer :

   ```bash
   /home/brunon5/bin/nomad-v raw job plan -var image_tag=<sha7> deploy/prospection.nomad.hcl
   ```

3. Vérifier que le plan montre uniquement :
   - `+ Task Group: "postgres" (1 create)`
   - `+ Task Group: "app" (1 create)`
   - `- Task Group: "stack" (1 destroy)`
   - `Scheduler dry-run: All tasks successfully allocated.`
4. Appliquer avec l'index donné par le plan :

   ```bash
   /home/brunon5/bin/nomad-v raw job run -check-index <index> -var image_tag=<sha7> deploy/prospection.nomad.hcl
   ```

5. Suivre le rollout :

   ```bash
   /home/brunon5/bin/nomad-v job prospection
   /home/brunon5/bin/nomad-v logs prospection
   ```

6. Smoke externe :

   ```bash
   for i in 1 2 3 4 5 6 7 8 9 10; do
     curl -fsS -o /dev/null -w "%{http_code} " https://prospection.app.veridian.site/api/health
     sleep 3
   done
   echo
   curl -fsS https://prospection.app.veridian.site/api/status >/dev/null
   ```

7. Vérifier le drift :

   ```bash
   /home/brunon5/bin/nomad-v drift
   ```

## Rollback exact

Rollback applicatif si `app` est unhealthy mais `postgres` est sain :

1. Revenir à l'ancien tag image et relancer uniquement un plan/apply avec `-var image_tag=<ancien_sha7>` si le split est déjà actif.
2. Garder `postgres` séparé : ne pas restaurer `stack` si la DB répond et que le problème est applicatif.

Rollback structurel si le split lui-même casse le démarrage :

1. Revenir au commit HCL précédent qui contient le groupe `stack`.
2. Planifier :

   ```bash
   /home/brunon5/bin/nomad-v raw job plan -var image_tag=<ancien_sha7> deploy/prospection.nomad.hcl
   ```

3. Vérifier que le plan recrée `stack` et supprime `app`/`postgres`.
4. Appliquer avec `-check-index`.
5. Smoke `https://prospection.app.veridian.site/api/health` puis `nomad-v drift`.

Le volume `/opt/veridian-lab/prospection/db` ne doit jamais être supprimé, déplacé ou réinitialisé dans ce rollback.
