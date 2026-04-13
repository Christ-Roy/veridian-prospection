#!/usr/bin/env python3
"""
Enrichit entreprises via l'API recherche-entreprises.api.gouv.fr
Split par modulo : WORKER_ID=0 fait les pairs, WORKER_ID=1 fait les impairs
Trié par prospect_score DESC (meilleurs prospects d'abord)
Rate limit: 3 req/s par worker (6 total, safe sous le 7 req/s de l'API)

Usage:
  WORKER_ID=0 python3 enrich-birth-dates.py   # local
  WORKER_ID=1 python3 enrich-birth-dates.py   # dev server
"""
import os, sys, time, json, urllib.request, psycopg2

WORKER_ID = int(os.environ.get("WORKER_ID", "0"))
WORKER_COUNT = int(os.environ.get("WORKER_COUNT", "2"))
DB_URL = os.environ.get("DB_URL", "postgresql://postgres:prospection-prod-2026@100.103.69.21:15433/prospection")
API_BASE = "https://recherche-entreprises.api.gouv.fr/search?q={siren}"
RATE_LIMIT = 1.5  # req/s per worker (3 total, conservative)

def fetch_api(siren: str):
    url = API_BASE.format(siren=siren)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"Veridian-Enrich/{WORKER_ID}"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            if not data.get("results"):
                return None
            r = data["results"][0]

            # Dirigeant (first personne physique)
            dirigeant = {}
            for d in r.get("dirigeants", []):
                if d.get("type_dirigeant") == "personne physique":
                    dirigeant = {
                        "annee_naissance": d.get("annee_de_naissance") or None,
                        "date_naissance": d.get("date_de_naissance") or None,
                        "nationalite": d.get("nationalite") or None,
                    }
                    break

            # Complements
            complements = r.get("complements") or {}
            liste_idcc = complements.get("liste_idcc") or []

            return {
                "dirigeant_annee_naissance": dirigeant.get("annee_naissance"),
                "dirigeant_date_naissance": dirigeant.get("date_naissance"),
                "dirigeant_nationalite": dirigeant.get("nationalite"),
                "etat_administratif": r.get("etat_administratif"),
                "date_fermeture": r.get("date_fermeture"),
                "nombre_etablissements": r.get("nombre_etablissements"),
                "nombre_etablissements_ouverts": r.get("nombre_etablissements_ouverts"),
                "convention_collective": ",".join(liste_idcc) if liste_idcc else None,
                "api_date_mise_a_jour": r.get("date_mise_a_jour"),
            }
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 2 ** (attempt + 1)
                print(f"  429 {siren}, wait {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            print(f"  ERR {siren}: HTTP {e.code}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"  ERR {siren}: {e}", file=sys.stderr)
            return None
    return None

def main():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # Get SIRENs to enrich, ordered by prospect_score DESC
    cur.execute("""
        SELECT siren FROM entreprises
        WHERE dirigeant_annee_naissance IS NULL
          AND etat_administratif IS NULL
          AND is_prospectable = true
        ORDER BY prospect_score DESC NULLS LAST
    """)
    all_sirens = [r[0] for r in cur.fetchall()]

    # Split by modulo
    sirens = [s for i, s in enumerate(all_sirens) if i % WORKER_COUNT == WORKER_ID]
    total = len(sirens)
    print(f"[worker-{WORKER_ID}] {total} SIRENs (of {len(all_sirens)} total)")

    enriched = 0
    skipped = 0
    start = time.time()

    for i, siren in enumerate(sirens):
        result = fetch_api(siren)

        if result:
            cur.execute("""
                UPDATE entreprises SET
                    dirigeant_annee_naissance = COALESCE(%s, ''),
                    dirigeant_date_naissance = %s,
                    dirigeant_nationalite = %s,
                    etat_administratif = COALESCE(%s, 'U'),
                    date_fermeture = %s,
                    nombre_etablissements = %s,
                    nombre_etablissements_ouverts = %s,
                    convention_collective = %s,
                    api_date_mise_a_jour = %s
                WHERE siren = %s
            """, (
                result["dirigeant_annee_naissance"],
                result["dirigeant_date_naissance"],
                result["dirigeant_nationalite"],
                result["etat_administratif"],
                result["date_fermeture"],
                result["nombre_etablissements"],
                result["nombre_etablissements_ouverts"],
                result["convention_collective"],
                result["api_date_mise_a_jour"],
                siren,
            ))
            enriched += 1
        else:
            # Mark as checked so we don't retry
            cur.execute("UPDATE entreprises SET etat_administratif = 'U' WHERE siren = %s", (siren,))
            skipped += 1

        if (i + 1) % 100 == 0:
            elapsed = time.time() - start
            rate = (i + 1) / elapsed
            eta_h = (total - i - 1) / rate / 3600
            print(f"[worker-{WORKER_ID}] {i+1}/{total} — {enriched} ok, {skipped} skip — {rate:.1f} req/s — ETA {eta_h:.1f}h")
            sys.stdout.flush()

        time.sleep(1.0 / RATE_LIMIT)

    elapsed = time.time() - start
    print(f"[worker-{WORKER_ID}] DONE — {enriched} enriched, {skipped} skipped in {elapsed/3600:.1f}h")
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
