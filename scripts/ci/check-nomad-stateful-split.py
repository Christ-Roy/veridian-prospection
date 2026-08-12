#!/usr/bin/env python3
"""Guard against re-coupling PostgreSQL and public app tasks in Nomad HCL.

This is intentionally small and dependency-free: CI must reject the exact class
of incident where a rightsizing-only edit replaces a group that also contains a
local-volume database.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


HCL_PATH = Path(sys.argv[1] if len(sys.argv) > 1 else "deploy/prospection.nomad.hcl")


def strip_comments(text: str) -> str:
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


def find_blocks(text: str, kind: str) -> dict[str, str]:
    blocks: dict[str, str] = {}
    pattern = re.compile(rf'\b{re.escape(kind)}\s+"([^"]+)"\s*\{{')
    for match in pattern.finditer(text):
        name = match.group(1)
        start = match.end()
        depth = 1
        pos = start
        while pos < len(text) and depth:
            if text[pos] == "{":
                depth += 1
            elif text[pos] == "}":
                depth -= 1
            pos += 1
        if depth:
            raise SystemExit(f"Malformed HCL: unclosed {kind} {name!r}")
        blocks[name] = text[start : pos - 1]
    return blocks


def fail(message: str) -> None:
    print(f"::error::{message}")
    raise SystemExit(1)


raw = HCL_PATH.read_text(encoding="utf-8")
hcl = strip_comments(raw)
groups = find_blocks(hcl, "group")

if "postgres" not in groups:
    fail("Nomad job must keep PostgreSQL in a dedicated group named 'postgres'.")
if "app" not in groups:
    fail("Nomad job must keep the public application in a dedicated group named 'app'.")
if "stack" in groups:
    fail("Legacy co-located group 'stack' is forbidden in production Prospection.")

for group_name, body in groups.items():
    has_postgres_task = bool(
        re.search(r'task\s+"[^"]*(?:db|postgres)[^"]*"', body)
        or re.search(r'image\s*=\s*"postgres:', body)
    )
    has_public_http = "traefik.enable=true" in body and "prospection.app.veridian.site" in body
    if has_postgres_task and has_public_http:
        fail(
            f"Group {group_name!r} mixes PostgreSQL and public Traefik app routing; "
            "rightsizing would restart state."
        )

postgres = groups["postgres"]
app = groups["app"]

if "reschedule" in postgres:
    fail("Stateful PostgreSQL group must not declare reschedule with a local volume.")
if 'value     = "ovh-prod"' not in postgres and 'value = "ovh-prod"' not in postgres:
    fail("Stateful PostgreSQL group must stay pinned to ovh-prod until data migration is planned.")
if 'host_network = "tailscale"' not in postgres:
    fail("PostgreSQL port must bind on host_network=tailscale only.")
if "/opt/veridian-lab/prospection/db:/var/lib/postgresql/data" not in postgres:
    fail("PostgreSQL group must preserve the existing local volume path.")

if "reschedule" not in app:
    fail("Stateless app group must declare reschedule.")
for required in ("auto_revert", "canary", "prospection.app.veridian.site", 'task "pgproxy"'):
    if required not in app:
        fail(f"Stateless app group missing required safety element: {required}")
if 'DATABASE_URL=postgresql://postgres:{{ .DB_PASSWORD }}@127.0.0.1:5432/prospection' not in app:
    fail("App must keep DATABASE_URL pointed at local pgproxy, not directly at the DB container.")

print(f"✓ Nomad stateful/stateless split guard OK ({HCL_PATH})")
