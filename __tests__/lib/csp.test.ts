/**
 * CSP à nonce (VER-265) : jamais 'unsafe-inline' ni 'unsafe-eval' dans script-src en production, un nonce neuf par
 * requête, posé sur toutes les réponses (redirections du rebond comprises) et transmis à Next ; les rapports gardés
 * sans query ni extrait de code.
 */
import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    updateSession: async (req: NextRequest, suite: () => Response) =>
      req.nextUrl.pathname === "/rebond" ? NextResponse.redirect("https://app.veridian.site/api/auth/bounce/prepare", 307) : suite(),
  };
});

import { ENTETE, nonce, politique, resumerRapport } from "@/lib/csp";
import { middleware } from "@/middleware";

const directive = (csp: string, nom: string) => csp.split("; ").find((d) => d.startsWith(`${nom} `)) ?? "";

describe("politique", () => {
  test("scripts : nonce et strict-dynamic, jamais unsafe-inline ni unsafe-eval en production", () => {
    const s = directive(politique("abc", false), "script-src");
    expect(s).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(politique("abc", false)).not.toMatch(/script-src[^;]*unsafe/);
  });
  test("ni plugin, ni cadre, rien vers l'extérieur, rapport vers /api/csp", () => {
    const p = politique("n", false);
    for (const d of ["object-src 'none'", "frame-ancestors 'none'", "frame-src 'none'", "connect-src 'self'", "base-uri 'self'", "report-uri /api/csp", "upgrade-insecure-requests"]) expect(p).toContain(d);
  });
  test("un nonce neuf, imprévisible, à chaque appel", () => {
    const n = new Set(Array.from({ length: 50 }, nonce));
    expect(n.size).toBe(50);
    for (const x of n) expect(Buffer.from(x, "base64")).toHaveLength(16);
  });
});

describe("middleware", () => {
  test("page servie : en-tête de la réponse et nonce transmis à Next identiques, différents d'une requête à l'autre", async () => {
    const lire = async () => {
      const r = await middleware(new NextRequest("https://prospection.app.veridian.site/"));
      const csp = r.headers.get(ENTETE) ?? "";
      return { csp, transmis: r.headers.get("x-middleware-request-content-security-policy"), nonce: r.headers.get("x-middleware-request-x-nonce"), rapport: r.headers.get("reporting-endpoints") };
    };
    const a = await lire(), b = await lire();
    expect(a.csp).toContain(`'nonce-${a.nonce}'`);
    expect(a.transmis).toBe(a.csp);
    expect(a.rapport).toBe('csp="/api/csp"');
    expect(a.nonce).not.toBe(b.nonce);
  });
  test("redirection du rebond : la politique y est aussi", async () => {
    const r = await middleware(new NextRequest("https://prospection.app.veridian.site/rebond"));
    expect(r.status).toBe(307);
    expect(r.headers.get(ENTETE)).toMatch(/script-src 'self' 'nonce-/);
  });
});

test("rapport : directive et origine gardées, query, chemin de la source réduit, extrait de code jamais", () => {
  const r = resumerRapport({ "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "https://mauvais.example/x.js?jeton=secret", "document-uri": "https://prospection.app.veridian.site/?email=a@b.fr", "source-file": "https://prospection.app.veridian.site/_next/a.js?v=1", "line-number": 3, "script-sample": "alert(1)" } });
  expect(r).toEqual([{ directive: "script-src-elem", bloque: "https://mauvais.example/x.js", page: "https://prospection.app.veridian.site/", source: "https://prospection.app.veridian.site/_next/a.js:3" }]);
  expect(JSON.stringify(r)).not.toMatch(/secret|a@b|alert/);
  expect(resumerRapport([{ type: "csp-violation", body: { effectiveDirective: "script-src-attr", blockedURL: "inline", documentURL: "https://x/p" } }])).toEqual([{ directive: "script-src-attr", bloque: "inline", page: "https://x/p", source: null }]);
  expect(resumerRapport("n'importe quoi")).toEqual([]);
});
