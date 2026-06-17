import { describe, it, expect, vi, beforeEach } from "vitest";

const { txMock } = vi.hoisted(() => {
  const tx = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn() };
  return { txMock: tx };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(txMock)) },
}));

import { isStatementTimeout, SEARCH_STATEMENT_TIMEOUT_MS, withSearchTimeout } from "./exec";

describe("isStatementTimeout", () => {
  it("détecte le SQLSTATE 57014", () => {
    expect(isStatementTimeout(new Error("... code: 57014 ..."))).toBe(true);
  });

  it("détecte le message texte du timeout Postgres", () => {
    expect(isStatementTimeout(new Error("canceling statement due to statement timeout"))).toBe(true);
  });

  it("ignore une erreur quelconque (ne déclenche pas un faux timeout)", () => {
    expect(isStatementTimeout(new Error("connection refused"))).toBe(false);
    expect(isStatementTimeout(new Error("syntax error"))).toBe(false);
  });

  it("tolère un input non-Error", () => {
    expect(isStatementTimeout("57014")).toBe(true);
    expect(isStatementTimeout(null)).toBe(false);
    expect(isStatementTimeout(undefined)).toBe(false);
  });

  it("le timeout est borné (garde-fou anti-DoS, marge raisonnable)", () => {
    expect(SEARCH_STATEMENT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SEARCH_STATEMENT_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });
});

describe("withSearchTimeout", () => {
  beforeEach(() => {
    txMock.$executeRawUnsafe.mockReset();
    txMock.$queryRawUnsafe.mockReset();
  });

  it("pose le statement_timeout AVANT d'exécuter les requêtes", async () => {
    txMock.$queryRawUnsafe.mockResolvedValue([{ ok: 1 }]);
    await withSearchTimeout(async (q) => q("SELECT 1"));
    expect(txMock.$executeRawUnsafe).toHaveBeenCalledOnce();
    expect(txMock.$executeRawUnsafe.mock.calls[0][0]).toContain("statement_timeout");
    expect(txMock.$executeRawUnsafe.mock.calls[0][0]).toContain(String(SEARCH_STATEMENT_TIMEOUT_MS));
  });

  it("fournit un runner q qui exécute via tx et remonte le résultat", async () => {
    txMock.$queryRawUnsafe.mockResolvedValue([{ n: 42 }]);
    const result = await withSearchTimeout(async (q) => {
      const rows = await q<{ n: number }[]>("SELECT $1::int AS n", 42);
      return rows[0].n;
    });
    expect(result).toBe(42);
    expect(txMock.$queryRawUnsafe).toHaveBeenCalledWith("SELECT $1::int AS n", 42);
  });

  it("propage l'erreur du callback (ex: timeout DB) au lieu de l'avaler", async () => {
    txMock.$queryRawUnsafe.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    await expect(
      withSearchTimeout(async (q) => q("SELECT slow()")),
    ).rejects.toThrow(/statement timeout/);
  });
});
