/**
 * Tests de la route catch-all Auth.js /api/auth/[...nextauth].
 *
 * Cette route ré-exporte simplement `GET`/`POST` depuis `@/lib/auth`. Le test
 * valide que les handlers sont bien exposés et fonctionnels (pas un export
 * `undefined` ou cassé après une migration).
 */
import { describe, expect, test, vi } from "vitest";

const { handlersMock } = vi.hoisted(() => ({
  handlersMock: {
    GET: vi.fn(async () => new Response("ok-get")),
    POST: vi.fn(async () => new Response("ok-post")),
  },
}));

vi.mock("@/lib/auth", () => ({
  handlers: handlersMock,
}));

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest } from "next/server";

describe("Auth.js catch-all /api/auth/[...nextauth]", () => {
  test("GET handler is wired to lib/auth handlers", async () => {
    expect(typeof GET).toBe("function");
    const res = await GET(new NextRequest("http://localhost/api/auth/session"));
    expect(await res.text()).toBe("ok-get");
    expect(handlersMock.GET).toHaveBeenCalled();
  });

  test("POST handler is wired to lib/auth handlers", async () => {
    expect(typeof POST).toBe("function");
    const res = await POST(
      new NextRequest("http://localhost/api/auth/callback", { method: "POST" }),
    );
    expect(await res.text()).toBe("ok-post");
    expect(handlersMock.POST).toHaveBeenCalled();
  });
});
