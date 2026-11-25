/** Se déconnecter pose le cookie qui interdit le rebond silencieux : sinon la page suivante rouvre la session. */
import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ status: 302 }));
vi.mock("@/lib/auth-config", () => ({
  handlers: {
    GET: vi.fn(),
    POST: vi.fn(async () => new Response(null, { status: h.status, headers: [["location", "/login"], ["set-cookie", "authjs.session-token=; Max-Age=0; Path=/"]] })),
  },
}));
import { POST } from "@/app/api/auth/[...nextauth]/route";

const poster = (chemin: string) => POST(new NextRequest(`https://x/api/auth/${chemin}`, { method: "POST" }));

test("déconnexion : la session part, le cookie est posé, la redirection est gardée", async () => {
  const r = await poster("signout");
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toBe("/login");
  expect(r.headers.getSetCookie()).toEqual([expect.stringContaining("session-token=;"), expect.stringMatching(/^veridian-logged-out=1; Path=\/; Max-Age=31536000; SameSite=Lax/)]);
});
test("ni une connexion ni une déconnexion refusée ne le posent", async () => {
  expect((await poster("callback/hub")).headers.getSetCookie().join()).not.toContain("logged-out");
  h.status = 403;
  expect((await poster("signout")).headers.getSetCookie().join()).not.toContain("logged-out");
});
