#!/usr/bin/env python3
r"""check-mots-de-passe.py

Refuse un mot de passe littéral dans les fichiers suivis par git (VER-237, 27/11/2026 : le mot de passe du compte
Hub de Robert était en clair dans docs/TESTING.md, dépôt public). Un mot de passe se lit d'une variable
d'environnement (`process.env.X`, `$X`), jamais d'une chaîne écrite.

Formes refusées :
  - affectation : `ROBERT_PASSWORD="…"`, `password: "…"`, `MOT_DE_PASSE = '…'` (valeur littérale de 6 caractères et plus) ;
  - repli : `process.env.X_PASSWORD ?? "…"` ou `|| "…"` non vide ;
  - doc : `Password : \`…\`` ou `| Admin password | \`…\` |`.
Laissés passer : les valeurs qui sont une référence (`$X`, `${{ secrets.X }}`, `process.env`), et les secrets
factices des tests unitaires (`__tests__/`), qui ne sont pas des mots de passe.

La valeur n'est JAMAIS affichée : seulement le fichier, la ligne et le nom.
Sorties : 0 conforme · 1 refus · 2 non abouti (git illisible, ou l'auto-test ne voit pas le mot de passe planté).
"""
import os
import re
import subprocess
import sys

NOM = r"[A-Za-z_]*(?:PASSWORD|PASSWD|[Pp]assword|MOT_DE_PASSE|motDePasse|PWD)(?![A-Za-z_])"
VALEUR = r"(?P<q>[\"'`])(?P<v>(?![$])[^\"'`\s]{6,})(?P=q)"
FORMES = [
    re.compile(rf"\b(?P<nom>{NOM})\s*[:=]\s*{VALEUR}"),
    re.compile(rf"process\.env\.(?P<nom>{NOM})\s*(?:\?\?|\|\|)\s*{VALEUR}"),
    re.compile(r"(?P<nom>[Pp]assword(?: [^\W\d_]+)?)\s*(?::|\|)\s*\**`(?P<v>(?![$])[^`\s]{6,})`"),
]
EXCLUS = ("__tests__/", "package-lock.json", "scripts/ci/check-mots-de-passe.py")
FACTICES = {"testpass", "password", "changeme"}


def refus_dans(texte):
    for i, ligne in enumerate(texte.split("\n"), 1):
        for f in FORMES:
            for m in f.finditer(ligne):
                v = m.group("v")
                if v.lower() in FACTICES or v.startswith("${{") or "process.env" in v:
                    continue
                yield i, m.group("nom").strip()


def auto_test():
    plante = 'ROBERT_PASSWORD="' + "Zq9" + 'xW2vT7" npx playwright test\n| Admin password | `' + "Ab3" + 'dE5fG` |\n'
    sain = 'ROBERT_PASSWORD="$ROBERT_PASSWORD"\nconst P = process.env.E2E_USER_PASSWORD ?? "";\n'
    return len(list(refus_dans(plante))) == 2 and not list(refus_dans(sain))


def main():
    if not auto_test():
        print("NON ABOUTI : l'auto-test ne voit pas le mot de passe planté (ou refuse une référence saine)")
        return 2
    try:
        fichiers = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
    except (OSError, subprocess.CalledProcessError) as e:
        print(f"NON ABOUTI : git ls-files ({e})")
        return 2
    refus = []
    for f in fichiers:
        if not f or f.startswith(EXCLUS) or not os.path.isfile(f):
            continue
        try:
            with open(f, encoding="utf-8") as h:
                texte = h.read()
        except (OSError, UnicodeDecodeError):
            continue
        refus += [f"{f}:{i} ({nom})" for i, nom in refus_dans(texte)]
    if refus:
        print("REFUS : mot de passe littéral (valeur non affichée) ; lire une variable d'environnement :")
        print("\n".join(f"  {r}" for r in refus))
        return 1
    print(f"OK : aucun mot de passe littéral ({len(fichiers)} fichiers suivis, auto-test vu refuser)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
