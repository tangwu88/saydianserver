import type { Prisma } from "@prisma/client";
import type { HealthScoreRules } from "@saydian/app-contracts";
import { object } from "./aggregation";
export type ScreenActor = { type: "ADMIN" | "PARTNER"; id: string };
export class HealthScreenError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 403,
  ) {
    super(message);
  }
}
export async function screenEnabled(db: Prisma.TransactionClient) {
  return (
    object(
      (
        await db.appSetting.findUnique({
          where: { key: "member_health_screen" },
        })
      )?.value,
    ).enabled === true
  );
}
export async function authorizeScreen(
  db: Prisma.TransactionClient,
  actor: ScreenActor,
  userId: string,
  lock = false,
) {
  if (!(await screenEnabled(db)))
    throw new HealthScreenError("screen_disabled", "健康大屏尚未开放", 404);
  if (lock)
    await db.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR SHARE`;
  const member = await db.user.findUnique({
    where: { id: userId },
    include: { healthProfile: true },
  });
  if (!member || member.status !== "ACTIVE")
    throw new HealthScreenError(
      "member_unavailable",
      "会员不存在或当前不可用",
      404,
    );
  let bypass = false;
  if (actor.type === "ADMIN") {
    if (lock)
      await db.$queryRaw`SELECT id FROM "AdminUser" WHERE id=${actor.id}::uuid FOR SHARE`;
    const admin = await db.adminUser.findUnique({ where: { id: actor.id } }),
      roles = admin ? (admin.roles.length ? admin.roles : [admin.role]) : [];
    if (
      !admin?.active ||
      !roles.some((r) => r === "SUPER_ADMIN" || r === "HEALTH_AUDITOR")
    )
      throw new HealthScreenError("forbidden", "没有查看会员健康数据的权限");
    bypass = roles.includes("SUPER_ADMIN");
  } else {
    if (lock)
      await db.$queryRaw`SELECT p.id FROM "BrandPartner" p JOIN "PartnerLevel" l ON p."levelId"=l.id WHERE p.id=${actor.id}::uuid FOR SHARE OF p,l`;
    const partner = await db.brandPartner.findUnique({
      where: { id: actor.id },
      include: { level: true },
    });
    if (
      !partner?.active ||
      !partner.level.active ||
      partner.level.code !== "distribution-1" ||
      member.partnerId !== actor.id
    )
      throw new HealthScreenError(
        "forbidden",
        "仅战略伙伴可查看当前所属会员的健康资料",
      );
  }
  return { member, bypass };
}
export async function analysisConsent(
  db: Prisma.TransactionClient,
  userId: string,
  bypass: boolean,
  lock = false,
): Promise<string> {
  if (bypass) return "super-admin-audited-bypass-v1";
  if (lock)
    await db.$queryRaw`SELECT id FROM "HealthProfile" WHERE "userId"=${userId}::uuid FOR SHARE`;
  const [user, profile] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { locale: true } }),
    db.healthProfile.findUnique({ where: { userId } }),
  ]);
  if (!profile?.analysisConsentedAt || profile.analysisConsentWithdrawn)
    throw new HealthScreenError(
      "consent_required",
      "请由会员在 App 内同意当前健康 AI 分析说明",
    );
  const raw = (user?.locale || "en")
    .split(",")[0]!
    .split(";")[0]!
    .replace(/_/g, "-");
  const preferred = /^zh-(TW|HK|MO|Hant)/i.test(raw)
    ? "zh-Hant"
    : /^zh/i.test(raw)
      ? "zh-Hans"
      : raw.split("-")[0]!.toLowerCase();
  const locales = preferred === "en" ? ["en"] : [preferred, "en"];
  const documents = await db.globalLegalDocument.findMany({
    where: {
      documentType: "health_ai_analysis",
      locale: { in: locales },
      active: true,
      reviewed: true,
      publishedAt: { lte: new Date() },
    },
    orderBy: { publishedAt: "desc" },
  });
  const current = locales
    .map((l) => documents.find((d) => d.locale === l && d.contentHtml.trim()))
    .find(Boolean);
  if (!current || profile.analysisConsentVersion !== current.version)
    throw new HealthScreenError(
      "consent_required",
      "会员需阅读并同意最新健康 AI 分析说明",
    );
  return `${current.version}:${profile.analysisConsentedAt.toISOString()}`;
}
export const scoreKeys = [
  "heart_rate",
  "systolic",
  "diastolic",
  "blood_oxygen",
  "sleep_minutes",
  "steps",
  "distance",
  "calories",
  "temperature_skin",
  "temperature_estimated_body",
  "hrv_sdnn",
  "hrv_rmssd",
];
export function draftRules(): HealthScoreRules {
  return {
    title: "健康参考评分 · 待审核草稿",
    description:
      "仅作健康管理参考。请依据适用人群与测量方式填写区间和依据，预览审核后发布。",
    items: [
      ["heart_rate", "心率"],
      ["systolic", "收缩压"],
      ["diastolic", "舒张压"],
      ["blood_oxygen", "血氧"],
      ["sleep_minutes", "睡眠时长"],
      ["steps", "日步数"],
    ].map(([key, label]) => ({
      key: key!,
      label: label!,
      weight: 1,
      required: true,
      minDays: 3,
      minSamples: 3,
      minAge: 18,
      maxAge: null,
      gender: "ANY",
      allowedOrigins: ["watch_history", "app_measurement"],
      bands: [],
      basis: "",
      referenceUrl: "",
    })),
  };
}
export function validateRules(
  input: unknown,
  publishing = false,
): HealthScoreRules {
  const data = object(input);
  const fail = (message: string): never => {
    throw new HealthScreenError("invalid_rules", message, 400);
  };
  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    data.title.length > 120 ||
    typeof data.description !== "string" ||
    data.description.length > 2000 ||
    !Array.isArray(data.items) ||
    !data.items.length ||
    data.items.length > 20
  )
    fail("请填写规则名称、说明和1至20个评分指标");
  const keys = new Set<string>();
  const items: HealthScoreRules["items"] = data.items.map((raw: unknown) => {
    const r = object(raw);
    if (!scoreKeys.includes(r.key) || keys.has(r.key))
      fail("评分指标不支持或重复");
    keys.add(r.key);
    if (
      typeof r.label !== "string" ||
      !r.label.trim() ||
      r.label.length > 80 ||
      typeof r.required !== "boolean" ||
      !Number.isFinite(r.weight) ||
      r.weight < 0 ||
      r.weight > 100 ||
      !Number.isInteger(r.minDays) ||
      r.minDays < 1 ||
      r.minDays > 90 ||
      !Number.isInteger(r.minSamples) ||
      r.minSamples < 1 ||
      r.minSamples > 100000
    )
      fail("权重或数据覆盖门槛无效");
    for (const k of ["minAge", "maxAge"])
      if (r[k] !== null && (!Number.isInteger(r[k]) || r[k] < 0 || r[k] > 130))
        fail("适用年龄必须留空或填写0至130的整数");
    if (
      (r.minAge !== null && r.maxAge !== null && r.minAge > r.maxAge) ||
      !["ANY", "MALE", "FEMALE"].includes(r.gender)
    )
      fail("适用人群设置无效");
    if (
      !Array.isArray(r.allowedOrigins) ||
      !r.allowedOrigins.length ||
      r.allowedOrigins.some(
        (o: unknown) =>
          ![
            "watch_history",
            "app_measurement",
            "remote_member",
            "manual_entry",
            "imported",
          ].includes(String(o)),
      )
    )
      fail("请明确允许的测量来源");
    if (
      typeof r.basis !== "string" ||
      r.basis.length > 4000 ||
      typeof r.referenceUrl !== "string" ||
      r.referenceUrl.length > 1000
    )
      fail("评分依据无效");
    if (publishing) {
      if (r.basis.trim().length < 10) fail("发布前请填写各指标评分依据");
      try {
        const u = new URL(r.referenceUrl);
        if (u.protocol !== "https:" || u.username || u.password)
          fail("依据链接须为 HTTPS");
      } catch {
        fail("发布前请填写可追溯的 HTTPS 依据链接");
      }
    }
    if (
      !Array.isArray(r.bands) ||
      r.bands.length > 20 ||
      (publishing && !r.bands.length)
    )
      fail("发布前请填写评分区间");
    const bands = r.bands.map((rawBand: unknown, i: number) => {
      const b = object(rawBand);
      for (const k of ["min", "max"])
        if (b[k] !== null && !Number.isFinite(b[k]))
          fail("区间边界必须为数值或空");
      if (
        !Number.isFinite(b.score) ||
        b.score < 0 ||
        b.score > 100 ||
        (b.min !== null && b.max !== null && b.min >= b.max)
      )
        fail("分数应为0至100，区间下限须小于上限");
      if (i > 0) {
        const prev = r.bands[i - 1];
        if (b.min === null || prev.max === null || prev.max > b.min)
          fail("区间须升序且不能重叠");
      }
      return {
        min: b.min as number | null,
        max: b.max as number | null,
        score: b.score as number,
      };
    });
    return {
      key: r.key as string,
      label: r.label as string,
      weight: r.weight as number,
      required: r.required as boolean,
      minDays: r.minDays as number,
      minSamples: r.minSamples as number,
      minAge: r.minAge as number | null,
      maxAge: r.maxAge as number | null,
      gender: r.gender as "ANY" | "MALE" | "FEMALE",
      allowedOrigins: r.allowedOrigins as string[],
      bands,
      basis: r.basis as string,
      referenceUrl: r.referenceUrl as string,
    };
  });
  if (publishing && !items.some((r) => r.weight > 0))
    fail("总分至少需要一个有权重的指标");
  return { title: data.title.trim(), description: data.description, items };
}

/** China-site Qwen endpoints. Keep the existing configured Qwen endpoint usable;
 * also accept Alibaba's documented Beijing compatibility endpoint/workspaces.
 * Do not infer a provider from an arbitrary OpenAI-compatible URL. */
export function healthScreenQwenEndpoint(value: unknown): boolean {
  try {
    const u = new URL(String(value || ""));
    return (
      u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname.replace(/\/$/, "") === "/compatible-mode/v1" &&
      (["maas.qianwenaiapi.com", "dashscope.aliyuncs.com"].includes(
        u.hostname,
      ) ||
        /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(u.hostname))
    );
  } catch {
    return false;
  }
}
