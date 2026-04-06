import { prisma, bigIntToNumber, tenantWhere, DEFAULT_ENTREPRISES_WHERE } from "./shared";
import type { Stats } from "../types";

export async function getStats(tenantId: string | null = null): Promise<Stats> {
  // Main counts from entreprises (excluding registrars + ca_suspect)
  const main = await prisma.$queryRawUnsafe<[{
    total: bigint;
    enriched: bigint;
    with_email: bigint;
    with_phone: bigint;
    with_dirigeant: bigint;
  }]>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN signal_count >= 2 THEN 1 ELSE 0 END) as enriched,
      SUM(CASE WHEN best_email_normalized IS NOT NULL THEN 1 ELSE 0 END) as with_email,
      SUM(CASE WHEN best_phone_e164 IS NOT NULL THEN 1 ELSE 0 END) as with_phone,
      SUM(CASE WHEN dirigeant_nom IS NOT NULL AND dirigeant_nom != '' THEN 1 ELSE 0 END) as with_dirigeant
    FROM entreprises e
    WHERE ${DEFAULT_ENTREPRISES_WHERE}
  `);

  const tw = tenantWhere("outreach", tenantId);
  const contactedResult = await prisma.$queryRawUnsafe<[{ c: bigint }]>(
    `SELECT COUNT(*) as c FROM outreach WHERE status != 'a_contacter' AND ${tw}`
  );

  return {
    total: bigIntToNumber(main[0].total),
    enriched: bigIntToNumber(main[0].enriched),
    with_email: bigIntToNumber(main[0].with_email),
    with_phone: bigIntToNumber(main[0].with_phone),
    with_dirigeant: bigIntToNumber(main[0].with_dirigeant),
    // Legacy fields (no more email_verification table) — kept for interface compat
    dirigeant_emails: bigIntToNumber(main[0].with_email),
    with_aliases: 0,
    contacted: bigIntToNumber(contactedResult[0].c),
  };
}
