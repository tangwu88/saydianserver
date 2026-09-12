<template>
  <button
    class="country-trigger"
    :class="{ compact }"
    :disabled="disabled === true"
    :aria-label="`选择国家或地区，当前${selected.name} ${selected.callingCode}`"
    @click.stop="open = true"
  >
    <text v-if="!compact" class="country-name">{{ selected.name }}</text>
    <text>{{ selected.callingCode }}</text><text class="chevron">⌄</text>
  </button>
  <view v-if="open" class="country-mask" @click.self="close">
    <view class="country-dialog" role="dialog" aria-label="选择国家或地区">
      <view class="dialog-title"><b>选择国家或地区</b><button aria-label="关闭" @click="close">×</button></view>
      <input
        v-model="query"
        class="country-search"
        type="text"
        maxlength="80"
        placeholder="搜索国家、地区或区号"
        focus
      />
      <scroll-view class="country-list" scroll-y>
        <button
          v-for="item in filtered"
          :key="item.country"
          class="country-option"
          :class="{ active: item.country === modelValue }"
          @click="choose(item.country)"
        >
          <text>{{ item.name }} · {{ item.country }}</text>
          <text>{{ item.callingCode }}</text>
        </button>
        <text v-if="!filtered.length" class="empty">没有找到匹配的国家或地区</text>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  phoneCountryOptions,
  type PhoneCountryCode,
} from "../country-phone";

const props = withDefaults(
  defineProps<{
    modelValue?: PhoneCountryCode;
    disabled?: boolean;
    compact?: boolean;
  }>(),
  { modelValue: "CN", disabled: false, compact: false },
);
const emit = defineEmits<{
  (event: "update:modelValue", value: PhoneCountryCode): void;
}>();
const open = ref(false);
const query = ref("");
const options = phoneCountryOptions();
const selected = computed(
  () =>
    options.find((item) => item.country === props.modelValue) ?? options[0]!,
);
const filtered = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  return term ? options.filter((item) => item.search.includes(term)) : options;
});
function close() {
  open.value = false;
  query.value = "";
}
function choose(country: PhoneCountryCode) {
  emit("update:modelValue", country);
  close();
}
</script>

<style scoped>
.country-trigger {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid #98a2b3;
  border-radius: 12px;
  background: #fff;
  color: #171b2b;
  font-size: 14px;
  line-height: 1;
}
.country-trigger::after,
.country-option::after,
.dialog-title button::after { border: 0; }
.country-trigger.compact { min-width: 96px; border: 0; border-radius: 0; }
.country-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { color: #667085; }
.country-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(15, 23, 42, .45);
}
.country-dialog {
  width: min(100%, 520px);
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  padding: 18px 16px max(18px, env(safe-area-inset-bottom));
  border-radius: 20px 20px 0 0;
  background: #fff;
  box-sizing: border-box;
}
.dialog-title { display: flex; align-items: center; justify-content: space-between; font-size: 18px; }
.dialog-title button { margin: 0; padding: 4px 8px; background: transparent; color: #667085; font-size: 26px; line-height: 1; }
.country-search { height: 48px; margin: 14px 0 10px; padding: 0 14px; border: 1px solid #d0d5dd; border-radius: 12px; box-sizing: border-box; }
.country-list { height: 52vh; }
.country-option { width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: space-between; margin: 0; padding: 10px 8px; border-bottom: 1px solid #eef1f4; border-radius: 0; background: #fff; color: #171b2b; font-size: 15px; text-align: left; }
.country-option.active { color: #d20b27; font-weight: 700; }
.empty { display: block; padding: 36px 8px; color: #667085; text-align: center; }
</style>
