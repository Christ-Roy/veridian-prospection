/**
 * Liens d'installation lus au Hub (§5.24.1, CONTRAT-MCP.md) : `assistants[]` tel que servi, seules les origines garanties passent
 * (une réponse piégée ne met ni `javascript:` ni un site tiers dans un bouton), toute panne rend null, cache de 5 min au plus.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

import { liensIA, viderCacheLiensIA } from "@/lib/hub/liens-ia-client";

const ENV = { NEXT_PUBLIC_HUB_URL: "https://hub.test" } as unknown as NodeJS.ProcessEnv;
const T = 1_800_000_000_000;
beforeEach(() => viderCacheLiensIA());

// Forme servie par le Hub le 27/11 (relevée en prod), raccourcie.
const SERVI = {
  url: "https://app.veridian.site/api/mcp",
  claude: "https://claude.ai/customize/connectors?x=1",
  claudeCode: "claude mcp add --transport http veridian https://app.veridian.site/api/mcp",
  assistants: [
    { cle: "claude", libelle: "Ajouter à Claude", installation: "https://claude.ai/customize/connectors?x=1", etape: null },
    { cle: "chatgpt", libelle: "Ouvrir ChatGPT", installation: "https://chatgpt.com/plugins", etape: "Dans ChatGPT sur le web, page Plugins : bouton +." },
    { cle: "cursor", libelle: "Ajouter à Cursor", installation: "cursor://anysphere.cursor-deeplink/mcp/install?x", etape: null },
    { cle: "vscode", libelle: "Ajouter à VS Code", installation: "https://vscode.dev/redirect?url=x", etape: null },
    { cle: "piege", libelle: "Cliquez ici", installation: "javascript:alert(1)", etape: null },
    { cle: "tiers", libelle: "Ailleurs", installation: "https://claude.ai.evil.test/x", etape: null },
  ],
};

describe("liensIA", () => {
  test("lit assistants[] dans l'ordre du Hub, écarte les origines hors contrat, garde l'adresse et la commande", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = (async (url: string) => {
      expect(url).toBe("https://hub.test/api/mcp/liens-installation?app=prospection");
      return new Response(JSON.stringify(SERVI));
    }) as unknown as typeof fetch;
    const l = await liensIA({ env: ENV, fetchImpl, maintenant: T });
    expect(l?.url).toBe("https://app.veridian.site/api/mcp");
    expect(l?.claudeCode).toBe(SERVI.claudeCode);
    expect(l?.assistants.map((a) => a.cle)).toEqual(["claude", "chatgpt", "cursor", "vscode"]);
    expect(l?.assistants[1]).toEqual({ cle: "chatgpt", libelle: "Ouvrir ChatGPT", installation: "https://chatgpt.com/plugins", etape: "Dans ChatGPT sur le web, page Plugins : bouton +." });
    expect(l?.assistants[0].etape).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("cache de 5 min au plus : relu au-delà", async () => {
    let n = 0;
    const fetchImpl = (async () => (n++, new Response(JSON.stringify(SERVI)))) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await liensIA({ env: ENV, fetchImpl, maintenant: T });
    await liensIA({ env: ENV, fetchImpl, maintenant: T + 4 * 60_000 });
    expect(n).toBe(1);
    await liensIA({ env: ENV, fetchImpl, maintenant: T + 5 * 60_000 + 1 });
    expect(n).toBe(2);
  });

  test("sans assistants : l'adresse et la commande restent, aucun bouton", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ url: SERVI.url, claudeCode: SERVI.claudeCode }))) as unknown as typeof fetch;
    expect(await liensIA({ env: ENV, fetchImpl, maintenant: T })).toEqual({ url: SERVI.url, claudeCode: SERVI.claudeCode, assistants: [] });
  });

  test("Hub absent, en erreur ou sans adresse : null", async () => {
    const ko = (async () => new Response("non", { status: 404 })) as unknown as typeof fetch;
    expect(await liensIA({ env: ENV, fetchImpl: ko, maintenant: T })).toBeNull();
    const sansUrl = (async () => new Response(JSON.stringify({ assistants: SERVI.assistants }))) as unknown as typeof fetch;
    expect(await liensIA({ env: ENV, fetchImpl: sansUrl, maintenant: T })).toBeNull();
    const panne = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await liensIA({ env: ENV, fetchImpl: panne, maintenant: T })).toBeNull();
  });
});
