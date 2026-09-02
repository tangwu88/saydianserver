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
}

export interface MigrationMap {
  sourceLabel: string;
  member: TableColumnMap;
  healthSources: HealthSourceMap[];
}

export async function loadMigrationMap(): Promise<MigrationMap> {
  const path = resolve(
    process.env.MIGRATION_MAP_PATH?.trim() || "migration-map.json",
  );
  const parsed = JSON.parse(await readFile(path, "utf8")) as MigrationMap;
  assertIdentifier(parsed.member.table);
  for (const value of Object.values(parsed.member)) {
    if (value) assertIdentifier(value);
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
