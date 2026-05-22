#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# check-ui-build.sh — garde-fou « l'app boote »
#
# Pourquoi ce script existe :
#   Sur le backend la boucle de feedback est fermée : code → tests → rouge.
#   Sur l'UI elle ne l'était pas. Les tests unitaires Vitest/jsdom montent
#   les composants depuis le CODE SOURCE — ils ne voient jamais le résultat
#   du `next build` réel. Un composant peut passer 100 % des tests unitaires
#   et casser le build de prod (import cassé, conflit de types, RSC mal
#   utilisé, dépendance manquante). C'est exactement l'incident Notifuse du
#   2026-05-22 : un manualChunks Vite mal configuré a mis la console prod
#   morte au boot, INVISIBLE pour 225 tests unitaires.
#
#   Côté Prospection (Next.js 15 App Router, PAS Vite) le risque équivalent
#   est : un agent UI casse `next build` et ne le découvre qu'en CI — ou
#   pire, le build « réussit » en apparence mais produit un `.next/`
#   incomplet (cf. piège réel : next génère les pages statiques PUIS crashe
#   sur un manifest manquant ; si on lit un `tail` piped, l'exit code du
#   pipe masque l'échec). Ce garde-fou stoppe ça au pre-push.
#
# Ce que ce script vérifie — analyse du build Next.js, zéro navigateur :
#   1. `npm run build` (= prisma generate && next build) RÉUSSIT.
#      → on capture le VRAI exit code de la commande, pas celui d'un pipe.
#   2. `.next/BUILD_ID` existe (preuve que le build est allé au bout).
#   3. Les manifests App Router existent :
#      build-manifest.json, app-build-manifest.json,
#      app-path-routes-manifest.json, routes-manifest.json.
#   4. Tous les chunks JS référencés par les manifests existent vraiment
#      sur disque (un manifest qui pointe vers un chunk absent = boot mort).
#   5. Aucun chunk JS dégénéré / vide.
#   6. Les routes principales (/prospects, /pipeline, /login) sont bien
#      présentes dans les manifests (app-path-routes-manifest.json en
#      source primaire, routes-manifest.json en complément) — preuve
#      qu'elles ont compilé.
#
# Exit 0 = build sain. Exit ≠ 0 = build cassé, push/CI doivent bloquer.
#
# Usage :  scripts/ci/check-ui-build.sh
#          SKIP_BUILD=1 scripts/ci/check-ui-build.sh   (réutilise .next/)
#
# ⚠️ COÛT & ENVIRONNEMENT — un `next build` complet est lourd : ~2-3 min et
#   ~1,5 Go de RAM. Ce script est conçu pour tourner dans un environnement
#   de BUILD (runner CI, ou le hook pre-push d'un agent) — PAS pour être
#   lancé à répétition sur un poste de dev. Deux garde-fous limitent son
#   déclenchement :
#     - Le hook pre-push (.husky/pre-push, section 1septies) ne l'appelle
#       QUE si le diff touche réellement le frontend (composants, pages,
#       next.config.ts, globals.css, package.json). Un push backend pur
#       ne rebuild jamais l'UI.
#     - SKIP_BUILD=1 réutilise un `.next/` déjà présent : on ne re-builde
#       pas, on re-vérifie juste l'intégrité (checks 2-6, quasi instantanés).
#   Pour développer/tester ce script sans charger une machine de dev :
#   l'exécuter dans un container éphémère sur le dev server, jamais en
#   boucle sur le poste local.
#
# Fail-safe : toute incertitude (dossier introuvable, manifest illisible)
# fait sortir en erreur. Mieux refuser un push légitime qu'autoriser un
# push qui met l'app morte en prod.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
NEXT_DIR="$REPO_ROOT/.next"
BUILD_LOG="/tmp/prospection-ui-build.log"

fail() { echo "${RED}✗ $1${NC}"; exit 1; }
ok()   { echo "${GREEN}✓ $1${NC}"; }

echo "${BLUE}── check-ui-build : garde-fou « l'app boote » ──${NC}"

[ -f "$REPO_ROOT/package.json" ] || fail "package.json introuvable ($REPO_ROOT)"

# ── 1. Build ─────────────────────────────────────────────────────────────
# On capture le VRAI exit code de `npm run build`. Surtout PAS de pipe vers
# tail/grep : le `$?` d'un pipeline est celui du dernier maillon, ce qui
# masquerait un `next build` qui crashe (piège vu en réel).
if [ "${SKIP_BUILD:-0}" = "1" ] && [ -d "$NEXT_DIR" ]; then
  echo "  ${YELLOW}SKIP_BUILD=1 → réutilise le .next/ existant${NC}"
else
  echo "  build de l'app (npm run build)… (~2-4 min)"
  set +e
  npm run build >"$BUILD_LOG" 2>&1
  BUILD_EXIT=$?
  set -e
  if [ "$BUILD_EXIT" -ne 0 ]; then
    echo "${RED}--- npm run build a échoué (exit $BUILD_EXIT) — fin du log : ---${NC}"
    tail -35 "$BUILD_LOG"
    fail "le build de l'app échoue — un build cassé ne doit pas être poussé"
  fi
  # Filet supplémentaire : next peut imprimer « Build error occurred » et
  # quand même sortir 0 dans certaines configs/pipes. On le traque.
  if grep -qE 'Build error occurred|Failed to compile' "$BUILD_LOG"; then
    echo "${RED}--- 'Build error occurred' détecté dans le log malgré exit 0 : ---${NC}"
    grep -E 'Build error occurred|Failed to compile|Error:' "$BUILD_LOG" | tail -15
    fail "le build a signalé une erreur — build non fiable"
  fi
  ok "build réussi (exit 0, aucune erreur dans le log)"
fi

[ -d "$NEXT_DIR" ] || fail ".next/ absent après build"

# ── 2. BUILD_ID — preuve que le build est allé au bout ───────────────────
# Next écrit BUILD_ID en toute fin de build. Présent = le build a terminé
# son cycle complet (et non « crashé après les pages statiques »).
[ -f "$NEXT_DIR/BUILD_ID" ] || fail ".next/BUILD_ID absent — build incomplet (crash en cours de route)"
BUILD_ID="$(cat "$NEXT_DIR/BUILD_ID" 2>/dev/null || true)"
[ -n "$BUILD_ID" ]            || fail ".next/BUILD_ID vide — build incomplet"
ok "BUILD_ID présent ($BUILD_ID)"

# ── 3. Manifests App Router présents ─────────────────────────────────────
# Next 15 App Router produit ces 4 manifests à la racine de .next/. L'un
# manquant = build dégénéré / interrompu avant la phase manifests.
for manifest in build-manifest.json app-build-manifest.json \
                app-path-routes-manifest.json routes-manifest.json; do
  [ -f "$NEXT_DIR/$manifest" ] || fail "manifest manquant : .next/$manifest"
  # JSON parsable (un manifest tronqué = build corrompu)
  if command -v node >/dev/null 2>&1; then
    node -e "JSON.parse(require('fs').readFileSync('$NEXT_DIR/$manifest','utf8'))" 2>/dev/null \
      || fail ".next/$manifest n'est pas un JSON valide — build corrompu"
  fi
done
ok "manifests App Router présents et JSON valides (build, app-build, app-path-routes, routes)"

# ── 4. Tous les chunks JS référencés existent sur disque ─────────────────
# build-manifest.json + app-build-manifest.json listent les chunks JS de
# chaque route. Un chunk référencé mais absent du disque = page morte au
# boot (404 sur le chunk → React ne monte jamais).
if command -v node >/dev/null 2>&1; then
  MISSING_CHUNKS="$(node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[1];
    const refs = new Set();
    for (const m of ["build-manifest.json", "app-build-manifest.json"]) {
      const j = JSON.parse(fs.readFileSync(path.join(root, ".next", m), "utf8"));
      const walk = (v) => {
        if (typeof v === "string") {
          if (v.endsWith(".js") || v.endsWith(".css")) refs.add(v);
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(j);
    }
    const missing = [];
    for (const r of refs) {
      // Les chemins des manifests sont relatifs à .next/
      const p = path.join(root, ".next", r);
      if (!fs.existsSync(p)) missing.push(r);
    }
    process.stdout.write(missing.join("\n"));
  ' "$REPO_ROOT")"
  if [ -n "$MISSING_CHUNKS" ]; then
    echo "${RED}  Chunks référencés par les manifests mais ABSENTS du disque :${NC}"
    echo "$MISSING_CHUNKS" | sed 's/^/    ✗ /'
    fail "des chunks référencés sont absents — page(s) morte(s) au boot"
  fi
  REF_COUNT="$(node -e '
    const fs=require("fs"),path=require("path");const root=process.argv[1];const s=new Set();
    for(const m of ["build-manifest.json","app-build-manifest.json"]){
      const j=JSON.parse(fs.readFileSync(path.join(root,".next",m),"utf8"));
      const w=(v)=>{if(typeof v==="string"){if(v.endsWith(".js")||v.endsWith(".css"))s.add(v);}
        else if(Array.isArray(v))v.forEach(w);else if(v&&typeof v==="object")Object.values(v).forEach(w);};
      w(j);
    }
    process.stdout.write(String(s.size));
  ' "$REPO_ROOT")"
  ok "tous les chunks référencés existent sur disque ($REF_COUNT assets vérifiés)"
else
  echo "  ${YELLOW}(node introuvable — check d'intégrité des chunks sauté)${NC}"
fi

# ── 5. Aucun chunk JS dégénéré / vide ────────────────────────────────────
# Un chunk de quelques octets = bundling cassé. On scanne les .js produits.
EMPTY=0
while IFS= read -r -d '' js; do
  SIZE="$(wc -c < "$js")"
  if [ "$SIZE" -lt 30 ]; then
    echo "${RED}  ✗ chunk JS quasi vide : ${js#$NEXT_DIR/} ($SIZE octets)${NC}"
    EMPTY=1
  fi
done < <(find "$NEXT_DIR/static" -name '*.js' -type f -print0 2>/dev/null)
[ "$EMPTY" = "0" ] || fail "un ou plusieurs chunks JS sont vides (bundling cassé)"
ok "aucun chunk JS vide dans .next/static/"

# ── 6. Routes principales présentes dans les manifests ───────────────────
# Si /prospects, /pipeline ou /login manque, c'est que la route n'a pas
# compilé → 404 en prod sur une page critique.
#
# Source primaire : app-path-routes-manifest.json — c'est LE manifest qui
# mappe les routes App Router de façon explicite et fiable
# ({"/login/page":"/login", ...}). C'est le plus robuste pour l'App Router.
# Source secondaire : routes-manifest.json (staticRoutes/dynamicRoutes) —
# peuplé par `next build`. Une route trouvée dans l'UN OU L'AUTRE suffit :
# on ne dépend pas d'une seule structure, ce qui évite tout faux positif
# si le format d'un manifest évolue entre versions de Next.
if command -v node >/dev/null 2>&1; then
  MISSING_ROUTES="$(node -e '
    const fs = require("fs");
    const found = new Set();

    // Source 1 — app-path-routes-manifest.json : valeurs = chemins de route
    try {
      const apr = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      for (const route of Object.values(apr)) {
        if (typeof route === "string") found.add(route);
      }
    } catch (_) { /* manifest déjà validé au check 3 — ignore ici */ }

    // Source 2 — routes-manifest.json : staticRoutes + dynamicRoutes
    try {
      const rm = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
      for (const r of [].concat(rm.staticRoutes || [], rm.dynamicRoutes || [])) {
        if (r && typeof r.page === "string") found.add(r.page);
      }
    } catch (_) { /* idem */ }

    const want = ["/prospects", "/pipeline", "/login"];
    const missing = want.filter((w) => !found.has(w));
    process.stdout.write(missing.join(" "));
  ' "$NEXT_DIR/app-path-routes-manifest.json" "$NEXT_DIR/routes-manifest.json")"
  if [ -n "$MISSING_ROUTES" ]; then
    echo "${RED}  Route(s) critique(s) absente(s) des manifests : $MISSING_ROUTES${NC}"
    echo "${YELLOW}    Une route absente des manifests = elle n'a pas compilé = 404 en prod.${NC}"
    fail "route(s) principale(s) manquante(s) — build structurellement incomplet"
  fi
  ok "routes principales présentes dans les manifests (/prospects, /pipeline, /login)"
else
  echo "  ${YELLOW}(node introuvable — check des routes sauté)${NC}"
fi

echo "${GREEN}── check-ui-build : l'app est buildable et structurellement saine ──${NC}"
exit 0
