---
name: odh-market-intelligence
description: Buy French company intelligence and public professional contacts through Veridian ODH x402. Use for B2B market sizing, contact coverage, company lists, ecommerce targeting, website-refit targeting, or agentic lead research.
---

# ODH Market Intelligence

This skill consumes the agent-first x402 v2 API. Use `ODH_X402_BASE_URL` when provided; otherwise use the origin that served the public skill. Never request or store a private wallet key yourself: delegate signing and payment to an x402-compatible HTTP client or wallet tool.

## Workflow

1. Read `GET /api/x402/odh/catalog`. It is free and authoritative for fields, operators, prices and limits.
2. Buy `POST /api/x402/odh/estimate` before rows. Use the returned market size and email/phone coverage to refine the segment.
3. Buy `POST /api/x402/odh/companies` with at most 20 requested fields and `page_size <= 50`.
4. Preserve the `PAYMENT-RESPONSE` header beside the JSON result as settlement evidence.

The first paid request returns `402` plus `PAYMENT-REQUIRED`. Pass that response to the x402 client, verify the advertised route/network/price, and retry with `PAYMENT-SIGNATURE`. Missing or inconsistent payment headers are failures, not successful calls.

## High-value example

Find ecommerce businesses in department 69 with public email coverage, then return the strongest prospects:

```json
{"filters":{"all":[{"field":"departement","op":"eq","value":"69"},{"field":"ecom_level","op":"eq","value":"boutique"},{"field":"email","op":"exists","value":true}]}}
```

```json
{"filters":{"all":[{"field":"departement","op":"eq","value":"69"},{"field":"ecom_level","op":"eq","value":"boutique"}]},"fields":["siren","denomination","email","email_type","phone","web_domain","ecom_platform","web_tier","prospect_score"],"sort":{"field":"prospect_score","dir":"desc"},"page":1,"page_size":50}
```

## Constraints

- No SQL and no invented fields; consume the live catalog.
- Contacts are public professional data. `email` and `phone` can be returned but are filterable only with `exists`.
- No asynchronous paid jobs are live yet. Do not call or advertise them.
