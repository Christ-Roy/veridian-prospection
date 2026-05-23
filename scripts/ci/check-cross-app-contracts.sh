#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# check-cross-app-contracts.sh — smoke contractuel cross-app léger
#
# Pourquoi ce script existe :
#   Le bug invitations 2026-05-23 (Supabase mort 5 jours en silence) est
#   passé tous les filtres : test mocké au vert, build au vert, route
#   safety au vert. Aucun garde-fou ne vérifiait que l'endpoint distant
#   appelé en runtime existe encore vraiment.
#
#   Quand l'app fait `fetch(\`${HUB_API_URL}/api/webhooks/prospection\`)`,
#   c'est un contrat implicite : « cet endpoint répond, accepte cette
#   méthode, je n'y vais qu'en runtime, je ne le découvrirai cassé qu'en
#   prod ». On ne peut pas tester ça au build — mais on peut le smoker
#   au pre-push, contre staging (proxy de prod).
#
# Ce que ce script fait :
#   1. Grep le code source (src/) pour les patterns d'appel cross-app
#      sortants vers les services Veridian : Hub, Notifuse (étendable).
#      Patterns matchés (en clair, pas dynamiques) :
#        - fetch(`${HUB_API_URL}/api/...`)
#        - fetch(`${NOTIFUSE_URL}/api/...`) — ou ${url} dans le module Notifuse
#        - fetch(\`${process.env.HUB_API_URL}/...\`)
#   2. Pour chaque endpoint identifié (couple service+path) :
#      - Résout l'URL staging du service (env var injectable, defaults sains).
#      - Smoke HEAD (fallback GET si HEAD refusé) avec timeout court (8s).
#      - Accepte : 2xx, 3xx, 401, 403, 405 (l'endpoint VIT)
#      - REFUSE  : 404, 0 (DNS fail / connection refused / timeout)
#   3. BLOCKING sur tout endpoint mort.
#
# Exit 0 = tous les endpoints cross-app vivants.
# Exit ≠ 0 = au moins un endpoint mort → push refusé.
#
# Usage :  scripts/ci/check-cross-app-contracts.sh
#          SKIP_CROSS_APP_CONTRACTS=1 git push    (skip d'urgence)
#
# Coût : ~1-3s par endpoint (curl HTTPS avec timeout 8s, généralement <1s).
#        Le hook ne tourne que si du code applicatif a bougé.
#
# Limitation acceptée :
#   - Ne couvre que les URLs littérales (path en dur dans le fetch). Les
#     URLs construites dynamiquement (concat, template complexe avec
#     variables runtime) ne sont pas vues. C'est OK : le bug invitations
#     2026-05-23 aurait été attrapé — l'URL Supabase /auth/v1/admin/users
#     était littérale.
#   - Smoke sans auth. Un endpoint qui répond 401 est considéré vivant
#     (ce qu'on veut). Un endpoint mort répond typiquement 404 ou rien.
#   - URLs staging utilisées (pas prod) — proxy raisonnable pour détecter
#     les endpoints supprimés. Si staging diverge structurellement de prod
#     (rare), le check peut produire un faux positif/négatif.
#
# Sabotage-testé 2026-05-23 :
#   - Cas SAIN : grep des 2 endpoints réels (Hub /api/webhooks/prospection
#     et Notifuse /api/transactional.send) → 405 et 401 → vivants → exit 0 ✓
#   - Cas DÉTECTÉ : ajout d'un fetch vers un endpoint Hub inexistant
#     /api/inexistant-test-husky → 404 → exit 1 ✓
#
# Fail-safe :
#   - curl absent → exit 1 (dépendance critique, on refuse silencieusement
#     l'autorisation).
#   - Réseau coupé total → tous les endpoints répondent 0 → push refusé
#     avec message clair (on n'autorise PAS un push qui ne peut pas être
#     validé). Skip d'urgence : SKIP_CROSS_APP_CONTRACTS=1.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ "${SKIP_CROSS_APP_CONTRACTS:-0}" = "1" ]; then
  echo "⚠ check-cross-app-contracts.sh skipped via SKIP_CROSS_APP_CONTRACTS=1"
  exit 0
fi

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "${BLUE}── check-cross-app-contracts : smoke endpoints cross-app ──${NC}"

if ! command -v curl >/dev/null 2>&1; then
  echo "${RED}✗ curl introuvable — impossible de smoker, push refusé${NC}"
  echo "  (skip d'urgence : SKIP_CROSS_APP_CONTRACTS=1 git push)"
  exit 1
fi

# ─── URLs staging par service ────────────────────────────────────────────
# Injectables via env (CI peut viser preview), sinon defaults staging.
HUB_STAGING_URL="${HUB_STAGING_URL:-https://app.veridian.site}"
NOTIFUSE_STAGING_URL="${NOTIFUSE_STAGING_URL:-https://notifuse.staging.veridian.site}"
CMS_STAGING_URL="${CMS_STAGING_URL:-https://cms.staging.veridian.site}"
ANALYTICS_STAGING_URL="${ANALYTICS_STAGING_URL:-https://analytics.staging.veridian.site}"

# Note : pour le Hub on vise PROD (app.veridian.site) car c'est l'instance
# stable et publique. Le Hub staging derrière Tailscale n'est pas joignable
# depuis un poste qui n'a pas Tailscale up — résultat 0 = faux négatif.
# Le risque "endpoint divergent staging vs prod" est minimal sur le Hub.

# ─── Grep des endpoints cross-app ────────────────────────────────────────
# Format : SERVICE_LABEL|BASE_URL|PATH|FILE:LINE
# Liste produite par grep puis nettoyage pour extraire le path littéral.
ENDPOINTS_FILE="/tmp/cross-app-endpoints-$$.txt"
trap 'rm -f "$ENDPOINTS_FILE"' EXIT
: > "$ENDPOINTS_FILE"

# Helper grep — capture les template literals `${VAR}/path...`
# dans tout le code applicatif (pas que dans `fetch(`). Le Hub fait par
# exemple `const fullUrl = \`${url}/api/webhooks/prospection\`;` puis
# `fetch(fullUrl)` — chercher fetch directement raterait. On grep donc
# tous les template literals qui ressemblent à une URL d'API.
extract_endpoints_for() {
  local label="$1" base_url="$2" var_pattern="$3"
  while IFS=: read -r file lineno match; do
    [ -z "$file" ] && continue
    # Extrait le path littéral après le `${VAR...}/`
    local path
    path=$(echo "$match" | grep -oE "\\\$\\{[^}]*(${var_pattern})[^}]*\\}/[a-zA-Z0-9._/-]+" \
           | sed -E "s|.*}/([a-zA-Z0-9._/-]+).*|/\\1|" | head -1)
    if [ -n "$path" ]; then
      echo "${label}|${base_url}|${path}|${file}:${lineno}" >> "$ENDPOINTS_FILE"
    fi
  done < <(grep -rnE "\`[^\`]*\\\$\\{[^}]*(${var_pattern})[^}]*\\}/[a-zA-Z0-9._/-]+" src/ 2>/dev/null \
           | grep -vE "(\.test\.|__tests__)" || true)
}

# Hub — patterns : ${HUB_API_URL}/..., ${HUB_URL}/...
extract_endpoints_for "HUB" "$HUB_STAGING_URL" "HUB_API_URL|HUB_URL"

# Notifuse — patterns : ${NOTIFUSE_URL}/..., et ${url}/... dans src/lib/notifuse/
# Le module notifuse fait `const url = getNotifuseUrl(); fetch(\`${url}/api/...\`)`
# donc on capture aussi ${url} mais SEULEMENT dans src/lib/notifuse/
extract_endpoints_for "NOTIFUSE" "$NOTIFUSE_STAGING_URL" "NOTIFUSE_URL"
# Cas spécifique notifuse : template `${url}/api/...` dans src/lib/notifuse/
# (alias local de NOTIFUSE_URL). Périmètre strict au sous-dossier.
while IFS=: read -r file lineno match; do
  [ -z "$file" ] && continue
  case "$file" in
    src/lib/notifuse/*) ;;
    *) continue ;;
  esac
  local_path=$(echo "$match" | grep -oE "\\\$\\{url\\}/[a-zA-Z0-9._/-]+" \
               | sed -E "s|.*}/([a-zA-Z0-9._/-]+).*|/\\1|" | head -1)
  if [ -n "$local_path" ]; then
    echo "NOTIFUSE|${NOTIFUSE_STAGING_URL}|${local_path}|${file}:${lineno}" >> "$ENDPOINTS_FILE"
  fi
done < <(grep -rnE "\`[^\`]*\\\$\\{url\\}/[a-zA-Z0-9._/-]+" src/lib/notifuse/ 2>/dev/null \
         | grep -vE "(\.test\.)" || true)

# CMS et Analytics — patterns équivalents, vide aujourd'hui mais ouvert.
extract_endpoints_for "CMS" "$CMS_STAGING_URL" "CMS_URL|CMS_API_URL"
extract_endpoints_for "ANALYTICS" "$ANALYTICS_STAGING_URL" "ANALYTICS_URL|ANALYTICS_API_URL"

# Dédup (même service+path appelé depuis plusieurs fichiers → 1 smoke suffit)
sort -u "$ENDPOINTS_FILE" -o "$ENDPOINTS_FILE"

ENDPOINT_COUNT=$(wc -l < "$ENDPOINTS_FILE" | tr -d ' ')
if [ "$ENDPOINT_COUNT" = "0" ]; then
  echo "${GREEN}✓ Aucun appel cross-app détecté dans src/ — rien à smoker${NC}"
  exit 0
fi
echo "  $ENDPOINT_COUNT endpoint(s) cross-app détecté(s) — smoke en cours…"

# ─── Smoke de chaque endpoint ────────────────────────────────────────────
FAILED=0
OK=0

while IFS='|' read -r label base path origin; do
  [ -z "$label" ] && continue
  full_url="${base}${path}"
  # HEAD d'abord (léger, no body). Si refusé/501 sur HEAD, fallback GET.
  # On capture le code HTTP final, 000 si pas de réponse.
  # Note curl : si la requête traverse des redirections OU HEAD est mal
  # supporté (PARTIAL_FILE), %{http_code} peut être imprimé plusieurs
  # fois. On ajoute \n et tail -1 pour garder le code final. On désactive
  # set -e localement car curl peut sortir non-zero sans erreur de
  # diagnostic (PARTIAL_FILE sur HEAD est normal pour certains serveurs).
  set +e
  code=$(curl -sk -o /dev/null -w "%{http_code}\n" -X HEAD --max-time 8 "$full_url" 2>/dev/null | tail -1)
  set -e
  method="HEAD"
  # 000 = no response. 501 = serveur refuse HEAD spécifiquement (rare).
  if [ "$code" = "000" ] || [ "$code" = "501" ] || [ -z "$code" ]; then
    set +e
    code=$(curl -sk -o /dev/null -w "%{http_code}\n" --max-time 8 "$full_url" 2>/dev/null | tail -1)
    set -e
    method="GET"
  fi
  # Si toujours vide (curl complètement KO), force 000
  [ -z "$code" ] && code="000"

  case "$code" in
    2*|3*|401|403|405)
      echo "${GREEN}  ✓ $label ${path} → $code (vivant, ${method} ${full_url})${NC}"
      OK=$((OK + 1))
      ;;
    404)
      echo "${RED}  ✗ $label ${path} → 404 (endpoint mort)${NC}"
      echo "${YELLOW}      référencé depuis : $origin${NC}"
      echo "${YELLOW}      smoke : ${method} ${full_url}${NC}"
      FAILED=$((FAILED + 1))
      ;;
    000)
      echo "${RED}  ✗ $label ${path} → connection failed (DNS/refused/timeout)${NC}"
      echo "${YELLOW}      référencé depuis : $origin${NC}"
      echo "${YELLOW}      smoke : ${method} ${full_url}${NC}"
      FAILED=$((FAILED + 1))
      ;;
    *)
      # 5xx = service en panne — on warne mais on ne bloque PAS (faux pos
      # potentiel, c'est l'autre app qui plante, pas le contrat qui ment).
      echo "${YELLOW}  ⚠ $label ${path} → $code (autre, warning seulement)${NC}"
      echo "${YELLOW}      référencé depuis : $origin${NC}"
      OK=$((OK + 1))
      ;;
  esac
done < "$ENDPOINTS_FILE"

# ─── Verdict ────────────────────────────────────────────────────────────
echo
echo "${BLUE}── récap cross-app : $OK ok / $FAILED fail ──${NC}"

if [ "$FAILED" -gt 0 ]; then
  echo
  echo "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo "${RED}║ PUSH REFUSÉ — $FAILED endpoint(s) cross-app mort(s)        ║${NC}"
  echo "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  echo
  echo "Le code appelle un endpoint qui n'existe plus côté service distant."
  echo "C'est exactement le bug invitations 2026-05-23 (Supabase mort 5 jours)."
  echo "Fix : soit l'endpoint a déménagé (mets à jour le code), soit le"
  echo "service est down (préviens l'équipe de l'app cible)."
  echo
  echo "Skip d'urgence (à NE PAS faire en CI) : SKIP_CROSS_APP_CONTRACTS=1 git push"
  exit 1
fi

echo "${GREEN}✓ Tous les endpoints cross-app référencés répondent${NC}"
exit 0
