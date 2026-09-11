import { areaList } from "@vant/area-data";

export type ChinaAreaOption = {
  code: string;
  name: string;
  label: string;
};

type RegionValue = {
  province?: string;
  provinceCode?: string;
  city?: string;
  cityCode?: string;
  district?: string;
  districtCode?: string;
};

const byCode = ([left]: [string, string], [right]: [string, string]) =>
  left.localeCompare(right);

export const mainlandProvinces: ChinaAreaOption[] = Object.entries(
  areaList.province_list,
)
  .filter(([code]) => Number(code) < 710000)
  .sort(byCode)
  .map(([code, name]) => ({ code, name, label: name }));

const cities = new Map<string, ChinaAreaOption[]>();
for (const province of mainlandProvinces) {
  cities.set(
    province.code,
    Object.entries(areaList.city_list)
      .filter(([code]) => code.slice(0, 2) === province.code.slice(0, 2))
      .sort(byCode)
      .map(([code, rawName]) => {
        const isUrban = rawName === "市辖区";
        const isCounty = rawName === "县";
        return {
          code,
          name: isUrban || isCounty ? province.name : rawName,
          label: isUrban
            ? `${province.name}城区`
            : isCounty
              ? `${province.name}县域`
              : rawName,
        };
      }),
  );
}

const districts = new Map<string, ChinaAreaOption[]>();
for (const [provinceCode, provinceCities] of cities) {
  for (const city of provinceCities) {
    const rows = Object.entries(areaList.county_list)
      .filter(([code]) => code.slice(0, 4) === city.code.slice(0, 4))
      .sort(byCode)
      .map(([code, name]) => ({ code, name, label: name }));
    districts.set(
      city.code,
      rows.length
        ? rows
        : [{ code: city.code, name: city.name, label: city.label }],
    );
  }
  if (!provinceCities.length) {
    const province = mainlandProvinces.find((item) => item.code === provinceCode)!;
    cities.set(provinceCode, [province]);
    districts.set(provinceCode, [province]);
  }
}

export function mainlandCities(provinceCode: string) {
  return cities.get(provinceCode) || [];
}

export function mainlandDistricts(cityCode: string) {
  return districts.get(cityCode) || [];
}

function matchIndex(
  rows: ChinaAreaOption[],
  code: string | undefined,
  name: string | undefined,
) {
  const normalizedCode = String(code || "");
  const normalizedName = String(name || "").trim();
  const found = rows.findIndex(
    (row) =>
      row.code === normalizedCode ||
      row.name === normalizedName ||
      row.label === normalizedName,
  );
  return found >= 0 ? found : 0;
}

export function mainlandRegionIndexes(value: RegionValue): [number, number, number] {
  const provinceIndex = matchIndex(
    mainlandProvinces,
    value.provinceCode,
    value.province,
  );
  const province = mainlandProvinces[provinceIndex];
  const cityRows = province ? mainlandCities(province.code) : [];
  const cityIndex = matchIndex(cityRows, value.cityCode, value.city);
  const city = cityRows[cityIndex];
  const districtRows = city ? mainlandDistricts(city.code) : [];
  const districtIndex = matchIndex(
    districtRows,
    value.districtCode,
    value.district,
  );
  return [provinceIndex, cityIndex, districtIndex];
}

export function constrainMainlandRegionIndexes(
  value: readonly number[],
): [number, number, number] {
  const provinceIndex = Math.max(
    0,
    Math.min(Number(value[0]) || 0, mainlandProvinces.length - 1),
  );
  const province = mainlandProvinces[provinceIndex];
  const cityRows = province ? mainlandCities(province.code) : [];
  const cityIndex = Math.max(
    0,
    Math.min(Number(value[1]) || 0, Math.max(0, cityRows.length - 1)),
  );
  const city = cityRows[cityIndex];
  const districtRows = city ? mainlandDistricts(city.code) : [];
  const districtIndex = Math.max(
    0,
    Math.min(Number(value[2]) || 0, Math.max(0, districtRows.length - 1)),
  );
  return [provinceIndex, cityIndex, districtIndex];
}

export function mainlandRegionAt(value: readonly number[]) {
  const indexes = constrainMainlandRegionIndexes(value);
  const province = mainlandProvinces[indexes[0]]!;
  const city = mainlandCities(province.code)[indexes[1]]!;
  const district = mainlandDistricts(city.code)[indexes[2]]!;
  return { indexes, province, city, district };
}
