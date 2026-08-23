import { NextResponse } from "next/server";
import { FIELD_CATALOG } from "@/lib/search/fields";
import {
  X402_COMPANY_PUBLIC_FIELDS,
  X402_EXISTS_ONLY_FILTER_FIELDS,
} from "@/lib/x402/public-fields";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.X402_ENABLED !== "1") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    service: "Veridian ODH Market Intelligence",
    protocol: "x402-v2",
    network: process.env.X402_NETWORK,
    recommended_flow: ["catalog", "estimate", "companies"],
    limits: { page_size_max: 50, fields_per_page_max: 20, exact_count_cap: 10_000 },
    endpoints: [
      { method: "POST", path: "/api/x402/odh/estimate", price: "$0.003", purpose: "size a segment and measure contact coverage" },
      { method: "POST", path: "/api/x402/odh/companies", price: "$0.01", purpose: "fetch a bounded page of companies and public professional contacts" },
    ],
    fields: X402_COMPANY_PUBLIC_FIELDS.map((name) => {
      const definition = FIELD_CATALOG[name];
      return {
        name,
        type: definition.type,
        label: definition.label,
        operators: X402_EXISTS_ONLY_FILTER_FIELDS.has(name) ? ["exists"] : definition.ops,
        ...(definition.enumValues ? { values: definition.enumValues } : {}),
      };
    }),
    skill: "/.well-known/agent-skills/odh-market-intelligence/SKILL.md",
    payment: {
      discovery: "Call a paid endpoint without PAYMENT-SIGNATURE and decode PAYMENT-REQUIRED from the 402 response.",
      request_header: "PAYMENT-SIGNATURE",
      response_header: "PAYMENT-RESPONSE",
    },
  });
}
