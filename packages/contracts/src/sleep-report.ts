export const SLEEP_REPORT_TEMPLATE = "sleep-report-v1";
export const SLEEP_ANALYSIS_NOTICE = "say_ring_sleep_analysis";

/** Public progress is fixed text, never an upstream response or internal error. */
export function sleepReportProgress(
  status: string,
  attempts = 0,
  failureReason?: string | null,
): string | undefined {
  if (status.toLowerCase() === "queued")
    return attempts > 0
      ? "上次分析未完成，正在等待自动重试。"
      : "报告已排队，等待 AI 分析。";
  if (status.toLowerCase() === "generating")
    return "AI 正在分析，单次请求最长约 2 分钟。";
  if (status.toLowerCase() !== "failed") return undefined;
  if (failureReason === "sleep_ai:timeout")
    return "AI 分析超时，自动尝试已结束；可稍后手动重试。";
  if (failureReason === "sleep_ai:provider_rejected")
    return "AI 服务暂不可用，报告未生成；请稍后再试。";
  if (
    failureReason === "sleep_ai:truncated" ||
    failureReason === "sleep_ai:invalid_content"
  )
    return "AI 返回内容不完整或未通过校验，未生成评分；可稍后重试。";
  return "本次 AI 分析未完成，未生成评分；请稍后重试。";
}

/** The published sleep notice names this provider; a different recipient needs a new rollout. */
export function sleepAiProviderMatchesNotice(baseUrl: unknown): boolean {
  try {
    const url = new URL(String(baseUrl ?? ""));
    return (
      url.origin === "https://open.bigmodel.cn" &&
      url.pathname.replace(/\/$/, "") === "/api/paas/v4" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export interface SleepReportInput {
  sdkDate: string;
  timezone: string;
  sourceKey: string;
  totalSeconds: number;
  deepSeconds?: number;
  lightSeconds?: number;
  remSeconds?: number;
  awakeSeconds?: number;
  unknownSeconds?: number;
  notWornSeconds?: number;
  deviceScore?: number;
  wakeCount?: number;
  sessions: {
    kind: "night" | "nap" | "unknown";
    startAt: string;
    endAt: string;
    asleepSeconds: number;
  }[];
}

/** Strict aggregate-only upload: no photos, raw stages, account or hardware IDs. */
export function normalizeSleepReportInput(value: unknown): SleepReportInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("睡眠汇总格式无效");
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "sdkDate",
    "timezone",
    "sourceKey",
    "totalSeconds",
    "deepSeconds",
    "lightSeconds",
    "remSeconds",
    "awakeSeconds",
    "unknownSeconds",
    "notWornSeconds",
    "deviceScore",
    "wakeCount",
    "sessions",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new Error("睡眠汇总包含不支持的字段");
  const sdkDate = String(input.sdkDate ?? "");
  const day = new Date(`${sdkDate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(sdkDate) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== sdkDate ||
    day.getTime() > Date.now() + 86_400_000
  )
    throw new Error("睡眠日期无效");
  const timezone = String(input.timezone ?? "");
  const offset = /^([+-])(\d{2}):(\d{2})$/.exec(timezone);
  if (
    !offset ||
    Number(offset[2]) > 14 ||
    Number(offset[3]) > 59 ||
    (Number(offset[2]) === 14 && Number(offset[3]) !== 0)
  )
    throw new Error("睡眠时区无效");
  const sourceKey = String(input.sourceKey ?? "");
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw new Error("睡眠来源标识无效");
  const number = (key: string, max = 86_400): number => {
    const result = input[key];
    if (
      typeof result !== "number" ||
      !Number.isInteger(result) ||
      result < 0 ||
      result > max
    )
      throw new Error(`睡眠字段 ${key} 无效`);
    return result;
  };
  const result: SleepReportInput = {
    sdkDate,
    timezone,
    sourceKey,
    totalSeconds: number("totalSeconds"),
    sessions: [],
  };
  if (!result.totalSeconds) throw new Error("没有有效睡眠数据，不能生成评分");
  for (const key of [
    "deepSeconds",
    "lightSeconds",
    "remSeconds",
    "awakeSeconds",
    "unknownSeconds",
    "notWornSeconds",
    "deviceScore",
    "wakeCount",
  ] as const)
    if (input[key] !== undefined)
      result[key] = number(
        key,
        key === "deviceScore" ? 100 : key === "wakeCount" ? 1440 : 86_400,
      );
  const stages = [result.deepSeconds, result.lightSeconds, result.remSeconds];
  const stageTotal = stages.reduce<number>(
    (total, seconds) => total + (seconds ?? 0),
    0,
  );
  if (
    stageTotal > result.totalSeconds ||
    (stages.every((seconds) => seconds !== undefined) &&
      stageTotal !== result.totalSeconds)
  )
    throw new Error("有效睡眠与阶段合计不一致");
  const allSeconds =
    result.totalSeconds +
    (result.awakeSeconds ?? 0) +
    (result.unknownSeconds ?? 0) +
    (result.notWornSeconds ?? 0);
  if (allSeconds > 86_400) throw new Error("睡眠汇总超出一天");
  if (!Array.isArray(input.sessions) || input.sessions.length > 24)
    throw new Error("睡眠会话格式无效");
  const offsetMinutes =
    (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "-" ? -1 : 1);
  for (const value of input.sessions) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("睡眠会话无效");
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (key) => !["kind", "startAt", "endAt", "asleepSeconds"].includes(key),
      ) ||
      !["night", "nap", "unknown"].includes(String(row.kind))
    )
      throw new Error("睡眠会话字段无效");
    const instant = (field: string) => {
      if (typeof row[field] !== "string" || !/Z$/.test(row[field] as string))
        throw new Error("会话起止必须为 UTC 时间");
      const date = new Date(row[field] as string);
      if (!Number.isFinite(date.getTime())) throw new Error("会话时间无效");
      return date;
    };
    const start = instant("startAt"),
      end = instant("endAt");
    const seconds = row.asleepSeconds;
    const localStart = start.getTime() + offsetMinutes * 60_000;
    const localEnd = end.getTime() + offsetMinutes * 60_000;
    if (
      typeof seconds !== "number" ||
      !Number.isInteger(seconds) ||
      seconds < 0 ||
      seconds > (end.getTime() - start.getTime()) / 1000 ||
      end <= start ||
      end.getTime() - start.getTime() > 86_400_000 ||
      localStart < day.getTime() - 86_400_000 ||
      localEnd > day.getTime() + 2 * 86_400_000
    )
      throw new Error("会话时间或时长无效");
    result.sessions.push({
      kind: row.kind as "night" | "nap" | "unknown",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      asleepSeconds: seconds,
    });
  }
  result.sessions.sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (
    result.sessions.some(
      (row, index) =>
        index > 0 && row.startAt < result.sessions[index - 1]!.endAt,
    ) ||
    (result.sessions.length &&
      result.sessions.reduce((total, row) => total + row.asleepSeconds, 0) !==
        result.totalSeconds)
  )
    throw new Error("睡眠会话重叠或合计不一致");
  return result;
}

/** Shared stable representation; unknown fields remain absent, never zero-filled. */
export function canonicalSleepInput(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, sort(value)]),
          )
        : item;
  return JSON.stringify(sort(value));
}
