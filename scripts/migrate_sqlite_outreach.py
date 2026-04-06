#!/usr/bin/env python3
"""
Migrate SQLite outreach pipeline data to Postgres prod.

Maps domain -> siren via:
  1. SQLite results.siren (primary)
  2. Postgres entreprises.web_domain_normalized or web_domain (fallback)
  3. Skip + log (if both fail)

Tables migrated: outreach, followups, claude_activity, lead_segments
Target: tenant 359b76d5-bab7-4773-a889-cf4cf0248869, workspace e6eab618-1cc7-4728-9268-f3f6f7313492

Usage:
    python3 migrate_sqlite_outreach.py \
        --sqlite /path/to/scan-migrate-20260406.db \
        --dsn "postgresql://postgres:pass@host:port/prospection"

Or: DATABASE_URL="..." python3 migrate_sqlite_outreach.py --sqlite ...
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time

import psycopg2
from psycopg2.extras import execute_values


TENANT_ID = "359b76d5-bab7-4773-a889-cf4cf0248869"
WORKSPACE_ID = "e6eab618-1cc7-4728-9268-f3f6f7313492"


def build_domain_siren_map(lite: sqlite3.Connection, pg) -> dict[str, str]:
    """Build domain -> siren mapping. SQLite results first, then Postgres fallback."""
    # Collect all unique domains across all tables
    domains = set()
    for table, col in [
        ("outreach", "domain"),
        ("followups", "domain"),
        ("claude_activity", "domain"),
        ("lead_segments", "domain"),
    ]:
        c = lite.execute(f"SELECT DISTINCT {col} FROM {table} WHERE {col} IS NOT NULL")
        domains.update(r[0] for r in c.fetchall())

    print(f"[map] {len(domains)} unique domains to resolve")

    # Step 1: resolve via SQLite results.siren
    mapping: dict[str, str] = {}
    for d in domains:
        c = lite.execute(
            "SELECT siren FROM results WHERE domain = ? AND siren IS NOT NULL LIMIT 1",
            (d,),
        )
        r = c.fetchone()
        if r:
            mapping[d] = r[0]

    print(f"[map] resolved {len(mapping)} via SQLite results.siren")

    # Step 2: fallback to Postgres entreprises
    remaining = domains - set(mapping.keys())
    if remaining:
        cur = pg.cursor()
        found_pg = 0
        for d in remaining:
            # Try normalized domain first, then raw
            cur.execute(
                "SELECT siren FROM entreprises "
                "WHERE web_domain_normalized = %s OR web_domain = %s LIMIT 1",
                (d, d),
            )
            r = cur.fetchone()
            if r:
                mapping[d] = r[0]
                found_pg += 1
        cur.close()
        print(f"[map] resolved {found_pg} via Postgres entreprises")

    unresolved = domains - set(mapping.keys())
    if unresolved:
        print(f"[map] UNRESOLVED {len(unresolved)} domains (will be skipped):")
        for d in sorted(unresolved):
            print(f"  - {d}")

    return mapping


def migrate_outreach(
    lite: sqlite3.Connection, pg, mapping: dict[str, str]
) -> tuple[int, int]:
    """Migrate active outreach rows (status IS NOT NULL AND != 'a_contacter')."""
    rows = lite.execute(
        "SELECT domain, status, contacted_date, contact_method, notes, "
        "updated_at, qualification, last_visited, position "
        "FROM outreach WHERE status IS NOT NULL AND status != 'a_contacter'"
    ).fetchall()

    cur = pg.cursor()
    inserted = 0
    skipped = 0

    for domain, status, contacted_date, contact_method, notes, updated_at, qualification, last_visited, position in rows:
        siren = mapping.get(domain)
        if not siren:
            skipped += 1
            continue
        cur.execute(
            "INSERT INTO outreach (siren, tenant_id, workspace_id, status, "
            "contacted_date, contact_method, notes, updated_at, qualification, "
            "last_visited, position) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (siren, tenant_id) DO NOTHING",
            (
                siren,
                TENANT_ID,
                WORKSPACE_ID,
                status,
                contacted_date,
                contact_method,
                notes,
                updated_at,
                qualification,
                last_visited,
                position or 0,
            ),
        )
        if cur.rowcount and cur.rowcount > 0:
            inserted += 1

    pg.commit()
    cur.close()
    return inserted, skipped


def migrate_followups(
    lite: sqlite3.Connection, pg, mapping: dict[str, str]
) -> tuple[int, int]:
    rows = lite.execute(
        "SELECT domain, scheduled_at, status, note, created_at FROM followups"
    ).fetchall()

    cur = pg.cursor()
    inserted = 0
    skipped = 0

    for domain, scheduled_at, status, note, created_at in rows:
        siren = mapping.get(domain)
        if not siren:
            skipped += 1
            continue
        cur.execute(
            "INSERT INTO followups (siren, tenant_id, workspace_id, "
            "scheduled_at, status, note, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (siren, TENANT_ID, WORKSPACE_ID, scheduled_at, status, note, created_at),
        )
        if cur.rowcount and cur.rowcount > 0:
            inserted += 1

    pg.commit()
    cur.close()
    return inserted, skipped


def migrate_claude_activity(
    lite: sqlite3.Connection, pg, mapping: dict[str, str]
) -> tuple[int, int]:
    rows = lite.execute(
        "SELECT domain, activity_type, title, content, metadata, created_at "
        "FROM claude_activity"
    ).fetchall()

    cur = pg.cursor()
    inserted = 0
    skipped = 0

    for domain, activity_type, title, content, metadata, created_at in rows:
        siren = mapping.get(domain)
        if not siren:
            skipped += 1
            continue
        cur.execute(
            "INSERT INTO claude_activity (siren, tenant_id, workspace_id, "
            "activity_type, title, content, metadata, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                siren,
                TENANT_ID,
                WORKSPACE_ID,
                activity_type,
                title,
                content or "",
                metadata,
                created_at,
            ),
        )
        if cur.rowcount and cur.rowcount > 0:
            inserted += 1

    pg.commit()
    cur.close()
    return inserted, skipped


def migrate_lead_segments(
    lite: sqlite3.Connection, pg, mapping: dict[str, str]
) -> tuple[int, int]:
    rows = lite.execute(
        "SELECT domain, segment, added_at, notes FROM lead_segments"
    ).fetchall()

    cur = pg.cursor()
    inserted = 0
    skipped = 0

    for domain, segment, added_at, notes in rows:
        siren = mapping.get(domain)
        if not siren:
            skipped += 1
            continue
        cur.execute(
            "INSERT INTO lead_segments (siren, tenant_id, segment, added_at, notes) "
            "VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (siren, segment, tenant_id) DO NOTHING",
            (siren, TENANT_ID, segment, added_at, notes),
        )
        if cur.rowcount and cur.rowcount > 0:
            inserted += 1

    pg.commit()
    cur.close()
    return inserted, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", required=True, help="Path to scan-migrate SQLite")
    parser.add_argument(
        "--dsn",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres DSN (or env DATABASE_URL)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve mappings only, don't insert",
    )
    args = parser.parse_args()

    if not args.dsn:
        print("ERROR: no DSN (--dsn or DATABASE_URL)", file=sys.stderr)
        return 2

    print(f"[connect] SQLite: {args.sqlite}")
    lite = sqlite3.connect(f"file:{args.sqlite}?mode=ro", uri=True)
    print(f"[connect] Postgres: ...@{args.dsn.split('@')[-1]}")
    pg = psycopg2.connect(args.dsn)

    mapping = build_domain_siren_map(lite, pg)
    print(f"[map] total resolved: {len(mapping)}")

    if args.dry_run:
        print("[dry-run] would migrate to tenant={TENANT_ID} workspace={WORKSPACE_ID}")
        lite.close()
        pg.close()
        return 0

    summary = {}
    t0 = time.time()

    # outreach
    ins, skip = migrate_outreach(lite, pg, mapping)
    summary["outreach"] = {"inserted": ins, "skipped": skip}
    print(f"[outreach] inserted={ins} skipped={skip}")

    # followups
    ins, skip = migrate_followups(lite, pg, mapping)
    summary["followups"] = {"inserted": ins, "skipped": skip}
    print(f"[followups] inserted={ins} skipped={skip}")

    # claude_activity
    ins, skip = migrate_claude_activity(lite, pg, mapping)
    summary["claude_activity"] = {"inserted": ins, "skipped": skip}
    print(f"[claude_activity] inserted={ins} skipped={skip}")

    # lead_segments
    ins, skip = migrate_lead_segments(lite, pg, mapping)
    summary["lead_segments"] = {"inserted": ins, "skipped": skip}
    print(f"[lead_segments] inserted={ins} skipped={skip}")

    dt = time.time() - t0
    print(f"\n[summary] completed in {dt:.1f}s")
    print(f"  tenant_id:    {TENANT_ID}")
    print(f"  workspace_id: {WORKSPACE_ID}")
    for table, counts in summary.items():
        print(f"  {table:20s} inserted={counts['inserted']} skipped={counts['skipped']}")

    lite.close()
    pg.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
