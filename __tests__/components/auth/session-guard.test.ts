/**
 * SessionGuard : une session refusée en base repart par /auth/session-ended.
 * La réponse d'Auth.js pour un compte coupé est `{ expires }` sans `user` : next-auth
 * la classe `authenticated`, c'est le cas à attraper.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.useSession }));
// Pas de DOM ici : l'effet s'exécute à l'appel du composant.
vi.mock("react", () => ({ useEffect: (effect: () => void) => effect() }));

import { SessionGuard } from "@/components/auth/session-guard";

const assign = vi.fn();
const store = new Map<string, string>();

function visit(pathname: string) {
  vi.stubGlobal("window", { location: { pathname, search: "", assign } });
}

describe("SessionGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    visit("/pipeline");
  });

  test("coupure : `authenticated` sans user repart par session-ended", () => {
    mocks.useSession.mockReturnValue({ status: "authenticated", data: { expires: "x" } });
    SessionGuard();
    expect(assign).toHaveBeenCalledWith("/auth/session-ended?next=%2Fpipeline");
  });

  test("sans session : repart aussi", () => {
    mocks.useSession.mockReturnValue({ status: "unauthenticated", data: null });
    SessionGuard();
    expect(assign).toHaveBeenCalledOnce();
  });

  test("session valable : ne fait rien", () => {
    mocks.useSession.mockReturnValue({ status: "authenticated", data: { user: { id: "u" } } });
    SessionGuard();
    expect(assign).not.toHaveBeenCalled();
  });

  test("chargement : ne fait rien", () => {
    mocks.useSession.mockReturnValue({ status: "loading", data: null });
    SessionGuard();
    expect(assign).not.toHaveBeenCalled();
  });

  test("page publique : ne fait rien", () => {
    visit("/login");
    mocks.useSession.mockReturnValue({ status: "authenticated", data: { expires: "x" } });
    SessionGuard();
    expect(assign).not.toHaveBeenCalled();
  });

  test("une seule tentative par minute, pas de boucle", () => {
    mocks.useSession.mockReturnValue({ status: "authenticated", data: { expires: "x" } });
    SessionGuard();
    SessionGuard();
    expect(assign).toHaveBeenCalledOnce();
  });
});
