#!/usr/bin/env node

const baseUrl = (process.env.ODH_X402_BASE_URL || process.argv[2] || "").replace(/\/$/, "");
if (!baseUrl) {
  console.error("Usage: ODH_X402_BASE_URL=https://... node scripts/x402/probe-agent.mjs");
  process.exit(2);
}

const expected = ["/api/x402/odh/estimate", "/api/x402/odh/companies"];

function absoluteUrl(pathOrUrl) {
  return new URL(pathOrUrl, `${baseUrl}/`).toString();
}

async function json(pathOrUrl, init) {
  const response = await fetch(absoluteUrl(pathOrUrl), init);
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
const manifestPaths = manifest.body.resources.map((resource) => new URL(resource.url || resource.path).pathname).sort();
if (JSON.stringify(manifestPaths) !== JSON.stringify([...expected].sort())) {
  throw new Error(`manifest routes differ: ${manifestPaths.join(", ")}`);
}

const skill = await fetch(absoluteUrl(manifest.body.discovery.skill));
if (!skill.ok || !(await skill.text()).includes("PAYMENT-REQUIRED")) {
  throw new Error("public skill is missing or does not explain the x402 handshake");
}

const catalog = await json(manifest.body.discovery.catalog);
if (catalog.response.status !== 200) throw new Error(`catalog: HTTP ${catalog.response.status}`);
if (catalog.body.limits.page_size_max !== 50) throw new Error("catalog page limit drift");

function manifestResource(path) {
  const resource = manifest.body.resources.find((item) => new URL(item.url || item.path, `${baseUrl}/`).pathname === path);
  if (!resource?.url && !resource?.path) throw new Error(`manifest missing resource ${path}`);
  return resource.url || resource.path;
}

const requests = [
  [manifestResource("/api/x402/odh/estimate"), { filters: { all: [{ field: "departement", op: "eq", value: "69" }] } }],
  [manifestResource("/api/x402/odh/companies"), { filters: { all: [{ field: "departement", op: "eq", value: "69" }] }, fields: ["siren", "denomination", "email", "phone", "web_domain"], page: 1, page_size: 5 }],
];

for (const [url, body] of requests) {
  const result = await json(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (result.response.status !== 402) throw new Error(`${url}: expected 402, got ${result.response.status}`);
  const header = result.response.headers.get("payment-required");
  if (!header) throw new Error(`${url}: PAYMENT-REQUIRED missing`);
  const requirements = decodeHeader(header);
  const advertised = requirements.accepts || requirements.paymentRequirements || [];
  if (!Array.isArray(advertised) || advertised.length === 0) throw new Error(`${url}: no payment requirements`);
  console.log(`OK ${url} -> 402, ${advertised.length} payment option(s)`);
}

console.log(`OK agent discovery at ${baseUrl}`);
