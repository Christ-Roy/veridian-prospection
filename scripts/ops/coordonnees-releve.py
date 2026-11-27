#!/usr/bin/env python3
"""coordonnees-releve.py : maximum quotidien de coordonnées vues par espace payant réel (VER-249, parente 27/11).

Lit `[atlas][coordonnees] … reglage=payant … montrees=N` dans Loki (obs) sur N jours, additionne par espace et par jour
(lignes montrées : un majorant, une fiche revue recompte), écarte les espaces de test (adresse de test ou
metadata.test), et compare au plafond proposé (5 000 par jour à l'écran).

Usage : scripts/ops/coordonnees-releve.py [--jours 7] [--plafond 5000]
Sorties : 0 aucun espace réel au-dessus · 1 au moins un au-dessus (chiffre à remonter) · 2 mesure non aboutie.
Lancé à la main (aucune tâche planifiée, loi 2). Sur le bastion : obs et nomad-veridian/scripts/pgsaas-sql.sh.
"""
import argparse
import collections
import json
import os
import re
import subprocess
import sys

LIGNE = re.compile(r"\[atlas\]\[coordonnees\] jour=(\S+) outil=\S+ tenant=(\S+) plan=(\S+) reglage=payant demandees=\d+ montrees=(\d+)")
LIMITE = 5000  # plafond de lignes d'obs : atteint = relevé tronqué, donc non abouti
TEST = r"(e2e|test|jetable|veridian\.site|example)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jours", type=int, default=7)
    ap.add_argument("--plafond", type=int, default=5000)
    o = ap.parse_args()
    try:
        out = subprocess.run(["obs", "search", r"\[atlas\]\[coordonnees\].*reglage=payant", "--container", "prospection",
                              "--since", f"{24 * o.jours}h", "-n", str(LIMITE), "-f", "ndjson", "--truncate", "400"],
                             capture_output=True, text=True, timeout=300, check=True).stdout
    except (OSError, subprocess.SubprocessError) as e:
        print(f"NON ABOUTI : obs ({e})")
        return 2
    if len(out.splitlines()) >= LIMITE:
        print(f"NON ABOUTI : {LIMITE} lignes, relevé tronqué ; réduire --jours et additionner")
        return 2
    somme = collections.Counter()
    plans = {}
    for l in out.splitlines():
        try:
            m = LIGNE.search(json.loads(l)["line"])
        except (ValueError, KeyError):
            continue
        if m:
            somme[(m[2], m[1])] += int(m[4])
            plans[m[2]] = m[3]
    if not somme:
        print(f"NON ABOUTI : aucune ligne payante en {o.jours} jours (trace absente, ou aucun usage payant : vérifier la présence d'une ligne gratuite)")
        return 2
    ids = sorted({t for t, _ in somme})
    if not all(re.fullmatch(r"[0-9a-f-]{36}", t) for t in ids):
        print("NON ABOUTI : identifiant d'espace inattendu")
        return 2
    sql = (f"select t.id from tenants t left join users u on u.id=t.user_id where t.id::text in ({','.join(repr(i) for i in ids)}) "
           f"and coalesce(u.email,'') !~* '{TEST}' and coalesce(t.metadata->>'test','') <> 'true';")
    try:
        reels = set(subprocess.run([os.path.expanduser("~/nomad-veridian/scripts/pgsaas-sql.sh"), "prospection", "prospection", "prospection", sql],
                                   capture_output=True, text=True, timeout=120, check=True).stdout.split())
    except (OSError, subprocess.SubprocessError) as e:
        print(f"NON ABOUTI : base ({e})")
        return 2
    maxi = {}
    for (t, j), n in somme.items():
        if t in reels and n > maxi.get(t, (0, ""))[0]:
            maxi[t] = (n, j)
    print(f"{len(ids)} espace(s) payant(s) vus en {o.jours} j, {len(reels)} réel(s) ; plafond proposé {o.plafond} par jour")
    for t, (n, j) in sorted(maxi.items(), key=lambda x: -x[1][0]):
        print(f"  {t} plan={plans[t]} max={n} le {j}{'  AU-DESSUS' if n > o.plafond else ''}")
    return 1 if any(n > o.plafond for n, _ in maxi.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
