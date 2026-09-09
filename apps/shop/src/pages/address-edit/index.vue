<template>
  <view class="page"
    ><view class="container card form"
      ><input
        v-model="form.name"
        class="input"
        placeholder="收货人姓名"
      /><input
        v-model="form.mobile"
        class="input"
        type="number"
        maxlength="11"
        placeholder="手机号"
      />
      <!-- #ifdef H5 -->
      <input v-model="form.province" class="input" maxlength="80" placeholder="省 / 直辖市"/>
      <input v-model="form.city" class="input" maxlength="80" placeholder="市"/>
      <input v-model="form.district" class="input" maxlength="80" placeholder="区 / 县"/>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <picker mode="region" @change="region"
        ><view class="input picker">{{
          regionText || "选择省 / 市 / 区"
        }}</view></picker>
      <!-- #endif -->
      <input
        v-model="form.detail"
        class="input"
        placeholder="街道、楼栋、门牌号"
      /><label class="default-row"
        ><checkbox
          :checked="form.isDefault"
          @click="form.isDefault = !form.isDefault"
        />设为默认收货地址</label
      ><button class="primary-btn" :disabled="busy" @click="save">保存地址</button></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { computed, reactive, ref } from "vue";
import { api, toast } from "../../api";
const busy=ref(false),owner=String(uni.getStorageSync('saidian-user')?.id || '');
const form = reactive<any>({
  name: "",
  mobile: "",
  province: "",
  city: "",
  district: "",
  detail: "",
  isDefault: false,
});
const regionText = computed(() =>
  [form.province, form.city, form.district].filter(Boolean).join(" / "),
);
onLoad(async (o) => {
  if (o?.id) {
    try {
      const rows: any[] = await api("/storefront/addresses", { auth: true });
      Object.assign(form, rows.find((x) => x.id === o.id) || {});
    } catch (e) {
      toast(e);
    }
  }
});
function region(e: any) {
  [form.province, form.city, form.district] = e.detail.value;
}
async function save() {
  if (busy.value) return;
  if (owner !== String(uni.getStorageSync('saidian-user')?.id || '')) return toast('账号已切换，请重新打开地址编辑页');
  if (!form.name.trim() || !/^1\d{10}$/.test(form.mobile) || !form.province.trim() || !form.city.trim() || !form.district.trim() || !form.detail.trim()) return toast('请完整填写收货人、手机号和地址');
  busy.value=true;
  try {
    await api("/storefront/addresses", {
      method: "POST",
      auth: true,
      data: form,
    });
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
  gap: 20rpx;
}
.picker {
  display: flex;
  align-items: center;
  color: #596762;
}
.default-row {
  display: flex;
  align-items: center;
  margin: 10rpx 0 20rpx;
}
</style>
