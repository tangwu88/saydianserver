import { Prisma } from "@prisma/client";
import type { PrismaService } from "../common/prisma.service";
export function internationalConsentSource(source: string): boolean {
  return /^(global_app_v2(?:_unverified|_password)?|global_h5_code):(?:en|zh-Hans|zh-Hant|de|fr|es|ja|ko)$/.test(source);
}
export function accountClassification(sources: string[]) {
  const international = sources.filter(internationalConsentSource);
  if (!international.length) return "unattributed";
  return sources.some(source => !internationalConsentSource(source)) ? "shared-review-required" : "international-candidate";
}


export async function usCandidateInventory(prisma: PrismaService, page: number) {
  const offset=(Math.max(1, Math.min(10000, Math.floor(page)||1))-1)*100;
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
    const [counts] = await tx.$queryRawUnsafe<Array<{users:string; database_bytes:string; candidates:string}>>(`SELECT count(*)::text AS users,
      pg_database_size(current_database())::text AS database_bytes,
      (SELECT count(DISTINCT c."userId")::text FROM "ConsentRecord" c WHERE c.source ~ '^global_(app_v2|h5_code)') AS candidates FROM "User"`);
    const rows = await tx.$queryRawUnsafe<Array<Record<string,unknown> & { sources:string[] }>>(`SELECT u.id, u."compatibilityId", u.status, u."createdAt",
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
      ORDER BY u."createdAt", u.id LIMIT 100 OFFSET ${offset}`);
    return { schemaVersion:1, capturedAt:new Date().toISOString(), counts, page:offset/100+1, pageSize:100,
      warning:"Protocol sources identify candidates only; health/device data has no product discriminator. Shared accounts, entitlements and files need review. No export/import or approval occurs here.",
      accounts:rows.map(row=>({...row, classification:accountClassification(row.sources), approved:false})) };
  }, { isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead, timeout:60000 });
}
