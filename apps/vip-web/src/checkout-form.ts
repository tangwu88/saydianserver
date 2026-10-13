export const addressFields = [
  "recipientName",
  "recipientMobile",
  "province",
  "city",
  "addressDetail",
] as const;
export function addressError(field: string, value: unknown) {
  const text = String(value ?? "").trim();
  const labels: Record<string, string> = {
    recipientName: "收货人",
    recipientMobile: "联系电话",
    province: "省份",
    city: "城市",
    addressDetail: "详细地址",
  };
  if (!text) return `请填写${labels[field] || field}`;
  if (field === "recipientMobile" && !/^\+?[0-9 ()-]{6,30}$/.test(text))
    return "请填写有效的联系电话";
  const max =
    field === "addressDetail" ? 300 : field === "recipientMobile" ? 30 : 80;
  return text.length > max ? `${labels[field]}过长` : "";
}
export function isDefiniteOrderFailure(status: number | undefined) {
  return [400, 404, 409, 422].includes(status ?? 0);
}
