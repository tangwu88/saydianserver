<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { parseGiftCardNos } from "@saydian/app-contracts";
import {
  adminSessionKey,
  api,
  getAdminRoles,
  readableError,
  responseData,
} from "../api";

const props = defineProps<{
  modelValue: boolean;
  action: "ACTIVATE" | "BIND";
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  completed: [];
}>();
type Product = {
  id: string;
  displayName?: string;
  name: string;
  skus: { id: string; specification?: string; stock: number }[];
};
const input = ref(""),
  reason = ref(""),
  confirmed = ref(false),
  busy = ref(false),
  loading = ref(false),
  error = ref("");
const products = ref<Product[]>([]),
  productId = ref(""),
  allowedSkuIds = ref<string[]>([]),
  expiresAt = ref("");
const chosen = computed(() =>
  products.value.find((product) => product.id === productId.value),
);
const parsed = computed(() => {
  try {
    return { cardNos: parseGiftCardNos(input.value), error: "" };
  } catch (error) {
    return { cardNos: [] as string[], error: (error as Error).message };
  }
});
let revision = 0,
  owner: string | null = null,
  disposed = false;
const owns = (key: number) =>
  !disposed &&
  props.modelValue &&
  revision === key &&
  owner !== null &&
  owner === adminSessionKey();
function reset() {
  input.value = "";
  reason.value = "";
  confirmed.value = false;
  error.value = "";
  products.value = [];
  productId.value = "";
  allowedSkuIds.value = [];
  expiresAt.value = "";
}
function close() {
  if (!busy.value) emit("update:modelValue", false);
}
watch(
  () => [props.modelValue, props.action] as const,
  async ([open, action]) => {
    const key = ++revision;
    reset();
    busy.value = false;
    loading.value = false;
    owner = open ? adminSessionKey() : null;
    if (!open || action !== "BIND") return;
    loading.value = true;
    try {
      const response = await api.get("/commerce-gift-products");
      if (owns(key)) products.value = responseData<Product[]>(response);
    } catch (failure) {
      if (owns(key)) error.value = readableError(failure);
    } finally {
      if (owns(key)) loading.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  revision++;
  reset();
});

async function submit() {
  if (busy.value || loading.value) return;
  error.value = "";
  const key = revision;
  if (!owns(key) || !getAdminRoles().includes("SUPER_ADMIN")) {
    error.value = "登录状态或权限已变化，请重新登录后操作";
    return;
  }
  if (parsed.value.error) {
    error.value = parsed.value.error;
    return;
  }
  if (!reason.value.trim()) {
    error.value = "请填写操作原因";
    return;
  }
  if (props.action === "ACTIVATE" && !confirmed.value) {
    error.value = "请先确认已保存发卡文件";
    return;
  }
  if (
    props.action === "BIND" &&
    (!chosen.value || !allowedSkuIds.value.length)
  ) {
    error.value = "请选择兑换商品和允许兑换的规格";
    return;
  }
  busy.value = true;
  try {
    const response = await api.post("/commerce-gift-cards/actions", {
      action: props.action,
      cardNos: parsed.value.cardNos,
      reason: reason.value.trim(),
      ...(props.action === "ACTIVATE"
        ? { downloadConfirmed: true }
        : {
            productId: productId.value,
            allowedSkuIds: allowedSkuIds.value,
            expiresAt: expiresAt.value || null,
          }),
    });
    if (!owns(key)) return;
    const result = responseData<{ changed: number }>(response);
    ElMessage.success(
      `已${props.action === "ACTIVATE" ? "开启" : "换绑"}${result.changed}张礼品卡`,
    );
    emit("completed");
    emit("update:modelValue", false);
  } catch (failure) {
    if (owns(key)) error.value = readableError(failure);
  } finally {
    if (owns(key)) busy.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="action === 'ACTIVATE' ? '按卡号批量开启' : '按卡号批量换绑'"
    width="min(620px, 94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @update:model-value="close"
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="仅处理未启用卡片；卡号不存在或状态不符时，整批不处理。"
    />
    <el-form label-position="top" :disabled="busy || loading" class="bulk-form">
      <el-form-item label="礼品卡号" required>
        <el-input
          v-model="input"
          type="textarea"
          :rows="5"
          :maxlength="10000"
          placeholder="例如：80100611，80100612；也可以每行一个卡号"
        />
        <div class="hint">
          填写8位卡号，例如80100611，支持换行、逗号、空格；每次最多100个，重复卡号自动去重。
        </div>
        <div v-if="parsed.cardNos.length" class="hint">
          共 {{ parsed.cardNos.length }} 个卡号：{{ parsed.cardNos.join("、") }}
        </div>
        <div v-else-if="input.trim()" class="validation">
          {{ parsed.error }}
        </div>
      </el-form-item>
      <template v-if="action === 'BIND'">
        <el-form-item label="统一换绑至商品" required>
          <el-select
            v-model="productId"
            filterable
            :loading="loading"
            @change="allowedSkuIds = []"
          >
            <el-option
              v-for="product in products"
              :key="product.id"
              :label="product.displayName || product.name"
              :value="product.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="允许兑换的规格" required>
          <el-checkbox-group v-model="allowedSkuIds">
            <el-checkbox
              v-for="sku in chosen?.skus || []"
              :key="sku.id"
              :value="sku.id"
              >{{ sku.specification || "默认规格" }} · 库存
              {{ sku.stock }}</el-checkbox
            >
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="统一设置有效期（留空改为不限）">
          <el-date-picker
            v-model="expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
            clearable
          />
        </el-form-item>
        <div class="hint">
          将统一修改这些卡号对应卡片的商品、可兑规格和有效期，原卡号及校验码保留。
        </div>
      </template>
      <el-form-item label="操作原因" required
        ><el-input v-model="reason" maxlength="200" show-word-limit
      /></el-form-item>
      <el-checkbox v-if="action === 'ACTIVATE'" v-model="confirmed"
        >我已保存这些礼品卡的发卡文件，确认开启兑换</el-checkbox
      >
    </el-form>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
    />
    <template #footer>
      <el-button :disabled="busy" @click="close">取消</el-button>
      <el-button
        type="primary"
        :loading="busy"
        :disabled="loading || !parsed.cardNos.length"
        @click="submit"
        >确认{{ action === "ACTIVATE" ? "开启" : "换绑" }}
        {{ parsed.cardNos.length }} 张</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.bulk-form {
  margin-top: 18px;
}
.hint {
  color: #606266;
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.validation {
  color: #f56c6c;
  font-size: 13px;
}
.el-select {
  width: 100%;
}
</style>
