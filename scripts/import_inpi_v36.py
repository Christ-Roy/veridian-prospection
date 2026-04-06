#!/usr/bin/env python3
"""
Import INPI v3.6 parquet data into staging/prod Postgres.

- UPDATE entreprises SET (12 INPI cols) WHERE siren matches.
- INSERT INTO inpi_history ON CONFLICT (siren, annee) DO NOTHING.

Batches of 10k for both operations.

Usage:
    python3 import_inpi_v36.py \
        --dsn "postgresql://user:pass@host:port/db" \
        --entreprises /path/to/entreprises.parquet \
        --inpi-history /path/to/inpi_history.parquet

Or via env var:
    STAGING_DATABASE_URL="..." python3 import_inpi_v36.py \
        --entreprises ... --inpi-history ...

Requires: duckdb, psycopg2 (both present on dev/prod servers).
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import duckdb
import psycopg2
from psycopg2.extras import execute_values


INPI_COLS = [
    "ca_last",
    "ca_last_year",
    "ca_trend_3y",
    "marge_ebe_pct",
    "profitability_tag",
    "deficit_2y",
    "scaling_rh",
    "inpi_nb_exercices",
    "bilan_last_year",
    "bilan_confidentiality",
    "ca_growth_pct_3y",
    "actif_growth_pct_3y",
]

HISTORY_COLS = [
    "siren",
    "annee",
    "date_cloture",
    "type_bilan",
    "confidentiality",
    "ca_net",
    "resultat_net",
    "ebe",
    "rcai",
    "total_actif",
    "capital_social",
    "charges_personnel",
    "produits_exploitation",
    "immobilisations",
    "creances",
]

BATCH = 10_000


def update_entreprises(pg, parquet_path: str) -> None:
    """Stream parquet via DuckDB, UPDATE entreprises in batches."""
    print(f"[entreprises] reading {parquet_path}")
    ddb = duckdb.connect(database=":memory:")
    cols = ["siren", *INPI_COLS]
    col_list = ", ".join(cols)
    # Only rows that actually have *any* INPI data — skip rows where
    # every INPI column is NULL (nothing to update).
    where = " OR ".join(f"{c} IS NOT NULL" for c in INPI_COLS)
    cur_ddb = ddb.execute(
        f"SELECT {col_list} FROM read_parquet('{parquet_path}') WHERE {where}"
    )

    # Cast each column explicitly in the SET clause — Postgres infers VALUES
    # types as text by default, so we cast to the target column types.
    casts = {
        "ca_last": "BIGINT",
        "ca_last_year": "SMALLINT",
        "ca_trend_3y": "TEXT",
        "marge_ebe_pct": "DOUBLE PRECISION",
        "profitability_tag": "TEXT",
        "deficit_2y": "BOOLEAN",
        "scaling_rh": "BOOLEAN",
        "inpi_nb_exercices": "SMALLINT",
        "bilan_last_year": "SMALLINT",
        "bilan_confidentiality": "TEXT",
        "ca_growth_pct_3y": "INTEGER",
        "actif_growth_pct_3y": "INTEGER",
    }
    set_clause = ", ".join(
        f"{c} = data.{c}::{casts[c]}" for c in INPI_COLS
    )
    alias_cols = "(" + ", ".join(["siren", *INPI_COLS]) + ")"
    sql = (
        f"UPDATE entreprises SET {set_clause} "
        f"FROM (VALUES %s) AS data {alias_cols} "
        f"WHERE entreprises.siren = data.siren"
    )

    cur = pg.cursor()
    total = 0
    matched_total = 0
    t0 = time.time()
    while True:
        rows = cur_ddb.fetchmany(BATCH)
        if not rows:
            break
        execute_values(cur, sql, rows, page_size=BATCH)
        matched_total += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        pg.commit()
        total += len(rows)
        if total % 50_000 == 0 or len(rows) < BATCH:
            dt = time.time() - t0
            rate = total / dt if dt else 0
            print(
                f"[entreprises] processed={total:,} matched_so_far={matched_total:,} "
                f"({rate:.0f} rows/s)"
            )
    cur.close()
    dt = time.time() - t0
    print(
        f"[entreprises] done: processed={total:,} matched={matched_total:,} "
        f"in {dt:.1f}s"
    )


def insert_inpi_history(pg, parquet_path: str) -> None:
    """Stream parquet via DuckDB, INSERT inpi_history in batches."""
    print(f"[inpi_history] reading {parquet_path}")
    ddb = duckdb.connect(database=":memory:")
    col_list = ", ".join(HISTORY_COLS)
    cur_ddb = ddb.execute(
        f"SELECT {col_list} FROM read_parquet('{parquet_path}') "
        f"WHERE siren IS NOT NULL AND annee IS NOT NULL"
    )

    sql = (
        f"INSERT INTO inpi_history ({col_list}) VALUES %s "
        f"ON CONFLICT (siren, annee) DO NOTHING"
    )

    cur = pg.cursor()
    total = 0
    inserted = 0
    t0 = time.time()
    while True:
        rows = cur_ddb.fetchmany(BATCH)
        if not rows:
            break
        execute_values(cur, sql, rows, page_size=BATCH)
        inserted += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        pg.commit()
        total += len(rows)
        if total % 100_000 == 0 or len(rows) < BATCH:
            dt = time.time() - t0
            rate = total / dt if dt else 0
            print(
                f"[inpi_history] processed={total:,} inserted={inserted:,} "
                f"({rate:.0f} rows/s)"
            )
    cur.close()
    dt = time.time() - t0
    print(
        f"[inpi_history] done: processed={total:,} inserted={inserted:,} "
        f"in {dt:.1f}s"
    )


def validate(pg) -> None:
    cur = pg.cursor()
    cur.execute("SELECT COUNT(*) FROM inpi_history")
    print(f"[validate] inpi_history rows = {cur.fetchone()[0]:,}")
    cur.execute("SELECT COUNT(*) FROM entreprises WHERE ca_last IS NOT NULL")
    print(f"[validate] entreprises.ca_last NOT NULL = {cur.fetchone()[0]:,}")
    cur.execute(
        "SELECT COUNT(*) FROM entreprises WHERE profitability_tag IS NOT NULL"
    )
    print(
        f"[validate] entreprises.profitability_tag NOT NULL = "
        f"{cur.fetchone()[0]:,}"
    )
    cur.execute(
        "SELECT profitability_tag, COUNT(*) FROM entreprises "
        "WHERE profitability_tag IS NOT NULL GROUP BY 1 ORDER BY 2 DESC"
    )
    print("[validate] profitability_tag distribution:")
    for tag, n in cur.fetchall():
        print(f"    {tag!r:20s} {n:>10,}")
    cur.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dsn",
        default=os.environ.get("STAGING_DATABASE_URL")
        or os.environ.get("DATABASE_URL"),
        help="Postgres DSN (or env STAGING_DATABASE_URL / DATABASE_URL)",
    )
    parser.add_argument("--entreprises", required=True, help="entreprises.parquet path")
    parser.add_argument(
        "--inpi-history", required=True, help="inpi_history.parquet path"
    )
    parser.add_argument(
        "--skip-entreprises", action="store_true", help="Skip UPDATE entreprises step"
    )
    parser.add_argument(
        "--skip-history", action="store_true", help="Skip INSERT inpi_history step"
    )
    args = parser.parse_args()

    if not args.dsn:
        print(
            "ERROR: no DSN provided (use --dsn or set STAGING_DATABASE_URL)",
            file=sys.stderr,
        )
        return 2

    print(f"[connect] {args.dsn.split('@')[-1]}")
    pg = psycopg2.connect(args.dsn)
    try:
        if not args.skip_entreprises:
            update_entreprises(pg, args.entreprises)
        if not args.skip_history:
            insert_inpi_history(pg, args.inpi_history)
        validate(pg)
    finally:
        pg.close()
    print("[done]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
