export type AdminAction = "read" | "write" | "refund";
type Rule = { read: readonly string[]; write: readonly string[]; refund?: readonly string[] };
const view = ["READ_ONLY"];
const operations = ["COMMERCE_OPERATIONS"];
const customer = ["CUSTOMER_SERVICE"];
const finance = ["FINANCE"];
const app = ["APP_OPERATIONS"];
const health = ["HEALTH_AUDITOR"];
const content = ["CONTENT_EDITOR", "APP_OPERATIONS"];
const common = { read: [...operations, ...customer, ...finance, ...view], write: operations };

/** Shared UI hints and server resource authorization; route-specific guards may narrow these. */
export const adminResourcePermissions: Record<string, Rule> = {
  dashboard: { read: ["*"], write: [] }, auth: { read: ["*"], write: ["*"] },
  members: { read: [...app, ...customer, ...health, ...view], write: app },
  care: { read: [...app, ...customer, ...health, ...view], write: app },
  warnings: { read: [...app, ...customer, ...health, ...view], write: health },
  devices: { read: [...app, ...customer, ...health, ...view], write: app },
  "health-reports": { read: [...health, ...customer, ...view], write: health },
  "health-report-offers": { read: [...app, ...finance, ...health, ...view], write: finance },
  "commerce-products": common, "commerce-categories": common,
  "commerce-banners": { read: [...operations, ...view], write: operations },
  "commerce-business-configs": { read: [...operations, ...view], write: operations },
  "commerce-orders": { ...common, refund: finance },
  "commerce-after-sales": { ...common, write: [...operations, ...customer, ...finance], refund: finance },
  "commerce-reviews": { read: [...operations, ...customer, ...view], write: [...operations, ...customer] },
  "commerce-coupons": { read: [...operations, ...customer, ...view], write: operations },
  "commerce-employees": { read: [...operations, ...finance, ...view], write: operations },
  "commerce-commissions": { read: [...operations, ...finance, ...view], write: finance },
  "commerce-jobs": { read: [...operations, "INTEGRATION_ADMIN", ...view], write: [...operations, "INTEGRATION_ADMIN"] },
  payments: { read: [...operations, ...finance, ...view], write: finance, refund: finance },
  "provider-events": { read: finance, write: finance },
  "commerce-withdrawals": { read: finance, write: finance },
  commerce: { read: finance, write: finance },
  articles: { read: [...content, ...view], write: ["CONTENT_EDITOR"] },
  "article-categories": { read: [...content, ...view], write: ["CONTENT_EDITOR"] },
  "legal-documents": { read: [...content, ...view], write: ["CONTENT_EDITOR"] },
  feedback: { read: [...app, ...customer, ...view], write: [...app, ...customer] },
  notifications: { read: [...app, ...customer, ...view], write: app },
  "notification-campaigns": { read: [...app, ...view], write: app },
  settings: { read: [...app, ...view], write: app },
  integrations: { read: ["INTEGRATION_ADMIN", ...view], write: ["INTEGRATION_ADMIN"] },
  "admin-users": { read: [], write: [] },
  "account-deletions": { read: customer, write: app },
  "audit-logs": { read: [...health, ...view], write: [] },
  "api-docs": { read: ["*"], write: ["API_DOC_EDITOR"] },
};

export function canAdminResource(role: string | readonly string[], resource: string, action: AdminAction = "read"): boolean {
  const roles = typeof role === "string" ? [role] : role;
  if (!roles.length || roles.every((value) => !value)) return false;
  if (roles.includes("SUPER_ADMIN")) return true;
  const allowed = adminResourcePermissions[resource]?.[action] ?? [];
  return allowed.includes("*") || roles.some((value) => allowed.includes(value));
}
