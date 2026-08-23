export type X402Endpoint = "estimate" | "companies";

export const X402_ROUTE_PATHS: Record<X402Endpoint, string> = {
  estimate: "/api/x402/odh/estimate",
  companies: "/api/x402/odh/companies",
};

export const X402_ROUTE_PRICES: Record<X402Endpoint, string> = {
  estimate: "$0.003",
  companies: "$0.01",
};

export const X402_CATALOG_PATH = "/api/x402/odh/catalog";
export const X402_MANIFEST_PATH = "/.well-known/x402";
export const X402_SKILLS_INDEX_PATH = "/.well-known/agent-skills/index.json";
export const X402_SKILL_PATH = "/.well-known/agent-skills/odh-market-intelligence/SKILL.md";
export const X402_LLMS_PATH = "/llms.txt";

export const X402_SERVICE_NAME = "Veridian ODH Market Intelligence";
