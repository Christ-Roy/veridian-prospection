#!/usr/bin/env python3
"""check-image-tag-sans-defaut.py

Refuse tout jobspec dont `variable "image_tag"` porte un `default`.
Un défaut figé fait reculer la prod au prochain déploiement sans `-var`
(09/11/2026 : défaut c70ba3c alors que la prod servait 0537d22).

Sorties : 0 conforme · 1 refus · 2 non abouti (fichier absent / pas de variable).
Auto-test : avant le contrôle réel, un fichier planté avec un défaut doit
donner 1 ; sinon le contrôle lui-même est suspect et on sort en 2.

Usage : check-image-tag-sans-defaut.py <jobspec.hcl>
"""
import re
import sys
import tempfile
import os

BLOC = re.compile(r'variable\s+"image_tag"\s*\{(.*?)\n\}', re.S)


def verdict(path):
    try:
        with open(path, encoding="utf-8") as f:
            texte = f.read()
    except OSError as e:
        print(f"NON ABOUTI : lecture impossible ({e})")
        return 2
    m = BLOC.search(texte)
    if not m:
        print('NON ABOUTI : aucun bloc variable "image_tag" dans ' + path)
        return 2
    corps = m.group(1)
    # Une ligne `default` (hors commentaire) dans le bloc = refus.
    for n, ligne in enumerate(corps.splitlines(), 1):
        code = ligne.split("#", 1)[0]
        if re.match(r"\s*default\s*=", code):
            print(f"REFUS : {path} : variable image_tag porte un default (bloc ligne {n}) : {ligne.strip()}")
            return 1
    print(f"CONFORME : {path} : variable image_tag sans default")
    return 0


def autotest():
    planté = 'variable "image_tag" {\n  type = string\n  default = "c70ba3c"\n}\n'
    fd, chemin = tempfile.mkstemp(suffix=".hcl")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(planté)
        return verdict(chemin) == 1
    finally:
        os.unlink(chemin)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    if not autotest():
        print("NON ABOUTI : auto-test (fichier planté avec default non refusé) : contrôle suspect")
        return 2
    return verdict(sys.argv[1])


if __name__ == "__main__":
    sys.exit(main())
