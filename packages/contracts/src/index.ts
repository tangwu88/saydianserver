export { adminResourcePermissions, canAdminResource, type AdminAction } from "./admin-permissions";

export const healthMetrics = [
  "sleep",
  "steps",
  "distance",
  "calories",
  "heart_rate",
  "blood_oxygen",
  "blood_pressure",
  "blood_glucose",
  "temperature",
  "hrv",
  "ecg",
  "body_composition",
  "blood_composition",
] as const;

export type HealthMetric = (typeof healthMetrics)[number];

export const careStatuses = [
  "pending",
  "active",
  "rejected",
  "revoked",
  "expired",
] as const;

export type CareStatus = (typeof careStatuses)[number];

export const adminRoles = [
  "SUPER_ADMIN",
  "APP_OPERATIONS",
  "COMMERCE_OPERATIONS",
  "FINANCE",
  "CONTENT_EDITOR",
  "CUSTOMER_SERVICE",
  "HEALTH_AUDITOR",
  "INTEGRATION_ADMIN",
  "API_DOC_EDITOR",
  "READ_ONLY",
] as const;

export type AdminRole = (typeof adminRoles)[number];

export const businessTypes = [
  "commerce_order",
  "health_report",
  "health_membership",
] as const;

export type BusinessType = (typeof businessTypes)[number];

export const paymentChannels = [
  "wechat_mini",
  "wechat_jsapi",
  "wechat_h5",
  "wechat_native",
  "wechat_app",
  "alipay_wap",
  "alipay_page",
  "alipay_app",
  "apple_iap",
] as const;

export type PaymentChannel = (typeof paymentChannels)[number];

export const paymentStatuses = [
  "created",
  "pending",
  "succeeded",
  "failed",
  "closed",
  "refunding",
  "partial_refunded",
  "refunded",
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];

export const reportStatuses = [
  "awaiting_payment",
  "queued",
  "generating",
  "ready",
  "failed",
  "revoked",
] as const;

export type ReportStatus = (typeof reportStatuses)[number];

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  timestamp: number;
  requestId: string;
}

export interface ValidationErrorData {
  errors: Record<string, string[]>;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SessionContract {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  member: MemberProfileContract;
}

export interface MemberProfileContract {
  id: string;
  legacyMemberId?: string;
  mobileMasked?: string;
  phoneMasked?: string;
  emailMasked?: string;
  locale?: string;
  nickname: string;
  avatarUrl?: string;
  gender?: "male" | "female" | "unspecified";
  birthday?: string;
  heightCm?: number;
  weightKg?: number;
}

export interface HealthRecordSourceContract {
  platform: "android" | "ios" | "harmony" | "mini_program" | "migration";
  deviceId?: string;
  model?: string;
  firmware?: string;
  origin?: "watch_history" | "app_measurement" | "remote_member" | "manual_entry" | "imported" | "unknown";
  measurementSource?: "wearable" | "manual" | "imported";
  rawVersion?: number;
}

export interface HealthRecordInputContract {
  id: string;
  metric: HealthMetric;
  observedAt: string;
  timezoneOffsetMinutes: number;
  values: Record<string, number | string | boolean | null>;
  unit?: string;
  quality?: "unknown" | "valid" | "suspect" | "invalid";
  source: HealthRecordSourceContract;
  ecgArtifact?: {
    sampleRateHz: number;
    sampleCount: number;
    sha256: string;
    uploadObjectKey: string;
  };
}

export interface HealthRecordRejectionContract {
  id: string;
  code: string;
  message: string;
}

export interface HealthBatchResultContract {
  acceptedIds: string[];
  rejected: HealthRecordRejectionContract[];
  nextCursor: string | null;
}

export interface HealthProfileContract {
  memberId: string;
  period: { from: string; to: string };
  dataCompleteness: {
    validRecordCount: number;
    distinctDays: number;
    metricCount: number;
  };
  metrics: Array<{
    metric: HealthMetric;
    recordCount: number;
    latestObservedAt: string;
    latestValue: number | null;
  }>;
  devices: Array<{
    id: string;
    model: string;
    displayName: string;
    firmware?: string;
    lastSeenAt?: string;
  }>;
  activeWarningCount: number;
  analysisConsent: {
    granted: boolean;
    availableVersion?: string | null;
    document?: { path: string; locale: string; version: string } | null;
    version: string | null;
    grantedAt: string | null;
    withdrawnAt: string | null;
  };
}

export interface HealthReportEligibilityContract {
  eligible: boolean;
  period: { from: string; to: string };
  validRecordCount: number;
  distinctDays: number;
  minimumDistinctDays: number;
  missing: string[];
  consentRequired: boolean;
  availableCredits: number;
}

export interface HealthReportContract {
  id: string;
  status: ReportStatus;
  period: { from: string; to: string };
  dataCompleteness: {
    validRecordCount: number;
    distinctDays: number;
  };
  freePreview: Record<string, unknown>;
  aiGenerated: boolean;
  aiLabel: string;
  generatedAt: string | null;
  createdAt: string;
}

export interface BillingOfferContract {
  id: string;
  code: string;
  title: string;
  description: string;
  entitlement: "single_report" | "membership";
  priceCents: number;
  currency: string;
  creditCount: number;
  durationDays: number | null;
  appleProductId: string | null;
  version: number;
}

export interface BillingEntitlementContract {
  availableReportCredits: number;
  activeMembership: {
    id: string;
    expiresAt: string;
    remainingCredits: number;
  } | null;
}

export interface PaymentIntentContract {
  id: string;
  paymentNo: string;
  businessType: BusinessType;
  businessId: string;
  channel: PaymentChannel;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  invoke: Record<string, unknown> | null;
  createdAt: string;
}

export interface CareRelationshipContract {
  id: string;
  invitationId: string;
  inviterMemberId: string;
  recipientMemberId: string;
  status: CareStatus;
  metrics: HealthMetric[];
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PushInstallationContract {
  installationId: string;
  provider: "jpush" | "apns" | "disabled";
  registrationId: string;
  platform: "android" | "ios" | "harmony";
  appVersion: string;
  buildNumber: string;
  locale?: string;
}

export interface NotificationContract {
  id: string;
  eventId: string;
  type: "care_invitation" | "health_warning" | "system";
  title: string;
  body: string;
  deepLink?: string;
  createdAt: string;
  readAt: string | null;
}

export interface SafePushPayloadContract {
  eventId: string;
  type: string;
  deepLink?: string;
}

export function buildSafePushPayload(input: {
  eventId: string;
  type: string;
  deepLink?: string | null;
}): SafePushPayloadContract {
  return {
    eventId: input.eventId,
    type: input.type,
    ...(input.deepLink ? { deepLink: input.deepLink } : {}),
  };
}

export interface DeviceBindingContract {
  id: string;
  hardwareKey: string;
  vendor: string;
  model: string;
  displayName: string;
  firmware?: string;
  capabilities: string[];
  syncCursor?: string;
  lastSeenAt?: string;
}

export interface LegacyOrderProjectionContract {
  id: string;
  legacyOrderId: string;
  orderNo: string;
  status: string;
  payableCents: number;
  createdAt: string;
  readOnly: true;
}

export function isHealthMetric(value: string): value is HealthMetric {
  return (healthMetrics as readonly string[]).includes(value);
}

export function isAdminRole(value: string): value is AdminRole {
  return (adminRoles as readonly string[]).includes(value);
}

export function isPaymentChannel(value: string): value is PaymentChannel {
  return (paymentChannels as readonly string[]).includes(value);
}

export function isBusinessType(value: string): value is BusinessType {
  return (businessTypes as readonly string[]).includes(value);
}

export { apiCatalog } from "./api-catalog.generated";
export * from "./download";
export * from "./cutover";
