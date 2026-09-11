<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, readableError, responseData } from "../api";

type Row = Record<string, any>;
type SkuDraft = {
  id: string;
  erpSkuId: string;
  specification: string;
  priceYuan: number | undefined;
  stock: number | undefined;
  originalSalePriceCents: number;
  originalStock: number;
  updatedAt: string;
};

const props = defineProps<{
  product: Row;
  canEdit: boolean;
}>();

const emit = defineEmits<{
  saved: [product: Row];
}>();

const editing = ref(false);
const saving = ref(false);
const drafts = ref<SkuDraft[]>([]);
const displayRows = computed(() => editing.value ? drafts.value : (Array.isArray(props.product.skus) ? props.product.skus : []));
const skuCodeLabel = computed(() => props.product.source === "ERP" ? "ERP SKU" : "SKU 编号");

function money(cents: unknown): string {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 }).format(amount / 100);
}

function startEditing(): void {
  drafts.value = (Array.isArray(props.product.skus) ? props.product.skus : []).map((sku: Row) => ({
    id: String(sku.id ?? ""),
    erpSkuId: String(sku.erpSkuId ?? ""),
    specification: String(sku.specification ?? "—"),
    priceYuan: Number.isFinite(Number(sku.salePriceCents)) ? Number(sku.salePriceCents) / 100 : undefined,
    stock: Number.isSafeInteger(Number(sku.stock)) ? Number(sku.stock) : undefined,
    originalSalePriceCents: Number(sku.salePriceCents),
    originalStock: Number(sku.stock),
    updatedAt: String(sku.updatedAt ?? ""),
  }));
  editing.value = true;
}

function cancelEditing(): void {
  if (saving.value) return;
  drafts.value = [];
  editing.value = false;
}

function priceInCents(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("请填写有效售价");
  const cents = Math.round(value * 100);
  if (cents < 1 || cents > 2_147_483_647) throw new Error("售价应在0.01至21474836.47元之间");
  return cents;
}

function validStock(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error("库存必须是0至2147483647之间的整数");
  }
  return value;
}

async function saveAdjustments(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    const skus = drafts.value.map((sku) => {
      const salePriceCents = priceInCents(sku.priceYuan);
      const stock = validStock(sku.stock);
      return { id: sku.id, updatedAt: sku.updatedAt, salePriceCents, stock,
        changed: salePriceCents !== sku.originalSalePriceCents || stock !== sku.originalStock };
    }).filter((sku) => sku.changed).map(({ changed: _changed, ...sku }) => sku);
    if (!skus.length) throw new Error("售价和库存没有变化");
    const saved = responseData<Row>(await api.patch(
      `/commerce-products/${encodeURIComponent(String(props.product.id ?? ""))}/skus`,
      { skus },
    ));
    editing.value = false;
    drafts.value = [];
    emit("saved", saved);
    ElMessage.success("售价和库存已更新");
  } catch (error) {
    ElMessage.error(error instanceof Error && !("response" in error) ? error.message : readableError(error));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="sku-editor">
    <div class="section-heading">
      <div>
        <h3>SKU 与库存</h3>
        <small v-if="!editing">修改后会立即影响商城售价和可售库存</small>
      </div>
      <el-button v-if="canEdit && !editing" type="primary" plain size="small" @click="startEditing">快速修改</el-button>
    </div>

    <el-alert
      v-if="editing && product.source === 'ERP'"
      title="本次修改会立即生效；下次 ERP 同步可能覆盖手工售价和库存，请在同步后复核。"
      type="warning"
      :closable="false"
      show-icon
      class="erp-warning"
    />

    <el-table :data="displayRows" border>
      <el-table-column prop="erpSkuId" :label="skuCodeLabel" min-width="140" />
      <el-table-column prop="specification" label="规格" min-width="120" />
      <el-table-column label="售价" min-width="150">
        <template #default="scope">
          <el-input-number
            v-if="editing"
            v-model="scope.row.priceYuan"
            :aria-label="`${scope.row.erpSkuId} 售价（元）`"
            :min="0.01"
            :max="21474836.47"
            :precision="2"
            :step="1"
            :disabled="saving"
            controls-position="right"
            class="price-input"
          />
          <span v-else>{{ money(scope.row.salePriceCents) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="库存" min-width="125">
        <template #default="scope">
          <el-input-number
            v-if="editing"
            v-model="scope.row.stock"
            :aria-label="`${scope.row.erpSkuId} 库存`"
            :min="0"
            :max="2147483647"
            :precision="0"
            :step="1"
            :disabled="saving"
            controls-position="right"
            class="stock-input"
          />
          <span v-else>{{ scope.row.stock }}</span>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="editing" class="editor-actions">
      <small>售价按人民币元填写，最多保留两位小数；库存可填写 0。</small>
      <div>
        <el-button :disabled="saving" @click="cancelEditing">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAdjustments">保存修改</el-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sku-editor { margin-top: 24px; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.section-heading h3 { margin: 0; font-size: 16px; }
.section-heading small, .editor-actions small { display: block; margin-top: 5px; color: #768396; line-height: 1.45; }
.erp-warning { margin-bottom: 12px; }
.price-input { width: 132px; }
.stock-input { width: 106px; }
.editor-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; }
.editor-actions > div { display: flex; flex: none; gap: 8px; }
@media (max-width: 680px) {
  .editor-actions { align-items: stretch; flex-direction: column; }
  .editor-actions > div { justify-content: flex-end; }
}
</style>
