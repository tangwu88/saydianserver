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
      /><picker mode="region" @change="region"
        ><view class="input picker">{{
          regionText || "选择省 / 市 / 区"
        }}</view></picker
      ><input
        v-model="form.detail"
        class="input"
        placeholder="街道、楼栋、门牌号"
      /><label class="default-row"
        ><checkbox
          :checked="form.isDefault"
          @click="form.isDefault = !form.isDefault"
        />设为默认收货地址</label
      ><view class="primary-btn" @click="save">保存地址</view></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { computed, reactive } from "vue";
import { api, toast } from "../../api";
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
