import { BadRequestException } from "@nestjs/common";
const dayMs = 86_400_000;
const chinaOffset = 8 * 60 * 60_000;
export type EmployeeDashboardQuery = { range?: string; from?: string; to?: string; page?: string | number; pageSize?: string | number };
export function employeeDashboardQuery(input: EmployeeDashboardQuery = {}, now = new Date()) {
  const page = positive(input.page, 1, 1_000_000), pageSize = positive(input.pageSize, 20, 100);
  const range = input.range || (input.from || input.to ? "custom" : "month");
  const today = new Date(Math.floor((now.valueOf() + chinaOffset) / dayMs) * dayMs - chinaOffset);
  let start: Date, end: Date;
  if (range === "custom") {
    if (!input.from || !input.to) throw new BadRequestException("自定义时间需要开始和结束日期");
    start = parsedDate(input.from, false); end = parsedDate(input.to, true);
  } else {
    if (input.from || input.to) throw new BadRequestException("快捷范围不能同时传入自定义日期");
    if (!["today", "7d", "30d", "month"].includes(range)) throw new BadRequestException("查询范围无效");
    const chinaNow = new Date(now.valueOf() + chinaOffset);
    start = range === "month"
      ? new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffset)
      : new Date(today.valueOf() - (range === "7d" ? 6 : range === "30d" ? 29 : 0) * dayMs);
    end = new Date(today.valueOf() + dayMs);
  }
  if (start >= end || end.valueOf() - start.valueOf() > 366 * dayMs) throw new BadRequestException("查询范围须为有效日期且不超过366天");
  return { range, start, end, page, pageSize, skip: (page - 1) * pageSize, timezone: "Asia/Shanghai" };
}
function positive(value: unknown, fallback: number, maximum: number) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new BadRequestException("分页参数无效");
  return number;
}
function parsedDate(value: string, upper: boolean) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new BadRequestException("日期须含明确时区");
  const date = new Date(dateOnly ? value + "T00:00:00+08:00" : value);
  if (!Number.isFinite(date.valueOf()) || (dateOnly && new Date(date.valueOf() + chinaOffset).toISOString().slice(0, 10) !== value)) throw new BadRequestException("查询日期无效");
  return new Date(date.valueOf() + (dateOnly && upper ? dayMs : 0));
}
