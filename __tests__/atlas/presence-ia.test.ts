/**
 * IA branchées : une écriture par minute au plus pour un même client (un échange fait des dizaines
 * d'appels), rien sans client, le nom donné par le Hub gardé, jamais l'identifiant opaque affiché.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const { upsert, findMany, hub } = vi.hoisted(() => ({ upsert: vi.fn(async (_args: unknown) => ({})), findMany: vi.fn(), hub: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { atlasPresenceIa: { upsert, findMany }, user: { findUnique: vi.fn(async () => ({ hubUserId: "h-1" })) } } }));
vi.mock("@/lib/hub/connexions-ia-client", () => ({ connexionsIaHub: hub }));

import { fusionnerConnexions, listerPresences, nomClient, noterPresence, oublierEcritures } from "@/atlas/presence-ia";

beforeEach(() => {
  upsert.mockClear();
  oublierEcritures();
});

describe("noterPresence", () => {
  test("une écriture par minute et par client, puis à nouveau après la minute", async () => {
    const t = 1_800_000_000_000;
    await noterPresence("u-1", "mcpc_a", "Claude", t);
    await noterPresence("u-1", "mcpc_a", "Claude", t + 30_000);
    expect(upsert).toHaveBeenCalledTimes(1);
    await noterPresence("u-1", "mcpc_b", null, t + 30_000); // autre client : écrit
    await noterPresence("u-1", "mcpc_a", "Claude", t + 61_000);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: { userId_clientId: { userId: "u-1", clientId: "mcpc_a" } },
      create: { userId: "u-1", clientId: "mcpc_a", clientNom: "Claude" },
    });
  });

  test("sans client, rien n'est écrit ; sans nom, le nom connu n'est pas effacé", async () => {
    await noterPresence("u-1", null, "Claude");
    expect(upsert).not.toHaveBeenCalled();
    await noterPresence("u-2", "mcpc_c", null);
    expect(upsert.mock.calls[0][0]).toMatchObject({ update: expect.not.objectContaining({ clientNom: expect.anything() }) });
  });
});

describe("affichage", () => {
  test("nom donné par le Hub, sinon « Assistant IA » ; dates en ISO", async () => {
    expect(nomClient("Claude")).toBe("Claude");
    expect(nomClient(null)).toBe("Assistant IA");
    const d = new Date("2026-11-09T21:31:00Z");
    findMany.mockResolvedValue([{ clientNom: null, premierAppel: d, dernierAppel: d }]);
    hub.mockResolvedValue(null); // Hub injoignable : la liste locale reste
    expect(await listerPresences("u-1")).toEqual([{ nom: "Assistant IA", depuis: d.toISOString(), dernier_appel: d.toISOString() }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u-1" } }));
    expect(hub).toHaveBeenCalledWith("h-1");
  });

  test("une IA reliée au Hub apparaît avant son premier appel ; un même nom ne fait qu'une ligne", () => {
    const locales = [{ nom: "Claude", depuis: "2026-11-09T21:40:00.000Z", dernier_appel: "2026-11-09T21:45:00.000Z" }];
    const hub = [
      { nom: "Claude", depuis: "2026-11-09T21:21:00.000Z", derniere_utilisation: "2026-11-09T21:30:00.000Z" },
      { nom: "ChatGPT", depuis: "2026-11-08T10:00:00.000Z", derniere_utilisation: null },
    ];
    expect(fusionnerConnexions(locales, hub)).toEqual([
      { nom: "Claude", depuis: "2026-11-09T21:21:00.000Z", dernier_appel: "2026-11-09T21:45:00.000Z" },
      { nom: "ChatGPT", depuis: "2026-11-08T10:00:00.000Z", dernier_appel: "2026-11-08T10:00:00.000Z" },
    ]);
  });
});
