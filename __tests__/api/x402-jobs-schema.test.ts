import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("migration 0032_add_x402_jobs", () => {
  const sql = read("prisma/migrations/0032_add_x402_jobs/migration.sql");
  const schema = read("prisma/schema.prisma");

  it("crée les quatre tables x402 durables", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "x402_buyers"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "x402_orders"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "x402_payments"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "x402_job_results"');
    expect(schema).toContain("model X402Buyer");
    expect(schema).toContain("model X402Order");
    expect(schema).toContain("model X402Payment");
    expect(schema).toContain("model X402JobResult");
  });

  it("verrouille idempotence client + payment identifier", () => {
    expect(sql).toContain('"client_idempotency_key"');
    expect(sql).toContain('"payment_identifier"');
    expect(sql).toContain("x402_orders_wallet_client_idempotency_key");
    expect(sql).toContain("x402_orders_payment_identifier_key");
  });

  it("encode les statuts longs et le hash payload SHA-256", () => {
    expect(sql).toContain("'queued','running','succeeded','failed','expired'");
    expect(sql).toContain('"payload"                  JSONB NOT NULL');
    expect(sql).toContain('"payload_hash"');
    expect(sql).toContain("^[0-9a-f]{64}$");
  });

  it("stocke les résultats via URI externe, jamais en blob inline", () => {
    expect(sql).toContain('"raw_result_uri"');
    expect(sql).toContain("'r2://%'");
    expect(sql).not.toMatch(/result_blob|raw_result_blob|BYTEA/i);
  });

  it("garde les coûts en unités entières bornées", () => {
    expect(sql).toContain('"cost_authorized_units"    BIGINT NOT NULL');
    expect(sql).toContain('"cost_settled_units"       BIGINT NOT NULL DEFAULT 0');
    expect(sql).toContain('"cost_settled_units" <= "cost_authorized_units"');
  });

  it("ne rend pas tenant/workspace/user obligatoires pour l'acheteur public", () => {
    expect(sql).toContain('"tenant_id"      UUID REFERENCES "tenants"("id") ON DELETE SET NULL');
    expect(sql).toContain('"tenant_id"                UUID REFERENCES "tenants"("id") ON DELETE SET NULL');
    expect(sql).toContain("x402_buyers_wallet_account_key");
  });
});
