import { sha256 } from "./crypto";

export function adminDeviceIdentifier(hardwareKey: string) {
  const shortKey = hardwareKey.slice(0, 16).toUpperCase();
  return `DEV-${shortKey.slice(0, 8)}-${shortKey.slice(8)}`;
}

export function legacyNativeDeviceKey(
  userId: string,
  hardwareKey: string,
  rawPayload: string,
): string | null {
  for (const field of ["deviceId", "hardwareId"]) {
    // Escaped/ambiguous identifiers are not interpreted as legacy aliases.
    const reportedId = rawPayload
      .match(new RegExp(`(?:^| \\| )${field}=([^\\\\|]*?)(?= \\| |$)`))?.[1]
      ?.trim();
    if (!reportedId || sha256(`${userId}:${reportedId}`) !== hardwareKey)
      continue;
    const nativeId = reportedId.match(/^(?:veepoo|yucheng|urion):(.+)$/)?.[1];
    if (nativeId) return sha256(`${userId}:${nativeId}`);
  }
  return null;
}
