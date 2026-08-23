import { NextResponse, type NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ isRateLimited: () => false }));

import { X402_ROUTE_PATHS, buildX402Routes, createX402RouteHandler, protectX402Request } from "./gateway";

function request(path = X402_ROUTE_PATHS.estimate, origin = "https://prospection.staging.veridian.site"): NextRequest {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filters: { all: [{ field: "departement", op: "eq", value: "69" }] } }),
  }) as NextRequest;
}

describe("x402 gateway", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it("reste fermé en 404 quand X402_ENABLED n'est pas explicitement activé", async () => {
    delete process.env.X402_ENABLED;
    delete process.env.X402_PUBLIC_BASE_URL;
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = createX402RouteHandler("estimate", handler);

    const res = await route(request());

    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("redirige une facade x402 désactivée vers le host canonique si la découverte y pointe", async () => {
    process.env.X402_ENABLED = "0";
    process.env.X402_PUBLIC_BASE_URL = "https://search-dev.staging.veridian.site";
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = createX402RouteHandler("estimate", handler);

    const res = await route(request(`${X402_ROUTE_PATHS.estimate}?source=agent`));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `https://search-dev.staging.veridian.site${X402_ROUTE_PATHS.estimate}?source=agent`,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("retourne 503 si enabled mais X402_NETWORK/X402_PAY_TO sont absents", async () => {
    process.env.X402_ENABLED = "1";
    delete process.env.X402_NETWORK;
    delete process.env.X402_PAY_TO;
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = createX402RouteHandler("estimate", handler);

    const res = await route(request());

    expect(res.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it("retourne 402 sans paiement et n'appelle jamais le handler métier", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const server = {
      requiresPayment: vi.fn(() => true),
      initialize: vi.fn(async () => undefined),
      processHTTPRequest: vi.fn(async () => ({
        type: "payment-error",
        response: {
          status: 402,
          headers: { "PAYMENT-REQUIRED": "encoded-requirements" },
          body: { error: "payment_required" },
        },
      })),
      processSettlement: vi.fn(),
    };

    const res = await protectX402Request({
      request: request(),
      endpoint: "estimate",
      routePath: X402_ROUTE_PATHS.estimate,
      handler,
      server: server as never,
    });

    expect(res.status).toBe(402);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBe("encoded-requirements");
    expect(handler).not.toHaveBeenCalled();
    expect(server.processSettlement).not.toHaveBeenCalled();
  });

  it("annonce l'URL publique canonique aux acheteurs derrière le proxy Nomad", async () => {
    process.env.APP_URL = "https://search-dev.staging.veridian.site";
    const server = {
      requiresPayment: vi.fn(() => true),
      initialize: vi.fn(async () => undefined),
      processHTTPRequest: vi.fn(async (context: { adapter: { getUrl(): string } }) => {
        expect(context.adapter.getUrl()).toContain(X402_ROUTE_PATHS.estimate);
        return {
          type: "payment-error",
          response: { status: 402, headers: {}, body: { error: "payment_required" } },
        };
      }),
    };

    await protectX402Request({
      request: request(`${X402_ROUTE_PATHS.estimate}?source=agent`, "https://0.0.0.0:3200"),
      endpoint: "estimate",
      routePath: X402_ROUTE_PATHS.estimate,
      handler: vi.fn(),
      server: server as never,
    });

    const [context] = server.processHTTPRequest.mock.calls[0];
    expect(context.adapter.getUrl()).toBe(
      `https://search-dev.staging.veridian.site${X402_ROUTE_PATHS.estimate}?source=agent`,
    );
  });

  it("déclare seulement les routes x402 explicites, sans wildcard Bazaar", () => {
    const routes = buildX402Routes("0xe8EDD109B864CB117542b2907E9c26F1a9e68761", "eip155:84532") as Record<
      string,
      { extensions: Record<string, unknown> }
    >;

    expect(Object.keys(routes).sort()).toEqual([
      `POST ${X402_ROUTE_PATHS.companies}`,
      `POST ${X402_ROUTE_PATHS.estimate}`,
    ]);
    expect(routes[`POST ${X402_ROUTE_PATHS.estimate}`].extensions.bazaar).toBeTruthy();
    expect(routes[`POST ${X402_ROUTE_PATHS.companies}`].extensions.bazaar).toBeTruthy();
    expect(Object.keys(routes)).not.toContain("*");
  });
});
