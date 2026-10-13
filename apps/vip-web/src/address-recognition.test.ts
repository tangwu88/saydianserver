import { describe, expect, it } from "vitest";
import { recognizeAddress } from "./address-recognition";
const base = {
  recipientName: "张三",
  recipientMobile: "13800138000",
  province: "广东省",
  city: "深圳市",
  district: "南山区",
  addressDetail: "科技园路8号2栋1201",
};
describe("pasted shipping address recognition", () => {
  it.each([
    "张三 13800138000 广东省深圳市南山区科技园路8号2栋1201",
    "张三，138-0013-8000，广东 深圳 南山区 科技园路8号2栋1201",
    "收货人：张三\n手机号：+86 138 0013 8000\n收货地址：广东省深圳市南山区科技园路8号2栋1201",
    "广东省深圳市南山区科技园路8号2栋1201 张三 13800138000",
    "张三13800138000深圳市南山区科技园路8号2栋1201",
    "姓名：张三，手机：１３８００１３８０００，所在地区：广东省深圳市南山区，详细地址：科技园路8号2栋1201",
  ])("extracts common sharing format: %s", (input) => {
    expect(recognizeAddress(input)).toMatchObject({
      fields: base,
      missing: [],
      error: "",
    });
  });
  it.each([
    [
      "李四 13900139000 北京市朝阳区望京街8号",
      "北京市",
      "北京市",
      "朝阳区",
      "望京街8号",
    ],
    [
      "李四 13900139000 上海浦东新区世纪大道1号",
      "上海市",
      "上海市",
      "浦东新区",
      "世纪大道1号",
    ],
    [
      "李四 13900139000 重庆市渝北区金开大道1号",
      "重庆市",
      "重庆市",
      "渝北区",
      "金开大道1号",
    ],
    [
      "李四 13900139000 广西南宁市青秀区民族大道1号",
      "广西壮族自治区",
      "南宁市",
      "青秀区",
      "民族大道1号",
    ],
    [
      "李四 13900139000 新疆乌鲁木齐市天山区幸福路1号",
      "新疆维吾尔自治区",
      "乌鲁木齐市",
      "天山区",
      "幸福路1号",
    ],
    [
      "李四 13900139000 吉林市昌邑区测试街1号",
      "吉林省",
      "吉林市",
      "昌邑区",
      "测试街1号",
    ],
    [
      "李四 13900139000 杭州市西湖区文三路1号",
      "浙江省",
      "杭州市",
      "西湖区",
      "文三路1号",
    ],
    [
      "李四 13900139000 苏州市昆山市玉山镇测试路1号",
      "江苏省",
      "苏州市",
      "昆山市",
      "玉山镇测试路1号",
    ],
  ])(
    "handles municipalities and omitted provinces: %s",
    (input, province, city, district, addressDetail) => {
      expect(recognizeAddress(input).fields).toMatchObject({
        province,
        city,
        district,
        addressDetail,
      });
    },
  );
  it("does not guess a province for an ambiguous county", () => {
    const r = recognizeAddress("张三 13800138000 朝阳区幸福路1号");
    expect(r.fields.province).toBe("");
    expect(r.missing).toContain("省份");
  });
  it("does not turn a street name into the province", () => {
    expect(
      recognizeAddress("张三 13800138000 深圳市南山区北京路8号").fields,
    ).toMatchObject({
      province: "广东省",
      city: "深圳市",
      addressDetail: "北京路8号",
    });
  });
  it("leaves contradictory province and city for manual correction", () => {
    expect(
      recognizeAddress("张三 13800138000 广东省杭州市西湖区文三路1号").missing,
    ).toContain("城市");
  });
  it("blocks multiple recipients and preserves room numbers", () => {
    expect(
      recognizeAddress("张三 13800138000 广东省深圳市南山区8号 李四13900139000")
        .error,
    ).toContain("多个");
    expect(
      recognizeAddress("张三 13800138000 深圳市南山区A座120138号").fields
        .addressDetail,
    ).toBe("A座120138号");
  });
  it("allows duplicate copies of the same phone", () => {
    expect(
      recognizeAddress(
        "张三 13800138000 深圳市南山区科技园路8号2栋1201 电话：13800138000",
      ).fields,
    ).toEqual(base);
  });
  it("supports a labeled landline", () => {
    expect(
      recognizeAddress(
        "收件人：李四\n联系电话：0755-12345678\n地址：广东省深圳市南山区测试路1号",
      ).fields.recipientMobile,
    ).toBe("075512345678");
  });
  it("does not invent masked or missing contact data", () => {
    const r = recognizeAddress("广东省深圳市南山区科技园路1号");
    expect(r.fields.recipientMobile).toBe("");
    expect(r.fields.recipientName).toBe("");
    expect(r.missing).toContain("联系电话");
  });
  it("rejects empty, unrecognized and overly long input", () => {
    expect(recognizeAddress("").error).toBeTruthy();
    expect(recognizeAddress("随机文字").recognized).toBe(false);
    expect(recognizeAddress("a".repeat(1001)).error).toBeTruthy();
  });
});
