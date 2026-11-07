/**
 * @vitest-environment jsdom
 *
 * SessionGuard : une session refusée en base repart par /auth/session-ended.
 * La réponse d'Auth.js pour un compte coupé est `{ expires }` sans `user` : next-auth
 * la classe `authenticated`, c'est le cas à attraper.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.useSession }));

import { SessionGuard } from "@/components/auth/session-guard";

const assign = vi.fn();

function visit(path: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: path, search: "", assign },
  });
}

describe("SessionGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    visit("/pipeline");
  });

  test("coupure : `authenticated` sans user repart par session-ended", () => {
    mocks.useSession.mockReturnValue({ status: "authenticated", data: { expires: "x" } });
    render(<SessionGuard />);
    expect(assign).toHaveBeenCalledWith("/auth/session-ended?next=%2Fpipeline");
  });

  test("sans session : repart aussi", () => {
    mocks.useSession.mockReturnValue({ status: "unauthenticated", data: null });
    render(<SessionGuard />);
    expect(assign).toHaveBeenCalledOnce();
  });

  test("session valable : ne fait rien", () => {
    mocks.useSession.mockReturnValue({ status: "authenticated", data: { user: { id: "u" } } });
    render(<SessionGuard />);
    expect(assign).not.toHaveBeenCalled();
  });

  test("chargement : ne fait rien", () => {
    mocks.useSession.mockReturnValue({ status: "loading", data: null });
    render(<SessionGuard />);
    expect(assign).not.toHaveBeenCalled();
  });

  test("page publique : ne fait rien", () => {
    visit("/login");
    mocks.useSession.mockReturnValue({ status: "authenticated", data: { expires: "x" } });
    render(<SessionGuard />);
    expect(assign).not.toHaveBeenCalled();
  });

  test("une seule tentative par minute, pas de boucle", () => {
    mocks.useSession.mockReturnValue({ status: "authenticated", data: { expires: "x" } });
    render(<SessionGuard />);
    render(<SessionGuard />);
    expect(assign).toHaveBeenCalledOnce();
  });
});
