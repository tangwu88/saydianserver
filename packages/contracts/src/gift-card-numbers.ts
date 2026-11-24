/** Management numbers shown as serialNo; never redemption card numbers or secrets. */
export function parseGiftCardNumbers(input: unknown): number[] {
  const invalid = () =>
    new Error(
      "请输入有效的礼品卡编号（1至2147483647的整数），用换行、逗号或空格分隔",
    );
  let parts: unknown[];
  if (typeof input === "string" && input.length <= 10_000)
    parts = input
      .trim()
      .split(/[\s,，;；、]+/u)
      .filter(Boolean);
  else if (Array.isArray(input) && input.length <= 1000) parts = input;
  else throw invalid();
  if (!parts.length) throw invalid();
  const numbers = new Set<number>();
  for (const part of parts) {
    if (typeof part !== "string" && typeof part !== "number") throw invalid();
    const text = String(part).trim();
    if (!/^\d+$/.test(text)) throw invalid();
    const number = Number(text);
    if (!Number.isInteger(number) || number < 1 || number > 2_147_483_647)
      throw invalid();
    numbers.add(number);
    if (numbers.size > 100)
      throw new Error("每次最多处理100个不同编号，请分批操作");
  }
  return [...numbers];
}
