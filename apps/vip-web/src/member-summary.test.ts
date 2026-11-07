import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import ElementPlus from "element-plus";
import MemberListCard from "./components/MemberListCard.vue";
import {
  memberAge,
  memberCount,
  memberGender,
  memberMeasurement,
} from "./member-summary";

const member = {
  id: "synthetic-member",
  memberNo: "271",
  nickname: "本地合成会员",
  gender: "FEMALE",
  birthday: "1996-05-20T00:00:00.000Z",
  heightCm: "165.50",
  weightKg: 56.2,
  mobile: "+8613812345678",
  email: "synthetic@example.invalid",
  createdAt: "2026-11-07T05:00:00Z",
  _count: { devices: 0, healthRecords: 12 },
};
async function render(
  canViewHealth: boolean,
  showHealthScreen = true,
  row = member,
) {
  return renderToString(
    createSSRApp(MemberListCard, {
      member: row,
      canViewHealth,
      showHealthScreen,
    }).use(ElementPlus),
  );
}
describe("member list summary", () => {
  it("shows both contact fields and core demographics directly without opening details", async () => {
    const html = await render(true);
    for (const text of [
      member.nickname,
      member.memberNo,
      member.mobile,
      member.email,
      "165.5 cm",
      "56.2 kg",
      "性别",
      "年龄",
      "查看档案",
      "健康大屏",
      "健康记录",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("1996-05-20");
  });
  it("hides age, body measurements, health counts and health actions for ordinary tiers", async () => {
    const html = await render(false);
    for (const text of [
      "年龄",
      "身高",
      "体重",
      "健康记录",
      "健康大屏",
      "165.5",
      "56.2",
    ])
      expect(html).not.toContain(text);
    expect(html).toContain("查看资料");
    expect(html).toContain(member.email);
  });
  it("keeps the health screen hidden when unavailable, even for a strategic partner", async () => {
    expect(await render(true, false)).not.toContain("健康大屏");
  });
  it("computes completed birthdays using the China calendar and handles leap days", () => {
    const now = new Date("2026-11-07T05:00:00Z");
    expect(memberAge("2000-11-07", now)).toBe("26 岁");
    expect(memberAge("2000-11-08", now)).toBe("25 岁");
    expect(memberAge("2024-02-29", new Date("2025-02-28T12:00:00Z"))).toBe(
      "0 岁",
    );
    expect(memberAge("2000-11-08", new Date("2026-11-07T17:00:00Z"))).toBe(
      "26 岁",
    );
    for (const value of [null, "", "2026-11-08", "2025-02-30", "not-a-date"])
      expect(memberAge(value, now)).toBe("未填写");
  });
  it("preserves real zero counts but never invents zero height, weight or missing counts", () => {
    for (const value of [null, undefined, "", 0, "0", false, NaN, "invalid"])
      expect(memberMeasurement(value, "cm")).toBe("未填写");
    expect(memberMeasurement("170.50", "cm")).toBe("170.5 cm");
    expect(memberMeasurement("60.20", "kg")).toBe("60.2 kg");
    expect(memberCount(0)).toBe("0");
    expect(memberCount(null)).toBe("—");
    expect(memberCount(-1)).toBe("—");
    expect(memberGender("male")).toBe("男");
    expect(memberGender(null)).toBe("未填写");
  });
});
