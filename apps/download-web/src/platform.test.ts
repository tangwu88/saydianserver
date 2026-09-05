import { describe, expect, it } from "vitest";
import { detectVisitorPlatform, formatPackageSize } from "./platform";

describe("download page platform detection", () => {
  it.each([
    ["Mozilla/5.0 (Linux; Android 14)", "", 0, "android"],
    ["Mozilla/5.0 (Linux; HarmonyOS 4; NOH-AN00)", "", 0, "harmonyos"],
    ["Mozilla/5.0 (OpenHarmony; Mobile)", "", 0, "harmonyos"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "", 0, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 0, "desktop"],
  ])("detects %s", (userAgent, platform, touchPoints, expected) => {
    expect(detectVisitorPlatform(userAgent, platform, touchPoints)).toBe(
      expected,
    );
  });

  it("formats verified package sizes with decimal MB units", () => {
    expect(formatPackageSize(64_401_320)).toBe("64.4 MB");
    expect(formatPackageSize(8_595_228)).toBe("8.6 MB");
    expect(formatPackageSize(undefined)).toBe("—");
  });
});
