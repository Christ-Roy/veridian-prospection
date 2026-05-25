# [PROSPECTION] Script staging-full.sh n'exporte pas DATABASE_URL → 50 fails mega battery

> **Type** : Bug script DevOps E2E
> **Sévérité** : 🔴 P0 — bloque la validation E2E hard-core avant promo prod (faux positifs masquent les vrais bugs)
> **Owner** : agent Prospection à spawner
> **Créé** : 2026-05-25 par team-lead après mega battery baseline
> **Découvert par** : team-lead, mega battery baseline pré-Vague-9-promo

## Symptôme

`bash scripts/e2e/staging-full.sh` lancé localement post-Vague-7+8 retourne **41 passed / 50 failed / 5 skipped sur 96 tests** (52% fails).

Quasi tous les fails ont la même cause :

```
Error: [e2e/auth] DATABASE_URL absent — impossible de seeder le compte canonique.
Le helper NE skippe PLUS en silence (cf migration Auth.js v5).
Exporte DATABASE_URL pointant sur la DB de l'app ciblée par PROSPECTION_URL.
```

50 specs E2E fail pour la **même raison technique** = faux positifs masse, pas des régressions réelles.

## Root cause

Le helper `e2e/helpers/auth.ts` a été migré pour Auth.js v5 + seed Prisma direct (au lieu de l'ancien flow Supabase GoTrue). Il exige maintenant `DATABASE_URL` pour upsert le user canonique dans la table `users` + `accounts` avant le login.

**MAIS** : `scripts/e2e/staging-full.sh` n'a pas été mis à jour : il ne définit pas `DATABASE_URL` dans son `export`.

Lignes 38-39 du script :
```bash
export STAGING_URL STAGING_USER_EMAIL STAGING_USER_PASSWORD
# ⚠️ DATABASE_URL pas dans la liste
```

## Conséquences

- Toutes les specs `e2e/staging-full/*.spec.ts` qui dépendent de `loginAsE2EUser()` (donc ~50 sur 96) plantent au seed
- Mega battery donne 52% fails → impossible de distinguer les vrais bugs des faux positifs
- Pré-requis Pilier 5 (gate giga-test E2E hard-core avant promo prod) cassé → on ne peut pas valider la Vague 9 sans fixer ce script

## Fix proposé

### 1. Récupérer DATABASE_URL staging depuis le compose Dokploy

```bash
# Option A : SSH + docker exec
DATABASE_URL=$(ssh dev-pub 'docker exec prospection-staging env 2>/dev/null | grep -E "^DATABASE_URL=" | head -1 | cut -d= -f2-')

# Option B : récupérer depuis credentials globaux si présent
DATABASE_URL=$(grep "^PROSPECTION_STAGING_DATABASE_URL=" ~/credentials/.all-creds.env | cut -d= -f2-)

# Option C : recompose à la main avec creds présents
# postgresql://postgres:prospection-staging-2026@postgres-staging:5432/prospection?...
```

### 2. Patcher `scripts/e2e/staging-full.sh`

Après ligne ~37 (juste avant `export STAGING_URL ...`) :

```bash
# DATABASE_URL exigé par le helper Auth.js v5 (seed user canonique avant login)
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ℹ DATABASE_URL absent — tentative récup via SSH dev-pub"
  DATABASE_URL=$(ssh dev-pub 'docker exec prospection-staging env 2>/dev/null | grep -E "^DATABASE_URL=" | head -1 | cut -d= -f2-' 2>/dev/null || echo "")
  if [ -z "$DATABASE_URL" ]; then
    echo "::error::DATABASE_URL introuvable — impossible de seeder le compte E2E. Cf todo/2026-05-25-script-staging-full-database-url-manquant.md"
    exit 1
  fi
  echo "✓ DATABASE_URL récupéré via SSH (${#DATABASE_URL} chars)"
fi

export DATABASE_URL  # ← AJOUTER
```

⚠️ Sécurité : DATABASE_URL contient le password de la DB staging. Pas de log de la valeur, juste un check de longueur. Le script tourne en local sur la machine Robert (pas en CI), donc pas de risque secret leak.

### 3. Documentation

Mettre à jour le commentaire de header du script + le `Usage` pour mentionner `DATABASE_URL`.

## Definition of done

- [ ] Script `staging-full.sh` exporte `DATABASE_URL` (récup auto ou explicite)
- [ ] Relance `bash scripts/e2e/staging-full.sh` → 95+/96 tests passent
- [ ] Si certains continuent à fail → ils sont des vrais bugs à investiguer dans des tickets dédiés
- [ ] Doc mise à jour

## Estimation

~30 min (récup DATABASE_URL + patch script + relance test).

## Référence

- Mega battery baseline 2026-05-25 17:11 — log dans `/tmp/mega-battery-baseline.log`
- 50 fails avec stack trace identique "DATABASE_URL absent"
- Helper concerné : `e2e/helpers/auth.ts` (Auth.js v5 reseed Prisma)
- Pilier 5 skill `team-lead-vagues` exige cette mega battery verte avant promo prod
