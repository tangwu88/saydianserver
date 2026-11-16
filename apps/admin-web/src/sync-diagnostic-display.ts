type Report = { platform?: string; osVersion?: string; osMajor?: number; connectionState?: string; initializationState?: string; stages?: Array<{ stage: string; state: string; code?: string }> };
const stage = (r: Report, key: string) => r.stages?.filter(s => s.stage === key).at(-1);
export function diagnosticSystem(r: Report): string {
  const name = ({ android: "Android", ios: "iOS", harmonyos: "鸿蒙" } as Record<string, string>)[r.platform ?? ""] ?? "系统未提供";
  const version = r.osVersion || (r.osMajor === undefined ? "" : String(r.osMajor));
  return version ? `${name} ${version}` : `${name}（版本未提供）`;
}
export function diagnosticConnection(r: Report): string {
  const observed = stage(r, "connect");
  if (observed?.state === "failed") return "连接失败";
  if (r.connectionState === "disconnected" || r.connectionState === "error") return observed?.state === "ok" ? "连接已中断" : "未连接";
  if (observed?.state === "ok") return "正常";
  return observed?.state === "pending" ? "连接未完成" : "待确认";
}
export function diagnosticRingSync(r: Report): string {
  const read = stage(r, "read"), saved = stage(r, "persist");
  if (!read) return r.initializationState && r.initializationState !== "ready" ? "设备准备中" : "未开始";
  if (saved?.state === "failed") return "本机保存失败";
  if (read.state === "failed") return "读取失败";
  if (read.state === "blocked") return read.code === "unsupported_metric" ? "未开放历史同步" : "同步待处理";
  if (read.state === "partial") return "未完整同步";
  if (read.state === "pending") return "同步未完成";
  if (read.state === "empty") return "本次无记录";
  if (read.state === "ok" && saved?.state === "ok") return "正常";
  return saved?.state === "pending" ? "保存待确认" : "待确认";
}
export function diagnosticUpload(r: Report): string {
  const uploaded = stage(r, "upload");
  if (!uploaded) return "未开始";
  return ({ pending: "上传待确认", ok: "已确认上传", partial: "部分未接收", failed: "上传失败", blocked: "暂不可上传", empty: "无需上传（队列为空）" } as Record<string, string>)[uploaded.state] ?? "待确认";
}
