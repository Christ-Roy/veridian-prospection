#!/usr/bin/env bash
# Épreuve de check-secrets.sh dans un dépôt jetable. Les faux secrets sont composés à l'exécution, jamais écrits.
set -u; SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-secrets.sh"; KO=0; D=$(mktemp -d); cd "$D"; git init -q -b main; git config user.email t@t; git config user.name t
mkdir -p scripts/ci; cp "$SCRIPT" scripts/ci/check-secrets.sh; chmod +x scripts/ci/check-secrets.sh; seq 60 > long.txt; git add -A; git commit -qm a
b=$(printf 'A%.0s' $(seq 40)); k() { printf '%s' "-----BEG""IN $1-----"; }
BASE=$(git rev-parse HEAD)
essai() { # nom, attendu, commande de préparation
  git checkout -q -B essai "$BASE"; eval "$3"; git add -A; git commit -qm x; out=$(BASE_REF=$BASE scripts/ci/check-secrets.sh 2>&1); rc=$?
  fuite=non; printf '%s' "$out" | grep -qE "AAAAAAAAAAAA|QUI_FUITE" && fuite=OUI
  if [ "$rc" = "$2" ] && [ $fuite = non ]; then e=ok; else e=ECHEC; KO=1; fi; echo "$e  $1 : rc=$rc attendu=$2 fuite=$fuite"; }
essai "rien" 0 'echo bonjour > a.txt'
essai "clé Stripe" 1 'echo "x=sk_""live_$b" > a.txt'
essai "jeton GitHub" 1 'echo "x=gh""p_$(printf A%.0s $(seq 36))" > a.txt'
for t in "RSA PRIVATE KEY" "EC PRIVATE KEY" "DSA PRIVATE KEY" "OPENSSH PRIVATE KEY" "PRIVATE KEY" "PGP PRIVATE KEY BLOCK"; do essai "clé privée $t" 1 'k "$t" > a.pem; echo >> a.pem; echo QUI_FUITE >> a.pem'; done
essai "renommé et modifié" 1 'git mv long.txt loin.txt; echo "x=sk_""live_$b" >> loin.txt'
essai "exception écrite" 0 'echo "x=sk_""live_$b # pragma: allowlist secret" > a.txt'
git checkout -q -B essai "$BASE"; echo "x=sk_""live_$b" > a.txt; git add -A; git commit -qm x
BASE_REF=origin/inexistante scripts/ci/check-secrets.sh >/dev/null 2>&1; rc=$?
if [ $rc = 2 ]; then e=ok; else e=ECHEC; KO=1; fi; echo "$e  base introuvable : rc=$rc attendu=2"
rm -rf "$D"; exit $KO
