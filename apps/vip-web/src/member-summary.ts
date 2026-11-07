export type MemberSummary = {
  id: string;
  nickname?: string | null;
  memberNo?: string | number | null;
  avatarUrl?: string | null;
  gender?: string | null;
  birthday?: string | null;
  heightCm?: string | number | null;
  weightKg?: string | number | null;
  mobile?: string | null;
  email?: string | null;
  createdAt?: string | null;
  _count?: { devices?: number; healthRecords?: number };
};
export const memberName = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "未填写昵称";
export const memberInitial = (value: unknown) =>
  Array.from(
    memberName(value) === "未填写昵称" ? "会员" : memberName(value),
  )[0];
export function memberGender(value: unknown) {
  return (
    ({ MALE: "男", FEMALE: "女" } as Record<string, string>)[
      String(value || "").toUpperCase()
    ] || "未填写"
  );
}
export function memberAge(value: unknown, now = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    return "未填写";
  const birthday = value.slice(0, 10),
    parsed = new Date(`${birthday}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== birthday ||
    !Number.isFinite(now.getTime())
  )
    return "未填写";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  const [year, month, day] = birthday.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const age =
    part("year") -
    year -
    (part("month") < month || (part("month") === month && part("day") < day)
      ? 1
      : 0);
  return age >= 0 &&
    age <= 130 &&
    birthday <=
      `${part("year")}-${String(part("month")).padStart(2, "0")}-${String(part("day")).padStart(2, "0")}`
    ? `${age} 岁`
    : "未填写";
}
export function memberMeasurement(value: unknown, unit: "cm" | "kg") {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^\d+(?:\.\d+)?$/.test(String(value).trim())
  )
    return "未填写";
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${number} ${unit}` : "未填写";
}
export const memberCount = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : "—";
