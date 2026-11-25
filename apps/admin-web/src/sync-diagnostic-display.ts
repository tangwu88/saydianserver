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

export function diagnosticReadRows(evidence: any) {
  if (!Array.isArray(evidence?.metrics)) return [];
  const names: Record<string,string> = {steps:"步数",sleep:"睡眠",heart_rate:"心率",blood_oxygen:"血氧",hrv:"HRV",stress:"压力",body_temperature:"皮肤温度"};
  const states: Record<string,string> = {not_received:"尚无完成确认",partial:"未完整读取",complete:"范围已读完",no_data:"已明确返回空历史",failed:"读取失败"};
  return evidence.metrics.map((r: any) => ({...r, name:names[r.metric] ?? "其他指标", result:states[r.state] ?? "未提供",
    decoded:r.mappingObserved === true ? r.decodedRows : "未观察", mapped:r.mappingObserved === true ? r.mappedRecords : "未观察", filtered:r.mappingObserved === true ? r.filteredRecords : "未观察"}));
}
export function diagnosticClock(evidence: any): string {
  if (!evidence?.clock) return "未采集";
  const c = evidence.clock;
  const format = c.format === "confirmed" ? "已确认时间格式" : "时间格式未确认";
  const state = ({not_requested:"未请求校时",pending:"等待空闲发送",attempted:"已尝试发送",expired:"等待已过期"} as Record<string,string>)[c.submission] ?? "状态未知";
  return `${format}；${state}；未读回核验，发送不代表完成`;
}
export function diagnosticMonitoring(evidence: any): string {
  const label = (value: unknown) => value === true ? "开启" : value === false ? "关闭" : "未读取";
  return `心率：${label(evidence?.monitoring?.heartRate)}；血氧：${label(evidence?.monitoring?.bloodOxygen)}`;
}
