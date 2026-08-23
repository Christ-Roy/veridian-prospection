---
name: odh-market-intelligence
description: Buy French company intelligence and public professional contacts through x402. Use when an agent needs to size a B2B segment, measure email or phone coverage, or fetch a bounded list of companies with web, ecommerce, financial and prospecting signals.
---

# ODH Market Intelligence

Use the same origin from which this skill was fetched. No API key or user account is required. Payment uses x402 v2 in USDC; let an x402-compatible HTTP client or wallet tool sign payment requests. Never ask a human to paste a private key into a prompt.

## Agent workflow

1. `GET /api/x402/odh/catalog` for the live field catalog, operators, prices and limits. This call is free.
2. `POST /api/x402/odh/estimate` first. Send a bounded filter object. The initial response is `402` with `PAYMENT-REQUIRED`; pass it to your x402 client, then retry with `PAYMENT-SIGNATURE`.
3. Inspect `estimated_count` and contact coverage. Refine broad filters before buying rows.
4. `POST /api/x402/odh/companies` with only the fields needed. Maximum `page_size` is 50 and maximum projected fields is 20.
5. Read `PAYMENT-RESPONSE` and keep it with the result as settlement evidence.

## Request examples

Estimate ecommerce companies in Rhone that publish an email:

```json
{"filters":{"all":[{"field":"departement","op":"eq","value":"69"},{"field":"ecom_level","op":"eq","value":"boutique"},{"field":"email","op":"exists","value":true}]}}
```

Fetch the first page with actionable fields:

```json
{"filters":{"all":[{"field":"departement","op":"eq","value":"69"},{"field":"ecom_level","op":"eq","value":"boutique"}]},"fields":["siren","denomination","email","email_type","phone","web_domain","ecom_platform","prospect_score"],"sort":{"field":"prospect_score","dir":"desc"},"page":1,"page_size":50}
```

## Rules

- Never invent a field or send SQL. The catalog is authoritative.
- `email` and `phone` may be returned, but can only be filtered with `exists`.
- Prefer `estimate` before `companies` to avoid paying for a bad segment.
- Treat a `402` as protocol discovery, not an error. Treat missing `PAYMENT-REQUIRED`, a mismatched network/price, or a missing `PAYMENT-RESPONSE` after success as a hard failure.
- The service does not currently expose paid asynchronous market-map jobs. Do not call or advertise them.
