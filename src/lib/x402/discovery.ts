import { NextResponse, type NextRequest } from "next/server";
import {
  X402_CATALOG_PATH,
  X402_LLMS_PATH,
  X402_MANIFEST_PATH,
  X402_ROUTE_PATHS,
  X402_ROUTE_PRICES,
  X402_SERVICE_NAME,
  X402_SKILL_PATH,
  X402_SKILLS_INDEX_PATH,
  type X402Endpoint,
} from "./contract";

const DEFAULT_TESTNET_NETWORK = "eip155:84532";

export function getX402PublicBaseUrl(requestUrl?: string): string | null {
  const configured = process.env.X402_PUBLIC_BASE_URL?.trim();
  const enabledFallback =
    process.env.X402_ENABLED === "1" ? process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim() : undefined;
  const requestFallback = process.env.X402_ENABLED === "1" && requestUrl ? new URL(requestUrl).origin : undefined;
  const raw = configured || enabledFallback || requestFallback;
  if (!raw) return null;
  return normalizeHttpOrigin(raw);
}

export function getRequiredX402PublicBaseUrl(requestUrl?: string): string {
  const baseUrl = getX402PublicBaseUrl(requestUrl);
  if (!baseUrl) throw new Error("X402_PUBLIC_BASE_URL must be configured for x402 discovery");
  return baseUrl;
}

export function toX402PublicUrl(path: string, baseUrl: string): string {
  return new URL(path, baseUrl).toString();
}

export function buildX402Manifest(baseUrl: string) {
  const resources = (Object.keys(X402_ROUTE_PATHS) as X402Endpoint[]).map((endpoint) => {
    const routePath = X402_ROUTE_PATHS[endpoint];
    const url = toX402PublicUrl(routePath, baseUrl);
    return {
      method: "POST",
      path: url,
      url,
      routePath,
      price: X402_ROUTE_PRICES[endpoint],
      network: getDiscoveryNetwork(),
    };
  });

  return {
    x402Version: 2,
    serviceName: X402_SERVICE_NAME,
    status: "testnet",
    description: "Agent-first French company intelligence with public professional contacts, web and ecommerce signals.",
    discovery: {
      catalog: toX402PublicUrl(X402_CATALOG_PATH, baseUrl),
      skill: toX402PublicUrl(X402_SKILL_PATH, baseUrl),
      skillsIndex: toX402PublicUrl(X402_SKILLS_INDEX_PATH, baseUrl),
      llmsTxt: toX402PublicUrl(X402_LLMS_PATH, baseUrl),
    },
    resources,
    externallyIndexed: false,
  };
}

export function buildX402SkillsIndex(baseUrl: string) {
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "odh-market-intelligence",
        type: "skill-md",
        description:
          "Buy French company intelligence and public professional contacts through x402: inspect the free catalog, estimate a segment, then fetch bounded company pages.",
        url: toX402PublicUrl(X402_SKILL_PATH, baseUrl),
      },
    ],
  };
}

export function buildX402SkillMarkdown(baseUrl: string): string {
  const catalogUrl = toX402PublicUrl(X402_CATALOG_PATH, baseUrl);
  const estimateUrl = toX402PublicUrl(X402_ROUTE_PATHS.estimate, baseUrl);
  const companiesUrl = toX402PublicUrl(X402_ROUTE_PATHS.companies, baseUrl);

  return `---
name: odh-market-intelligence
description: Buy French company intelligence and public professional contacts through x402. Use when an agent needs to size a B2B segment, measure email or phone coverage, or fetch a bounded list of companies with web, ecommerce, financial and prospecting signals.
---

# ODH Market Intelligence

Use the canonical x402 origin \`${baseUrl}\`, even if this skill was discovered from another Veridian staging host. No API key or user account is required. Payment uses x402 v2 in USDC; let an x402-compatible HTTP client or wallet tool sign payment requests. Never ask a human to paste a private key into a prompt.

## Agent workflow

1. \`GET ${catalogUrl}\` for the live field catalog, operators, prices and limits. This call is free.
2. \`POST ${estimateUrl}\` first. Send a bounded filter object. The initial response is \`402\` with \`PAYMENT-REQUIRED\`; pass it to your x402 client, then retry with \`PAYMENT-SIGNATURE\`.
3. Inspect \`estimated_count\` and contact coverage. Refine broad filters before buying rows.
4. \`POST ${companiesUrl}\` with only the fields needed. Maximum \`page_size\` is 50 and maximum projected fields is 20.
5. Read \`PAYMENT-RESPONSE\` and keep it with the result as settlement evidence.

## Request examples

Estimate ecommerce companies in Rhone that publish an email:

\`\`\`json
{"filters":{"all":[{"field":"departement","op":"eq","value":"69"},{"field":"ecom_level","op":"eq","value":"boutique"},{"field":"email","op":"exists","value":true}]}}
\`\`\`

Fetch the first page with actionable fields:

\`\`\`json
{"filters":{"all":[{"field":"departement","op":"eq","value":"69"},{"field":"ecom_level","op":"eq","value":"boutique"}]},"fields":["siren","denomination","email","email_type","phone","web_domain","ecom_platform","prospect_score"],"sort":{"field":"prospect_score","dir":"desc"},"page":1,"page_size":50}
\`\`\`

## Rules

- Never invent a field or send SQL. The catalog is authoritative.
- \`email\` and \`phone\` may be returned, but can only be filtered with \`exists\`.
- Prefer \`estimate\` before \`companies\` to avoid paying for a bad segment.
- Treat a \`402\` as protocol discovery, not an error. Treat missing \`PAYMENT-REQUIRED\`, a mismatched network/price, or a missing \`PAYMENT-RESPONSE\` after success as a hard failure.
- The service does not currently expose paid asynchronous market-map jobs. Do not call or advertise them.
`;
}

export function buildX402LlmsTxt(baseUrl: string): string {
  return `# Veridian ODH Market Intelligence

Agent-first x402 v2 API for French company intelligence and public professional contacts.

Canonical x402 origin: ${baseUrl}

Start here:

- GET ${toX402PublicUrl(X402_CATALOG_PATH, baseUrl)} — free live schemas, operators, prices and limits.
- GET ${toX402PublicUrl(X402_SKILL_PATH, baseUrl)} — exact agent workflow and examples.
- GET ${toX402PublicUrl(X402_MANIFEST_PATH, baseUrl)} — compact service manifest.

Paid testnet resources:

- POST ${toX402PublicUrl(X402_ROUTE_PATHS.estimate, baseUrl)} — $0.003 USDC on Base Sepolia.
- POST ${toX402PublicUrl(X402_ROUTE_PATHS.companies, baseUrl)} — $0.01 USDC on Base Sepolia, at most 50 companies and 20 fields per call.

Call a paid route without PAYMENT-SIGNATURE to obtain its 402 and PAYMENT-REQUIRED metadata. Use an x402-compatible client to pay and retry. A successful paid response must include PAYMENT-RESPONSE.
`;
}

export function redirectDisabledX402ToCanonical(request: NextRequest, path: string): NextResponse | null {
  const canonical = process.env.X402_PUBLIC_BASE_URL?.trim();
  if (!canonical) return null;

  const baseUrl = normalizeHttpOrigin(canonical);
  if (!baseUrl) return null;

  const currentOrigin = new URL(request.url).origin;
  if (currentOrigin === baseUrl) return null;

  const target = new URL(path, baseUrl);
  target.search = new URL(request.url).search;
  return NextResponse.redirect(target, 307);
}

function getDiscoveryNetwork(): string {
  return process.env.X402_NETWORK || DEFAULT_TESTNET_NETWORK;
}

function normalizeHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
