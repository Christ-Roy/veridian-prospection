#!/usr/bin/env node

const baseUrl = (process.env.ODH_X402_BASE_URL || process.argv[2] || "").replace(/\/$/, "");
if (!baseUrl) {
  console.error("Usage: ODH_X402_BASE_URL=https://... node scripts/x402/probe-agent.mjs");
  process.exit(2);
}

const expected = ["/api/x402/odh/estimate", "/api/x402/odh/companies"];

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

function decodeHeader(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("PAYMENT-REQUIRED is not valid base64url JSON");
  }
}

const manifest = await json("/.well-known/x402");
if (manifest.response.status !== 200) throw new Error(`manifest: HTTP ${manifest.response.status}`);
const manifestPaths = manifest.body.resources.map((resource) => resource.path).sort();
if (JSON.stringify(manifestPaths) !== JSON.stringify([...expected].sort())) {
  throw new Error(`manifest routes differ: ${manifestPaths.join(", ")}`);
}

const skill = await fetch(`${baseUrl}${manifest.body.discovery.skill}`);
if (!skill.ok || !(await skill.text()).includes("PAYMENT-REQUIRED")) {
  throw new Error("public skill is missing or does not explain the x402 handshake");
}

const catalog = await json("/api/x402/odh/catalog");
if (catalog.response.status !== 200) throw new Error(`catalog: HTTP ${catalog.response.status}`);
if (catalog.body.limits.page_size_max !== 50) throw new Error("catalog page limit drift");

const requests = [
  ["/api/x402/odh/estimate", { filters: { all: [{ field: "departement", op: "eq", value: "69" }] } }],
  ["/api/x402/odh/companies", { filters: { all: [{ field: "departement", op: "eq", value: "69" }] }, fields: ["siren", "denomination", "email", "phone", "web_domain"], page: 1, page_size: 5 }],
];

for (const [path, body] of requests) {
  const result = await json(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (result.response.status !== 402) throw new Error(`${path}: expected 402, got ${result.response.status}`);
  const header = result.response.headers.get("payment-required");
  if (!header) throw new Error(`${path}: PAYMENT-REQUIRED missing`);
  const requirements = decodeHeader(header);
  const advertised = requirements.accepts || requirements.paymentRequirements || [];
  if (!Array.isArray(advertised) || advertised.length === 0) throw new Error(`${path}: no payment requirements`);
  console.log(`OK ${path} -> 402, ${advertised.length} payment option(s)`);
}

console.log(`OK agent discovery at ${baseUrl}`);
