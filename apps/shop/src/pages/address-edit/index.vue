<template>
  <view class="page"><view class="container card form">
    <view class="form-intro"><b>填写收货信息</b><text>只需姓名、手机号、所在地区和门牌号</text></view>
    <view class="field-block"><text class="field-title">收货人</text><input
      v-model="form.name"
      class="input"
      name="name"
      autocomplete="name"
      maxlength="40"
      placeholder="请输入姓名"
      @blur="touched.name = true"
    /></view><text v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</text>
    <view class="field-block"><view class="phone-title"><text class="field-title">手机号</text><text v-if="isGlobalMall">中国大陆 +86</text></view><view class="phone-row"><text v-if="isGlobalMall" class="calling-code">+86</text><input
      v-model="form.mobile"
      class="input"
      name="tel"
      autocomplete="tel"
      type="number"
      maxlength="11"
      placeholder="用于收货联系"
      @blur="touched.mobile = true"
    /></view></view><text v-if="fieldErrors.mobile" class="field-error">{{ fieldErrors.mobile }}</text>
    <view class="field-block"><text class="field-title">所在地区</text><picker
      mode="multiSelector"
      :range="regionColumns"
      :value="regionIndexes"
      @columnchange="changeRegionColumn"
      @change="confirmRegion"
    ><view :class="['input', 'picker', regionText && 'selected']"><text>{{ regionText || "选择省 / 市 / 区" }}</text><text class="picker-action">选择 ›</text></view></picker></view>
    <text v-if="fieldErrors.region" class="field-error">{{ fieldErrors.region }}</text><text v-else class="field-help">省、市、区县会自动联动，一次选完即可</text>
    <view class="field-block"><text class="field-title">详细地址</text><input
      v-model="form.detail"
      class="input"
      name="street-address"
      autocomplete="street-address"
      maxlength="200"
      placeholder="例如：科技园路 8 号 2 栋 1201"
      @blur="touched.detail = true"
    /></view><text v-if="fieldErrors.detail" class="field-error">{{ fieldErrors.detail }}</text>
    <label class="default-row"><checkbox
      :checked="form.isDefault"
      @click="form.isDefault = !form.isDefault"
    />设为默认收货地址</label>
    <view :class="['form-status', readyToSave && 'ready']">{{ formStatus }}</view>
    <button class="primary-btn" :loading="busy" :disabled="busy" @click="save">{{ busy ? '正在保存…' : '保存并使用' }}</button>
  </view></view>
</template>
<script setup lang="ts">
import { mallStorage, isGlobalMall } from "../../realm";
import { onLoad } from "@dcloudio/uni-app";
import { computed, reactive, ref } from "vue";
import { api, toast } from "../../api";
import {
  constrainMainlandRegionIndexes,
  mainlandCities,
  mainlandDistricts,
  mainlandProvinces,
  mainlandRegionAt,
  mainlandRegionIndexes,
} from "../../china-area";
const busy=ref(false),owner=String(mallStorage.get('saidian-user')?.id || '');
const form = reactive<any>({
  name: "",
  mobile: "",
  province: "",
  city: "",
  district: "",
  detail: "",
  isDefault: false,
  ...(isGlobalMall ? { countryCode: 'CN' } : {}),
});
const touched = reactive({ name: false, mobile: false, region: false, detail: false });
const regionIndexes = ref<[number, number, number]>([0, 0, 0]);
const cityOptions = computed(() => mainlandCities(mainlandProvinces[regionIndexes.value[0]]?.code || ""));
const districtOptions = computed(() => mainlandDistricts(cityOptions.value[regionIndexes.value[1]]?.code || ""));
const regionColumns = computed(() => [
  mainlandProvinces.map((item) => item.label),
  cityOptions.value.map((item) => item.label),
  districtOptions.value.map((item) => item.label),
]);
const regionText = computed(() =>
  [form.province, form.city, form.district].filter(Boolean).join(" / "),
);
const readyToSave = computed(() => Boolean(
  String(form.name).trim() && /^1\d{10}$/.test(String(form.mobile)) &&
  String(form.province).trim() && String(form.city).trim() &&
  String(form.district).trim() && String(form.detail).trim(),
));
const missingFields = computed(() => [
  !String(form.name).trim() && "收货人",
  !/^1\d{10}$/.test(String(form.mobile)) && "手机号",
  !(String(form.province).trim() && String(form.city).trim() && String(form.district).trim()) && "所在地区",
  !String(form.detail).trim() && "详细地址",
].filter(Boolean));
const formStatus = computed(() => readyToSave.value
  ? "信息已完整，可以保存"
  : `还需填写：${missingFields.value.join("、")}`);
const fieldErrors = computed(() => ({
  name: touched.name && !String(form.name).trim() ? "请填写收货人姓名" : "",
  mobile: touched.mobile && !/^1\d{10}$/.test(String(form.mobile)) ? "请输入 11 位中国大陆手机号" : "",
  region: touched.region && !(form.province && form.city && form.district) ? "请选择省、市和区县" : "",
  detail: touched.detail && !String(form.detail).trim() ? "请填写街道、楼栋和门牌号" : "",
}));
onLoad(async (o) => {
  if (o?.id) {
    try {
      const rows: any[] = await api("/storefront/addresses", { auth: true });
      Object.assign(form, rows.find((x) => x.id === o.id) || {});
      if (isGlobalMall && /^\+861\d{10}$/.test(form.mobile)) form.mobile = form.mobile.slice(3);
      if (!isGlobalMall || form.countryCode === 'CN') regionIndexes.value = mainlandRegionIndexes(form);
    } catch (e) {
      toast(e);
    }
  } else {
    const lastRegion = mallStorage.get('checkout-last-region');
    if (lastRegion?.province && lastRegion?.city && lastRegion?.district) {
      Object.assign(form, lastRegion);
      regionIndexes.value = mainlandRegionIndexes(form);
    }
  }
});
function changeRegionColumn(e: any) {
  const column = Number(e.detail.column), next = [...regionIndexes.value];
  next[column] = Number(e.detail.value) || 0;
  if (column === 0) { next[1] = 0; next[2] = 0; }
  if (column === 1) next[2] = 0;
  regionIndexes.value = constrainMainlandRegionIndexes(next);
}
function confirmRegion(e: any) {
  const selected = mainlandRegionAt(e.detail.value || regionIndexes.value);
  regionIndexes.value = selected.indexes;
  Object.assign(form, {
    province: selected.province.name,
    provinceCode: selected.province.code,
    city: selected.city.name,
    cityCode: selected.city.code,
    district: selected.district.name,
    districtCode: selected.district.code,
  });
  touched.region = true;
}
async function save() {
  if (busy.value) return;
  if (owner !== String(mallStorage.get('saidian-user')?.id || '')) return toast('账号已切换，请重新打开地址编辑页');
  if (isGlobalMall && form.countryCode !== 'CN') return toast('当前仅支持中国大陆收货，请新建收货地址');
  Object.assign(touched, { name: true, mobile: true, region: true, detail: true });
  if (!String(form.name).trim()) return toast('请填写收货人姓名');
  if (!/^1\d{10}$/.test(String(form.mobile))) return toast('请输入 11 位中国大陆手机号');
  if (!String(form.province).trim() || !String(form.city).trim() || !String(form.district).trim()) return toast('请选择省、市和区县');
  if (!String(form.detail).trim()) return toast('请填写街道、楼栋和门牌号');
  busy.value=true;
  try {
    const saved: any = await api("/storefront/addresses", {
      method: "POST",
      auth: true,
      data: isGlobalMall ? { ...form, countryCode: 'CN', mobile: '+86' + form.mobile } : form,
    });
    if (isGlobalMall) mallStorage.set('checkout-last-region', {
      countryCode: 'CN', province: form.province, provinceCode: form.provinceCode,
      city: form.city, cityCode: form.cityCode, district: form.district, districtCode: form.districtCode,
    });
    if (saved?.id) mallStorage.set('checkout-address', saved);
    uni.showToast({ title: "已保存" });
    setTimeout(() => uni.navigateBack(), 500);
  } catch (e) {
    toast(e);
  } finally {
    busy.value=false;
  }
}
</script>
<style scoped lang="scss">
.form {
  display: grid;
  gap: 12rpx;
}
.form-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:8px}.form-intro b{font-size:20px}.form-intro text{font-size:13px;color:var(--muted);text-align:right}
.field-block{margin-top:8px}.field-title{display:block;margin-bottom:8px;font-size:14px;font-weight:750;color:var(--ink)}
.phone-title{display:flex;justify-content:space-between;align-items:center}.phone-title>text:last-child{font-size:12px;color:var(--muted)}
.phone-row{display:flex;align-items:center;border:1px solid var(--line);border-radius:12rpx;background:#fff;overflow:hidden}.phone-row .input{flex:1;min-width:0;border:0}.calling-code{padding-left:16px;font-weight:750;color:var(--ink)}
.picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #596762;
}
.picker.selected{color:var(--ink)}.picker-action{flex:none;margin-left:12px;color:var(--green);font-size:13px}
.field-help,.field-error{font-size:12px;line-height:1.5}.field-help{color:var(--muted)}.field-error{color:#b42318}.form-status{padding:10px 12px;border-radius:10px;background:#fff7e8;color:#8a5a00;font-size:13px}.form-status.ready{background:var(--mint);color:var(--green)}
.default-row {
  display: flex;
  align-items: center;
  margin: 10rpx 0;
}
@media(max-width:520px){.form-intro{display:block}.form-intro text{display:block;text-align:left;margin-top:6px}}
</style>
