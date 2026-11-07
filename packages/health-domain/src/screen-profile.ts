import type { ScreenProfile, ScreenProfileField } from "@saydian/app-contracts";

type MemberProfileSource = {
  gender: ScreenProfile["gender"];
  birthday: Date | null;
  weightKg: unknown;
  heightCm?: unknown;
  healthProfile: { screenName?: string | null; timezone?: string } | null;
};
export function validScreenName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    value.trim().length <= 40 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/^\+?[\d\s-]{7,}$/.test(value.trim()) &&
    !value.includes("@")
  );
}
export function validScreenBirthday(
  value: unknown,
  today: string,
): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value > today
  )
    return false;
  const date = new Date(value + "T12:00:00Z");
  const oldest = new Date(today + "T12:00:00Z");
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 130);
  return (
    Number.isFinite(+date) &&
    date.toISOString().slice(0, 10) === value &&
    date >= oldest
  );
}
export function validScreenWeight(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.1 &&
    value <= 500 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-7
  );
}
export function readScreenProfile(member: MemberProfileSource, today: string) {
  const rawName = member.healthProfile?.screenName,
    birthday = member.birthday?.toISOString().slice(0, 10),
    weight = Number(member.weightKg);
  const profile: ScreenProfile = {
    name: validScreenName(rawName) ? rawName.trim() : "",
    gender: member.gender,
    heightCm: member.heightCm == null ? null : Number(member.heightCm),
    birthday: validScreenBirthday(birthday, today) ? birthday : null,
    weightKg: validScreenWeight(weight) ? weight : null,
  };
  const missing: ScreenProfileField[] = [];
  if (!profile.name) missing.push("name");
  if (profile.gender !== "MALE" && profile.gender !== "FEMALE")
    missing.push("gender");
  if (!profile.birthday) missing.push("birthday");
  if (profile.weightKg === null) missing.push("weightKg");
  return { profile, missing };
}
