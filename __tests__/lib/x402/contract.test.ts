import { describe, expect, it } from "vitest";
import {
  X402_CATALOG_PATH,
  X402_LLMS_PATH,
  X402_MANIFEST_PATH,
  X402_ROUTE_PATHS,
  X402_ROUTE_PRICES,
  X402_SERVICE_NAME,
  X402_SKILL_PATH,
  X402_SKILLS_INDEX_PATH,
} from "@/lib/x402/contract";

describe("x402 contract constants", () => {
  it("X402_ROUTE_PATHS expose uniquement les deux routes ODH payantes publiées", () => {
    expect(X402_ROUTE_PATHS).toEqual({
      estimate: "/api/x402/odh/estimate",
      companies: "/api/x402/odh/companies",
    });
  });

  it("X402_ROUTE_PRICES garde les prix publics de la V1", () => {
    expect(X402_ROUTE_PRICES).toEqual({
      estimate: "$0.003",
      companies: "$0.01",
    });
  });

  it("X402_SERVICE_NAME identifie le produit agent-first", () => {
    expect(X402_SERVICE_NAME).toBe("Veridian ODH Market Intelligence");
  });

  it("X402_CATALOG_PATH pointe vers le catalogue vivant", () => {
    expect(X402_CATALOG_PATH).toBe("/api/x402/odh/catalog");
  });

  it("X402_MANIFEST_PATH pointe vers le manifeste well-known", () => {
    expect(X402_MANIFEST_PATH).toBe("/.well-known/x402");
  });

  it("X402_SKILLS_INDEX_PATH pointe vers l'index agent-skills", () => {
    expect(X402_SKILLS_INDEX_PATH).toBe("/.well-known/agent-skills/index.json");
  });

  it("X402_SKILL_PATH pointe vers le skill agent ODH", () => {
    expect(X402_SKILL_PATH).toBe("/.well-known/agent-skills/odh-market-intelligence/SKILL.md");
  });

  it("X402_LLMS_PATH pointe vers l'aide crawler/LLM", () => {
    expect(X402_LLMS_PATH).toBe("/llms.txt");
  });
});
