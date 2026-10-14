const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function usMigrationStatus(userId: string, value: unknown, site = process.env.DEPLOYMENT_SITE) {
  const absent = { completed: false } as const;
  if (site !== "us" || !uuid.test(userId) || !value || typeof value !== "object") return absent;
  const proof = value as Record<string, unknown>;
  if (proof.schemaVersion !== 1 || proof.completed !== true ||
      proof.sourceOrigin !== "https://app.saydian.cn" || proof.targetOrigin !== "https://app.saydian.com" ||
      proof.sourceAccountId !== userId || proof.targetAccountId !== userId ||
      typeof proof.batchId !== "string" || !uuid.test(proof.batchId) ||
      typeof proof.verifiedAt !== "string" || !Number.isFinite(Date.parse(proof.verifiedAt))) return absent;
  return { schemaVersion: 1, completed: true, batchId: proof.batchId,
    sourceOrigin: proof.sourceOrigin, targetOrigin: proof.targetOrigin,
    sourceAccountId: userId, targetAccountId: userId, verifiedAt: proof.verifiedAt };
}
