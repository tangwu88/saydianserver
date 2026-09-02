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
  "CONTENT_EDITOR",
  "CUSTOMER_SERVICE",
  "HEALTH_AUDITOR",
  "READ_ONLY",
] as const;

export type AdminRole = (typeof adminRoles)[number];

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
  nickname: string;
  avatarUrl?: string;
  gender?: "male" | "female" | "unspecified";
  birthday?: string;
  heightCm?: number;
  weightKg?: number;
}

export interface HealthRecordSourceContract {
  platform: "android" | "ios" | "mini_program" | "migration";
  deviceId?: string;
  model?: string;
  firmware?: string;
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
  platform: "android" | "ios";
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
