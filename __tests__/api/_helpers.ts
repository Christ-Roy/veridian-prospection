/**
 * Helpers communs aux tests routes API (Next 15 App Router).
 *
 * Convention :
 *  - Chaque test mocke explicitement les modules dont la route dépend
 *    (`vi.mock("@/lib/auth")`, etc.). Ces helpers fournissent juste les
 *    factories pour réduire le boilerplate.
 *  - Les routes Next 15 exportent des fonctions `GET/POST/...` qu'on appelle
 *    directement avec une `NextRequest`. Pas de serveur HTTP réel.
 *
 * IMPORTANT — env vars capturés au module-load :
 *   Beaucoup de routes font `const X = process.env.X` au top-level. Pour ces
 *   routes, il faut set l'env AVANT l'import via `vi.hoisted()` :
 *
 *     vi.hoisted(() => {
 *       process.env.STRIPE_SECRET_KEY = "sk_test_fake";
 *     });
 *     vi.mock(...);
 *     import { POST } from "@/app/api/...";
 *
 *   Sinon le module capture `undefined` et tous les tests partent en short-circuit.
 *
 * IMPORTANT — mocks Prisma :
 *   Utiliser la factory `mockPrisma()` ci-dessous pour set up les modèles
 *   utilisés par la route, puis `vi.mock("@/lib/prisma", () => ({ prisma: m }))`.
 *   Chaque méthode (`findFirst`, `update`, etc.) est un `vi.fn()` à configurer
 *   par test avec `mockResolvedValue(...)`.
 */
import { NextRequest } from "next/server";
import { vi } from "vitest";

/** Construit une NextRequest minimaliste pour appeler un handler de route. */
export function makeRequest(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    searchParams?: Record<string, string>;
  } = {},
): NextRequest {
  const u = new URL(url, "http://localhost:3000");
  if (init.searchParams) {
    for (const [k, v] of Object.entries(init.searchParams)) {
      u.searchParams.set(k, v);
    }
  }

  const body =
    init.body === undefined
      ? undefined
      : typeof init.body === "string"
      ? init.body
      : JSON.stringify(init.body);

  const headers = new Headers(init.headers ?? {});
  if (body && !headers.has("content-type") && typeof init.body !== "string") {
    headers.set("content-type", "application/json");
  }

  return new NextRequest(u, {
    method: init.method ?? "GET",
    headers,
    body,
  });
}

/** Factory user/session pour mocker `auth()` ou `getUserContext()`. */
export function makeUserContext(
  overrides: Partial<{
    userId: string;
    email: string;
    tenantId: string;
    tenantOwnerId: string | null;
    isAdmin: boolean;
    activeWorkspaceId: string | null;
    workspaces: Array<{
      id: string;
      name: string;
      slug: string;
      role: "admin" | "member" | "owner" | "viewer";
      visibilityScope: "all" | "own";
    }>;
  }> = {},
) {
  return {
    userId: overrides.userId ?? "user-test-1",
    email: overrides.email ?? "test@veridian.site",
    tenantId: overrides.tenantId ?? "tenant-test-1",
    tenantOwnerId: overrides.tenantOwnerId ?? "user-test-1",
    isAdmin: overrides.isAdmin ?? false,
    activeWorkspaceId: overrides.activeWorkspaceId ?? null,
    workspaces: overrides.workspaces ?? [
      {
        id: "ws-test-1",
        name: "Workspace Test",
        slug: "ws-test",
        role: "owner" as const,
        visibilityScope: "all" as const,
      },
    ],
  };
}

/** Session Auth.js v5 minimale. */
export function makeSession(
  overrides: { userId?: string; email?: string } = {},
) {
  return {
    user: {
      id: overrides.userId ?? "user-test-1",
      email: overrides.email ?? "test@veridian.site",
    },
    expires: new Date(Date.now() + 86400_000).toISOString(),
  };
}

/**
 * Factory pour la réponse `{ error: NextResponse }` retournée par
 * `requireAdmin()` quand l'utilisateur n'est pas admin.
 */
export async function makeForbidden() {
  const { NextResponse } = await import("next/server");
  return {
    error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  };
}

/** Wrapper pratique : lit le body JSON d'une NextResponse. */
export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Met en place les mocks Prisma de base. À étendre par test selon les modèles
 * utilisés. Retourne le mock pour assertions.
 */
export function mockPrisma() {
  const m = {
    tenant: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    entreprise: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    outreach: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    followups: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $disconnect: vi.fn(),
  };
  return m;
}
