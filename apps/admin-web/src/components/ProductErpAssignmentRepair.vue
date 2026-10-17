<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, readableError, responseData } from "../api";
const props = defineProps<{ productId: string }>();
const emit = defineEmits<{ saved: [product: Record<string, any>] }>();
const visible = ref(false),
  busy = ref(false),
  preview = ref<any>();
let alive = true;
onBeforeUnmount(() => {
  alive = false;
});
async function inspect() {
  if (busy.value) return;
  busy.value = true;
  preview.value = undefined;
  try {
    preview.value = responseData(
      await api.post(`/commerce-products/${props.productId}/erp-assignment`, {
        action: "preview",
      }),
    );
    if (alive) visible.value = true;
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    busy.value = false;
  }
}
async function apply() {
  if (busy.value || !preview.value?.changed) return;
  busy.value = true;
  try {
    await ElMessageBox.confirm(
      `确认按预览校正 ${preview.value.changed} 个规格？新款式将创建为草稿，请核对后上架。`,
      "确认校正规格归属",
      { type: "warning" },
    );
    if (!alive) return;
    const result = responseData<any>(
      await api.post(`/commerce-products/${props.productId}/erp-assignment`, {
        action: "apply",
        fingerprint: preview.value.fingerprint,
      }),
    );
    visible.value = false;
    emit("saved", result.product);
    ElMessage.success(
      `已校正 ${result.changed} 个规格${result.newDrafts.length ? "，新商品请到商品列表核对并上架" : ""}`,
    );
  } catch (error) {
    if (error !== "cancel" && error !== "close") {
      preview.value = undefined;
      visible.value = false;
      ElMessage.error(readableError(error));
    }
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <el-button :loading="busy" size="small" @click="inspect"
    >核对 ERP 规格归属</el-button
  >
  <el-dialog
    v-model="visible"
    title="ERP 规格归属预览"
    width="min(900px, 94vw)"
    append-to-body
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
  >
    <el-alert
      title="按聚水潭返回的款式编码核对。校正保留 SKU 编号、库存、价格、合作价和历史订单；新建款式为草稿，需核对后上架。"
      type="info"
      :closable="false"
    />
    <el-table v-if="preview" :data="preview.rows" max-height="440" border>
      <el-table-column prop="erpSkuId" label="ERP SKU" min-width="190" />
      <el-table-column prop="currentItemId" label="当前款式" min-width="130" />
      <el-table-column prop="erpItemId" label="ERP 正确款式" min-width="130" />
      <el-table-column prop="targetName" label="目标商品" min-width="160" />
      <el-table-column label="处理" width="130"
        ><template #default="scope">{{
          !scope.row.changed
            ? "无需变更"
            : scope.row.createsDraft
              ? "移入新草稿商品"
              : "移至正确商品"
        }}</template></el-table-column
      >
    </el-table>
    <template #footer
      ><el-button :disabled="busy" @click="visible = false">关闭</el-button
      ><el-button :disabled="busy" @click="inspect">重新核对</el-button
      ><el-button
        type="primary"
        :disabled="!preview?.changed"
        :loading="busy"
        @click="apply"
        >确认校正（{{ preview?.changed || 0 }}）</el-button
      ></template
    >
  </el-dialog>
</template>
