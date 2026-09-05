type IntegrationHealthClient = {
  integrationConfig: {
    updateMany(input: {
      where: { key: string };
      data: { lastCheckedAt: Date; lastError: null };
    }): Promise<unknown>;
  };
};

export async function markIntegrationVerified(
  prisma: IntegrationHealthClient,
  key: string,
): Promise<void> {
  try {
    await prisma.integrationConfig.updateMany({
      where: { key },
      data: { lastCheckedAt: new Date(), lastError: null },
    });
  } catch {
    // Verification metadata must never turn an already successful provider
    // operation into a user-visible failure. The next successful call retries.
  }
}
