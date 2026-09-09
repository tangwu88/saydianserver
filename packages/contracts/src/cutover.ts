type Environment = Record<string, string | undefined>;

export function cutoverFlag(value: string | undefined): boolean {
  return ["true", "1", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

export function businessWritesPaused(environment: Environment): boolean {
  return cutoverFlag(environment.MAINTENANCE_READ_ONLY) || cutoverFlag(environment.BUSINESS_WRITES_PAUSED);
}

export function shouldPauseWorkers(environment: Environment): boolean {
  return businessWritesPaused(environment) || cutoverFlag(environment.WORKER_OUTBOUND_PAUSED);
}

export function shouldDeferCallbacks(environment: Environment): boolean {
  return businessWritesPaused(environment) || cutoverFlag(environment.CALLBACK_PROCESSING_PAUSED);
}

// Only these handlers verify the provider signature and persist a durable inbox
// before acknowledging. Never exempt arbitrary webhook-looking paths.
export const verifiedCallbackPaths = new Set([
  "/api/saydian-app/v2/billing/payments/wechat/notify",
  "/api/saydian-app/v2/billing/payments/wechat/refund-notify",
  "/api/saydian-app/v2/billing/payments/alipay/notify",
  "/api/saydian-app/v2/billing/apple/notifications",
]);
