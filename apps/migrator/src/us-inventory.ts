import { Client } from "pg";
import { writeFile } from "node:fs/promises";

export function internationalConsentSource(source: string): boolean {
  return /^(global_app_v2(?:_unverified|_password)?|global_h5_code):(?:en|zh-Hans|zh-Hant|de|fr|es|ja|ko)$/.test(source);
}
export function accountClassification(sources: string[]) {
  const international = sources.filter(internationalConsentSource);
  if (!international.length) return "unattributed";
  return sources.some(source => !internationalConsentSource(source)) ? "shared-review-required" : "international-candidate";
}

export async function inventory(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl, application_name: "saydian-us-readonly-inventory" });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const counts = await client.query(`SELECT count(*)::text AS users,
      pg_database_size(current_database())::text AS database_bytes FROM "User"`);
    const accounts = await client.query(`SELECT u.id, u."compatibilityId", u.status, u."createdAt",
      CASE WHEN u.email IS NOT NULL THEN left(u.email,1) || '***@' || split_part(u.email,'@',2)
           WHEN u.mobile IS NOT NULL THEN left(u.mobile,3) || '***' || right(u.mobile,2) ELSE '[no identifier]' END AS identifier,
      coalesce((SELECT jsonb_agg(DISTINCT c.source) FROM "ConsentRecord" c WHERE c."userId"=u.id),'[]'::jsonb) AS sources,
      (SELECT count(*)::text FROM "ConsentRecord" c WHERE c."userId"=u.id) AS consents,
      (SELECT count(*)::text FROM "DeviceBinding" d WHERE d."userId"=u.id) AS devices,
      (SELECT count(*)::text FROM "HealthRecord" h WHERE h."userId"=u.id) AS health,
      (SELECT count(*)::text FROM "FileObject" f WHERE f."ownerUserId"=u.id) AS files,
      (SELECT coalesce(sum(f."byteSize"),0)::text FROM "FileObject" f WHERE f."ownerUserId"=u.id) AS file_bytes,
      (SELECT count(*)::text FROM "HealthMembership" m WHERE m."userId"=u.id) AS memberships,
      (SELECT count(*)::text FROM "ReportCreditLedger" l WHERE l."userId"=u.id) AS credit_entries,
      (SELECT count(*)::text FROM "CommerceOrder" o WHERE o."userId"=u.id) AS orders,
      (SELECT count(*)::text FROM "CareRelationship" r WHERE r."inviterId"=u.id OR r."recipientId"=u.id) AS care_relationships
      FROM "User" u WHERE EXISTS(SELECT 1 FROM "ConsentRecord" c WHERE c."userId"=u.id AND c.source ~ '^global_(app_v2|h5_code)')
      ORDER BY u."createdAt", u.id`);
    const result = {
      schemaVersion: 1, capturedAt: new Date().toISOString(), sourceSite: "cn", targetSite: "us",
      readOnly: true, counts: counts.rows[0],
      warning: "Consent sources select candidates only. Health/device rows have no product discriminator; mixed usage and associated entitlements/files require review. No migration is authorized by this inventory.",
      accounts: accounts.rows.map(row => ({ ...row, classification: accountClassification(row.sources), approved: false })),
    };
    await client.query("COMMIT");
    return result;
  } finally {
    await client.end();
  }
}
if (require.main === module) {
  const url = process.env.US_MIGRATION_SOURCE_DATABASE_URL;
  const output = process.argv[2];
  if (!url || !output) throw Error("Use US_MIGRATION_SOURCE_DATABASE_URL and a private output path; never pass database credentials on the command line");
  inventory(url).then(async result => {
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ output, candidates: result.accounts.length, readOnly: true }));
  }).catch(() => { console.error("Read-only inventory failed; no accounts were exported or changed. Check private connection configuration."); process.exitCode = 1; });
}
