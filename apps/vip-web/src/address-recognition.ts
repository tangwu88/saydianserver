import { areaList } from "@vant/area-data";

type Area = { code: string; name: string; aliases: string[] };
type Match = { area: Area; index: number; end: number };
export type RecognizedAddress = {
  recipientName: string;
  recipientMobile: string;
  province: string;
  city: string;
  district: string;
  addressDetail: string;
};
const municipalities = new Set(["11", "12", "31", "50"]);
const provinceShort: Record<string, string> = {
  内蒙古自治区: "内蒙古",
  广西壮族自治区: "广西",
  西藏自治区: "西藏",
  宁夏回族自治区: "宁夏",
  新疆维吾尔自治区: "新疆",
};
const provinces: Area[] = Object.entries(areaList.province_list)
  .filter(([code]) => Number(code) < 710000)
  .map(([code, name]) => ({
    code,
    name,
    aliases: [name, provinceShort[name] || name.replace(/[省市]$/, "")],
  }));
const cities: Area[] = Object.entries(areaList.city_list)
  .filter(
    ([code, name]) =>
      Number(code) < 710000 && !/^(市辖区|县|.*直辖县级行政区划)$/.test(name),
  )
  .map(([code, name]) => ({
    code,
    name,
    aliases: [name, name.replace(/(市|地区|盟)$/, "")],
  }));
const districts: Area[] = Object.entries(areaList.county_list)
  .filter(([code]) => Number(code) < 710000)
  .map(([code, name]) => ({ code, name, aliases: [name] }));
const trim = (value: string) =>
  value.replace(/^[\s,，;；:：、|]+|[\s,，;；:：、|]+$/g, "");
const nameLike = (value: string) =>
  /^[\p{Script=Han}·]{2,12}$|^[A-Za-z][A-Za-z .'-]{1,39}$/u.test(value) &&
  !/[省市区县街路巷镇村楼栋号室园苑]$/.test(value);

// Exact administrative names take precedence. An ambiguous county stays blank.
function matchArea(value: string, rows: Area[], from = 0): Match | undefined {
  const matches: Match[] = [];
  for (const area of rows)
    for (const alias of new Set(area.aliases)) {
      if (alias.length < 2) continue;
      const index = value.indexOf(alias, from);
      if (index < 0) continue;
      const next = value[index + alias.length] || "";
      if (alias !== area.name && /[省市区县路街巷镇村]/.test(next)) continue;
      // Do not infer a destination from a road bearing a city's full name.
      if (/[路街巷]/.test(next)) continue;
      matches.push({ area, index, end: index + alias.length });
    }
  matches.sort((a, b) => a.index - b.index || b.end - a.end);
  const first = matches[0];
  if (
    !first ||
    matches.some(
      (m) =>
        m.index === first.index &&
        m.end === first.end &&
        m.area.code !== first.area.code,
    )
  )
    return;
  return first;
}

/** Parse on the device; pasted addresses are never sent to an external service. */
export function recognizeAddress(input: string) {
  const warnings: string[] = [];
  const fields: RecognizedAddress = {
    recipientName: "",
    recipientMobile: "",
    province: "",
    city: "",
    district: "",
    addressDetail: "",
  };
  const missing = () =>
    Object.entries({
      recipientName: "收货人",
      recipientMobile: "联系电话",
      province: "省份",
      city: "城市",
      district: "区县",
      addressDetail: "详细地址",
    })
      .filter(([key]) => !fields[key as keyof RecognizedAddress])
      .map(([, label]) => label);
  const fail = (error: string) => ({
    fields,
    missing: missing(),
    error,
    recognized: false,
    warnings,
  });
  if (!input.trim()) return fail("请先粘贴收货信息");
  if (input.length > 1000)
    return fail("请只粘贴一位收货人的地址，最多1000个字符");
  let value = input.normalize("NFKC");
  const phones = [
    ...value.matchAll(
      /(?<!\d)(?:(?:\+?86)[ -]*)?1[3-9](?:[ -]*\d){9}(?!\d)|(?<!\d)0\d{2,3}[- ]\d{7,8}(?!\d)/g,
    ),
  ];
  const numbers = new Set(
    phones.map((m) =>
      m[0].replace(/[ -]/g, "").replace(/^\+?86(?=1\d{10}$)/, ""),
    ),
  );
  if (numbers.size > 1)
    return fail("发现多个联系电话，请只保留一位收货人的信息");
  fields.recipientMobile = [...numbers][0] || "";
  for (const phone of phones) value = value.replace(phone[0], " ");
  const explicitName = value.match(
    /(?:收货人|收件人|联系人|姓名)\s*[:：]\s*([^\n,，;；:：]{1,40}?)(?=\s|$|(?:手机|电话|地址|收货地址))/,
  );
  if (explicitName) {
    fields.recipientName = trim(explicitName[1]!);
    value = value.replace(explicitName[0], " ");
  }
  value = value.replace(
    /(?:收货人|收件人|联系人|姓名|手机号码|联系电话|电话号码|手机号|手机|电话|收货地址|收件地址|所在地区|详细地址|地址)\s*[:：]/g,
    " ",
  );
  value = trim(value);
  const province = matchArea(value, provinces);
  const city = matchArea(
    value,
    cities.filter(
      (c) => !province || c.code.slice(0, 2) === province.area.code.slice(0, 2),
    ),
    province?.end ?? 0,
  );
  if (!province && city) {
    const p = provinces.find(
      (p) => p.code.slice(0, 2) === city!.area.code.slice(0, 2),
    );
    if (p) fields.province = p.name;
  }
  if (province) fields.province = province.area.name;
  if (city) fields.city = city.area.name;
  const provinceCode = province?.area.code || (city ? city.area.code : "");
  if (municipalities.has(provinceCode.slice(0, 2)))
    fields.city = fields.province;
  const district = matchArea(
    value,
    districts.filter((d) =>
      city
        ? d.code.slice(0, 4) === city.area.code.slice(0, 4)
        : !province || d.code.slice(0, 2) === province.area.code.slice(0, 2),
    ),
    city?.end ?? province?.end ?? 0,
  );
  if (district) {
    fields.district = district.area.name;
    const p = provinces.find(
      (p) => p.code.slice(0, 2) === district.area.code.slice(0, 2),
    );
    fields.province ||= p?.name || "";
    const c = cities.find(
      (c) => c.code.slice(0, 4) === district.area.code.slice(0, 4),
    );
    fields.city ||= municipalities.has(district.area.code.slice(0, 2))
      ? fields.province
      : c?.name || district.area.name;
  }
  const matches = [province, city, district].filter((m): m is Match => !!m);
  if (matches.length) {
    const start = Math.min(...matches.map((m) => m.index)),
      end = Math.max(...matches.map((m) => m.end));
    const before = trim(value.slice(0, start));
    let after = trim(value.slice(end));
    if (!fields.district && fields.province && fields.city) {
      // Preserve an explicitly written old/new district name without inventing a mapping.
      const literal = after.match(
        /^([\p{Script=Han}]{1,10}?(?:自治县|区|县|市))/u,
      );
      if (literal && !/[路街巷]/.test(literal[1]!)) {
        fields.district = literal[1]!;
        after = trim(after.slice(literal[0].length));
        warnings.push("区县未在地区表中匹配，请核对");
      }
    }
    if (!fields.recipientName && nameLike(before))
      fields.recipientName = before;
    const tail = after.match(/[\s,，;；]+([^\s,，;；]+)$/);
    if (!fields.recipientName && tail && nameLike(tail[1]!)) {
      fields.recipientName = tail[1]!;
      after = trim(after.slice(0, tail.index));
    }
    fields.addressDetail = after;
  }
  return {
    fields,
    missing: missing(),
    error: "",
    warnings,
    recognized: !!(
      fields.recipientMobile ||
      fields.recipientName ||
      matches.length
    ),
  };
}
