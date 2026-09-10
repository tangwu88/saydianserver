<template>
  <view class="page"
    ><view class="container"
      ><view
        v-for="item in items"
        :key="item.id"
        class="address card"
        @click="choose(item)"
        ><view class="row between"
          ><b>{{ item.name }} {{ item.mobile }}</b
          ><text v-if="item.isDefault" class="default">默认</text></view
        ><text class="small"
          >{{ item.province }}{{ item.city }}{{ item.district
          }}{{ item.detail }}</text
        ><view class="row between edit"
          ><text @click.stop="edit(item.id)">编辑</text
          ><text @click.stop="remove(item.id)">删除</text></view
        ></view
      ><view v-if="!items.length" class="empty">还没有收货地址</view
      ><view class="primary-btn fixed" @click="edit('')"
        >新增收货地址</view
      ></view
    ></view
  >
</template>
<script setup lang="ts">
import { mallStorage } from "../../realm";
import { onLoad, onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import { api, toast } from "../../api";
const items = ref<any[]>([]),
  selectMode = ref(false);
onLoad((o) => (selectMode.value = o?.select === "1"));
onShow(load);
async function load() {
  items.value = [];
  try {
    items.value = await api("/storefront/addresses", { auth: true });
  } catch (e) {
    toast(e);
  }
}
function edit(id: string) {
  uni.navigateTo({ url: `/pages/address-edit/index${id ? `?id=${id}` : ""}` });
}
async function remove(id: string) {
  const answer=await uni.showModal({title:'删除收货地址',content:'确认删除这个收货地址？'});if(!answer.confirm)return;
  try {
    await api(`/storefront/addresses/${id}`, { method: "DELETE", auth: true });
    await load();
  } catch (e) {
    toast(e);
  }
}
function choose(item: any) {
  if (!selectMode.value) return;
  mallStorage.set("checkout-address", item);
  uni.navigateBack();
}
</script>
<style scoped lang="scss">
.address {
  margin-bottom: 18rpx;
}
.address .small {
  display: block;
  color: var(--muted);
  line-height: 1.7;
  margin: 14rpx 0;
}
.default {
  color: var(--green);
  background: var(--mint);
  font-size: 20rpx;
  padding: 5rpx 12rpx;
  border-radius: 8rpx;
}
.edit {
  border-top: 1px solid var(--line);
  padding-top: 18rpx;
  color: var(--muted);
}
.fixed {
  position: fixed;
  left: 24rpx;
  right: 24rpx;
  bottom: 36rpx;
  max-width: 720px;
  margin: auto;
}
</style>
