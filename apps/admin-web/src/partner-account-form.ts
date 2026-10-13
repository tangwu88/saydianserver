export const partnerAccountFields = [
  "username",
  "name",
  "mobile",
  "levelId",
  "password",
] as const;
export type PartnerAccountField = (typeof partnerAccountFields)[number];

export function partnerAccountErrors(
  form: Record<string, unknown>,
  creating: boolean,
  levels: { id: string; active: boolean }[],
): Partial<Record<PartnerAccountField, string>> {
  const errors: Partial<Record<PartnerAccountField, string>> = {};
  if (
    creating &&
    !/^[A-Za-z0-9_.-]{3,80}$/.test(String(form.username ?? "").trim())
  )
    errors.username =
      "登录账号须为3至80个字符，仅支持字母、数字、下划线、点和短横线";
  const name = String(form.name ?? "").trim();
  if (!name || name.length > 80) errors.name = "请输入1至80个字符的伙伴名称";
  if (String(form.mobile ?? "").trim().length > 30)
    errors.mobile = "联系方式不能超过30个字符";
  if (!levels.some((level) => level.id === form.levelId && level.active))
    errors.levelId = "请选择有效的分销等级";
  const password = String(form.password ?? "");
  if (creating && (password.length < 10 || password.length > 128))
    errors.password = "密码须为10至128个字符";
  return errors;
}
