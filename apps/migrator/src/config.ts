import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface TableColumnMap {
  table: string;
  id: string;
  idType?: "number" | "string";
  mobile: string;
  unionId?: string;
  passwordHash: string;
  nickname: string;
  avatar?: string;
  gender?: string;
  birthday?: string;
  height?: string;
  weight?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  status?: string;
  activeStatusValue?: string;
  pointBalance?: string;
  pointBalanceUnit?: "cents" | "yuan";
}

export interface HealthSourceMap {
  table: string;
  id: string;
  idType?: "number" | "string";
  memberId: string;
  metric: string;
  observedAt: string;
  valuesJson: string;
  timezoneOffsetMinutes?: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface VerifiedSessionSource {
  table: string;
  id: string;
  memberId: string;
  token: string;
  expiresAt: string;
  expiryFormat: "iso" | "unix_seconds";
  revokedAt?: string;
  verificationEvidence: string;
}

export interface MigrationMap {
  sourceLabel: string;
  sourceSystem?: string;
  sourceSnapshotId?: string;
  member: TableColumnMap;
  healthSources: HealthSourceMap[];
  sessions?: VerifiedSessionSource;
}

export async function loadMigrationMap(): Promise<MigrationMap> {
  const path = resolve(
    process.env.MIGRATION_MAP_PATH?.trim() || "migration-map.json",
  );
  const parsed = JSON.parse(await readFile(path, "utf8")) as MigrationMap;
  assertIdentifier(parsed.member.table);
  for (const [key, value] of Object.entries(parsed.member)) {
    if (value && !["activeStatusValue", "pointBalanceUnit"].includes(key)) assertIdentifier(value);
  }
  if (parsed.sourceSystem) assertIdentifier(parsed.sourceSystem);
  if (parsed.sessions) {
    for (const [key, value] of Object.entries(parsed.sessions)) {
      if (value && !["expiryFormat", "verificationEvidence"].includes(key)) assertIdentifier(value);
    }
    if (!["iso", "unix_seconds"].includes(parsed.sessions.expiryFormat) || !parsed.sessions.verificationEvidence?.trim()) {
      throw new Error("Session import requires a reviewed source schema and explicit expiry format");
    }
  }
  if (parsed.member.pointBalance && !["cents", "yuan"].includes(parsed.member.pointBalanceUnit ?? "")) {
    throw new Error("Point balance import requires an explicit source amount unit");
  }
  if (parsed.member.status && parsed.member.activeStatusValue === undefined) {
    throw new Error("Member status import requires an explicit active status value");
  }
  for (const source of parsed.healthSources) {
    for (const value of Object.values(source)) {
      if (value) assertIdentifier(value);
    }
  }
  return parsed;
}

export function assertIdentifier(value: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe table or column identifier: ${value}`);
  }
}
