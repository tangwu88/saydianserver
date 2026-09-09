/** Only consulted by routes which already use UserAuthGuard. Public catalogue
 * and App login/health handlers do not gain a new guard from this predicate. */
export function requiresVerifiedCommerceMobile(requestPath: string): boolean {
  const path = requestPath.split("?")[0] ?? "";
  return /^\/api\/(?:saidian-mall\/v1|inv-shop\/v1|v1\/member\/address|v1\/pay)(?:\/|$)/i.test(path);
}
