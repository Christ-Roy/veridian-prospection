/**
 * Liens « Ajouter à … » lus au Hub : seuls des liens https, cursor:// ou vscode: passent (une réponse
 * piégée ne met pas de javascript: dans un bouton), toute panne rend null, cache de 10 min.
 */
import { beforeEach, describe, expect, test } from "vitest";

import { liensIA, viderCacheLiensIA } from "@/lib/hub/liens-ia-client";

const ENV = { NEXT_PUBLIC_HUB_URL: "https://hub.test" } as unknown as NodeJS.ProcessEnv;
const T = 1_800_000_000_000;
beforeEach(() => viderCacheLiensIA());

describe("liensIA", () => {
  test("lit les liens du Hub, écarte un lien dangereux, met en cache", async () => {
    let n = 0;
    const fetchImpl = (async (url: string) => {
      n++;
      expect(url).toBe("https://hub.test/api/mcp/liens-installation?app=prospection");
      // Forme servie par le Hub le 10/11 (champs plats + instructions imbriquées).
      return new Response(JSON.stringify({ url: "https://app.veridian.site/api/mcp", claude: "https://claude.ai/customize/connectors?x=1", chatgpt: "javascript:alert(1)", cursor: "cursor://anysphere.cursor-deeplink/mcp/install?x", vscode: "https://vscode.dev/redirect?url=x", claudeCode: "claude mcp add veridian", instructions: { chatgpt: "Dans ChatGPT : ajoutez un serveur MCP." } }));
    }) as unknown as typeof fetch;
    const l = await liensIA({ env: ENV, fetchImpl, maintenant: T });
    expect(l).toMatchObject({ url: "https://app.veridian.site/api/mcp", claude: "https://claude.ai/customize/connectors?x=1", chatgpt: null, claudeCode: "claude mcp add veridian", aideChatgpt: "Dans ChatGPT : ajoutez un serveur MCP." });
    expect(l?.cursor).toMatch(/^cursor:/);
    await liensIA({ env: ENV, fetchImpl, maintenant: T + 5 * 60_000 });
    expect(n).toBe(1);
  });

  test("Hub absent, en erreur ou sans adresse : null", async () => {
    const ko = (async () => new Response("non", { status: 404 })) as unknown as typeof fetch;
    expect(await liensIA({ env: ENV, fetchImpl: ko, maintenant: T })).toBeNull();
    const sansUrl = (async () => new Response(JSON.stringify({ claude: "https://claude.ai" }))) as unknown as typeof fetch;
    expect(await liensIA({ env: ENV, fetchImpl: sansUrl, maintenant: T })).toBeNull();
    const panne = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await liensIA({ env: ENV, fetchImpl: panne, maintenant: T })).toBeNull();
  });
});
