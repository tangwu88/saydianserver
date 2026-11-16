import { describe, it, expect } from "vitest";
import { diagnosticSystem, diagnosticConnection, diagnosticRingSync, diagnosticUpload } from "./sync-diagnostic-display";
describe("first connection summary", () => {
  it("shows a real OS version and keeps missing old-client metadata unknown", () => {
    expect(diagnosticSystem({ platform: "android", osVersion: "12.0" })).toBe("Android 12.0");
    expect(diagnosticSystem({ platform: "ios", osMajor: 18 })).toBe("iOS 18");
    expect(diagnosticSystem({ platform: "android" })).toContain("版本未提供");
  });
  it("distinguishes connection success from unfinished or empty ring sync", () => {
    const connected = { connectionState: "ready", initializationState: "ready", stages: [{ stage: "connect", state: "ok" }] };
    expect(diagnosticConnection(connected)).toBe("正常"); expect(diagnosticRingSync(connected)).toBe("未开始");
    expect(diagnosticRingSync({ ...connected, stages: [{ stage: "read", state: "pending" }] })).toBe("同步未完成");
    expect(diagnosticRingSync({ ...connected, stages: [{ stage: "read", state: "empty" }] })).toBe("本次无记录");
    expect(diagnosticConnection({ ...connected, connectionState: "disconnected" })).toBe("连接已中断");
  });
  it("requires genuine read and save confirmation for normal ring sync", () => {
    expect(diagnosticRingSync({ stages: [{ stage: "read", state: "ok" }] })).toBe("待确认");
    expect(diagnosticRingSync({ stages: [{ stage: "read", state: "ok" }, { stage: "persist", state: "ok" }] })).toBe("正常");
    expect(diagnosticRingSync({ stages: [{ stage: "read", state: "partial" }, { stage: "persist", state: "ok" }] })).toBe("未完整同步");
    expect(diagnosticRingSync({ stages: [{ stage: "persist", state: "failed" }, { stage: "read", state: "ok" }] })).toBe("本机保存失败");
  });
  it("does not label an empty upload queue as a sent batch or a failure", () => {
    expect(diagnosticUpload({ stages: [{ stage: "upload", state: "empty" }] })).toBe("无需上传（队列为空）");
    expect(diagnosticUpload({ stages: [{ stage: "upload", state: "ok" }] })).toBe("已确认上传");
    expect(diagnosticUpload({ stages: [{ stage: "upload", state: "failed" }] })).toBe("上传失败");
  });
});
