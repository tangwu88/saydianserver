<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, getAdminRoles, readableError, responseData } from "../api";
type Row = Record<string, any>;
const router = useRouter(),
  writable = computed(() => getAdminRoles().includes("SUPER_ADMIN"));
const tab = ref("cards"),
  q = ref(""),
  status = ref(""),
  batchId = ref(""),
  page = ref(1),
  total = ref(0),
  rows = ref<Row[]>([]),
  loading = ref(false),
  busy = ref(false),
  error = ref("");
const selected = ref<Row[]>([]),
  enabled = ref(false),
  products = ref<Row[]>([]),
  dialog = ref(false),
  binding = ref<Row | null>(null),
  generated = ref<Row | null>(null),
  downloadSaved = ref(false),
  qr = ref<Row | null>(null),
  detail = ref<Row | null>(null);
const form = ref({
  name: "",
  quantity: 10,
  productId: "",
  allowedSkuIds: [] as string[],
  expiresAt: "",
});
const chosen = computed(() =>
  products.value.find((product) => product.id === form.value.productId),
);
const labels: Record<string, string> = {
  DRAFT: "未启用",
  ACTIVE: "可兑换",
  REDEEMED: "已兑换",
  VOID: "已作废",
  EXPIRED: "已过期",
};
const stamp = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString() : "不限";
let request = 0;
async function load() {
  const revision = ++request;
  loading.value = true;
  error.value = "";
  selected.value = [];
  rows.value = [];
  try {
    const endpoint =
      tab.value === "batches"
        ? "commerce-gift-batches"
        : tab.value === "records"
          ? "commerce-gift-redemptions"
          : "commerce-gift-cards";
    const result = responseData<Row>(
      await api.get("/" + endpoint, {
        params: {
          q: q.value,
          page: page.value,
          status: status.value,
          batchId: batchId.value,
        },
      }),
    );
    if (revision === request) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (cause) {
    if (revision === request) error.value = readableError(cause);
  } finally {
    if (revision === request) loading.value = false;
  }
}
watch(tab, () => selectTab(), { flush: "sync" });
function selectTab() {
  page.value = 1;
  q.value = "";
  status.value = "";
  batchId.value = "";
  void load();
}
function showCards(batch: Row) {
  tab.value = "cards";
  batchId.value = batch.id;
  q.value = "";
  page.value = 1;
  void load();
}
function resetBinding() {
  form.value.allowedSkuIds =
    chosen.value?.skus?.map((sku: Row) => sku.id) || [];
}
async function openForm(card?: Row, targets?: Row[]) {
  try {
    products.value = responseData<Row[]>(
      await api.get("/commerce-gift-products"),
    );
    binding.value = targets
      ? { ...card, ids: targets.map((row) => row.id), version: undefined }
      : card || null;
    form.value = {
      name: "",
      quantity: 10,
      productId: card?.productId || "",
      allowedSkuIds: [...(card?.allowedSkuIds || [])],
      expiresAt: card?.expiresAt || "",
    };
    generationKey = crypto.randomUUID();
    dialog.value = true;
  } catch (cause) {
    ElMessage.error(readableError(cause));
  }
}
let generationKey = "";
async function save() {
  if (busy.value) return;
  if (!form.value.productId || !form.value.allowedSkuIds.length)
    return ElMessage.warning("请选择商品及可兑换规格");
  busy.value = true;
  try {
    if (binding.value) {
      const { value: reason } = await ElMessageBox.prompt(
        binding.value.ids
          ? `将统一修改 ${binding.value.ids.length} 张卡的兑换商品及规格，请填写原因`
          : "填写改绑原因",
        "修改兑换商品",
        { inputPattern: /\S/, inputErrorMessage: "请填写原因" },
      );
      await api.post("/commerce-gift-cards/actions", {
        ...form.value,
        ids: binding.value.ids || [binding.value.id],
        version: binding.value.version,
        action: "BIND",
        reason,
      });
      ElMessage.success("已修改");
    } else {
      const result = responseData<Row>(
        await api.post(
          "/commerce-gift-batches",
          { ...form.value, requestKey: generationKey },
          { timeout: 120_000 },
        ),
      );
      if (!result.csv)
        ElMessage.warning(
          "该批次已生成，明文无法再次下载。若未保存，请作废原批次后重新生成。",
        );
      else {
        const url = URL.createObjectURL(
            new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
          ),
          anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        generated.value = { id: result.batchId, batchNo: result.batchNo };
        downloadSaved.value = false;
      }
    }
    dialog.value = false;
    await load();
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close")
      ElMessage.error(readableError(cause));
  } finally {
    busy.value = false;
  }
}
async function action(kind: string, target?: Row, batch = false) {
  if (busy.value) return;
  const names: Record<string, string> = { ACTIVATE: "启用", VOID: "作废" };
  try {
    const { value: reason } = await ElMessageBox.prompt(
      kind === "ACTIVATE"
        ? "确认已保存本批次明文文件后填写启用原因"
        : "填写作废原因。已兑换卡不会恢复或删除。",
      names[kind] + "兑换卡",
      { inputPattern: /\S/, inputErrorMessage: "请填写原因" },
    );
    busy.value = true;
    const result = responseData<Row>(
      await api.post("/commerce-gift-cards/actions", {
        action: kind,
        reason,
        downloadConfirmed: kind === "ACTIVATE",
        ...(batch
          ? { batchId: target?.id }
          : {
              ids: target ? [target.id] : selected.value.map((row) => row.id),
              ...(target ? { version: target.version } : {}),
            }),
      }),
    );
    ElMessage.success(`已${names[kind]} ${result.changed} 张`);
    generated.value = null;
    await load();
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close")
      ElMessage.error(readableError(cause));
  } finally {
    busy.value = false;
  }
}
async function showQr(card: Row) {
  try {
    qr.value = responseData<Row>(
      await api.get(`/commerce-gift-cards/${card.id}/qr`),
    );
  } catch (cause) {
    ElMessage.error(readableError(cause));
  }
}
async function toggle() {
  try {
    await ElMessageBox.confirm(
      enabled.value
        ? "暂停后将暂时不能新增兑换，原订单继续履约。"
        : "确认短信及订单流程已验收，开放用户兑换？",
      enabled.value ? "暂停礼品兑换" : "开放礼品兑换",
    );
    const value = responseData<Row>(
      await api.put("/commerce-gift-settings", { enabled: !enabled.value }),
    );
    enabled.value = value.enabled;
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close")
      ElMessage.error(readableError(cause));
  }
}
onMounted(async () => {
  await load();
  try {
    enabled.value = responseData<Row>(
      await api.get("/commerce-gift-settings"),
    ).enabled;
  } catch (cause) {
    error.value = readableError(cause);
  }
});
</script>

<template>
  <section class="page gifts-page">
    <div class="heading">
      <h1>礼品兑换</h1>
      <div>
        <el-tag :type="enabled ? 'success' : 'info'">{{
          enabled ? "兑换已开放" : "兑换暂未开放"
        }}</el-tag
        ><el-button v-if="writable" :disabled="busy" @click="toggle">{{
          enabled ? "暂停兑换" : "开放兑换"
        }}</el-button
        ><el-button
          v-if="writable"
          type="primary"
          :disabled="busy"
          @click="openForm()"
          >生成兑换卡</el-button
        >
      </div>
    </div>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
    />
    <el-tabs v-model="tab"
      ><el-tab-pane label="兑换卡" name="cards" /><el-tab-pane
        label="生成批次"
        name="batches" /><el-tab-pane label="兑换记录" name="records"
    /></el-tabs>
    <div class="toolbar">
      <el-input
        v-model="q"
        :placeholder="
          tab === 'records'
            ? '编号、卡号、验证手机号或订单号'
            : '搜索编号、卡号或批次名称'
        "
        clearable
        @keyup.enter="
          page = 1;
          load();
        "
      /><el-select
        v-if="tab === 'cards'"
        v-model="status"
        placeholder="全部状态"
        clearable
        @change="
          page = 1;
          load();
        "
        ><el-option
          v-for="(label, key) in labels"
          :key="key"
          :label="label"
          :value="key" /></el-select
      ><el-button
        @click="
          page = 1;
          load();
        "
        >查询 / 刷新</el-button
      ><el-button
        v-if="batchId"
        @click="
          batchId = '';
          page = 1;
          load();
        "
        >全部批次</el-button
      ><template v-if="writable && tab === 'cards' && selected.length"
        ><el-button
          :disabled="busy || selected.some((row) => row.status !== 'DRAFT')"
          @click="openForm(selected[0], selected)"
          >批量改绑商品</el-button
        ><el-button
          :disabled="busy || selected.some((row) => row.status !== 'DRAFT')"
          @click="action('ACTIVATE')"
          >确认已下载并启用</el-button
        ><el-button type="danger" plain :disabled="busy" @click="action('VOID')"
          >作废所选</el-button
        ></template
      >
    </div>
    <el-table
      key="cards"
      v-if="tab === 'cards'"
      v-loading="loading"
      :data="rows"
      border
      @selection-change="selected = $event"
    >
      <el-table-column
        v-if="writable"
        type="selection"
        width="44"
        :selectable="
          (row: Row) => ['DRAFT', 'ACTIVE', 'EXPIRED'].includes(row.status)
        "
      /><el-table-column label="编号 / 卡号" min-width="245"
        ><template #default="{ row }"
          ><b>{{ row.serialNo }}</b
          ><small
            >{{ row.cardNo }} · 发卡商品编号 {{ row.cardNo.slice(1, 3) }}</small
          ></template
        ></el-table-column
      ><el-table-column label="兑换商品" min-width="190"
        ><template #default="{ row }"
          >{{ row.product.displayName || row.product.name
          }}<small
            >{{ row.allowedSkuIds.length }} 个规格 · 兑换 1 件</small
          ></template
        ></el-table-column
      ><el-table-column label="批次" min-width="140"
        ><template #default="{ row }">{{
          row.batch.name
        }}</template></el-table-column
      ><el-table-column label="状态" width="95"
        ><template #default="{ row }"
          ><el-tag
            :type="
              row.status === 'REDEEMED'
                ? 'success'
                : row.status === 'ACTIVE'
                  ? 'primary'
                  : 'info'
            "
            >{{ labels[row.status] }}</el-tag
          ></template
        ></el-table-column
      ><el-table-column label="有效期" min-width="165"
        ><template #default="{ row }">{{
          stamp(row.expiresAt)
        }}</template></el-table-column
      ><el-table-column label="操作" width="210" fixed="right"
        ><template #default="{ row }"
          ><el-button v-if="writable" link @click="showQr(row)"
            >二维码</el-button
          ><el-button
            v-if="writable && row.status === 'DRAFT'"
            link
            @click="openForm(row)"
            >改绑</el-button
          ><el-button
            v-if="writable && row.status === 'DRAFT'"
            link
            :disabled="busy"
            @click="action('ACTIVATE', row)"
            >启用</el-button
          ><el-button
            v-if="
              writable && ['DRAFT', 'ACTIVE', 'EXPIRED'].includes(row.status)
            "
            link
            type="danger"
            :disabled="busy"
            @click="action('VOID', row)"
            >作废</el-button
          ><el-button
            v-if="row.redemption"
            link
            @click="
              router.push(
                '/commerce-orders?search=' +
                  encodeURIComponent(row.redemption.order.orderNo),
              )
            "
            >查看订单</el-button
          ></template
        ></el-table-column
      >
    </el-table>
    <el-table
      key="batches"
      v-else-if="tab === 'batches'"
      v-loading="loading"
      :data="rows"
      border
      ><el-table-column
        prop="batchNo"
        label="批次编号"
        min-width="235"
      /><el-table-column
        prop="name"
        label="名称"
        min-width="180"
      /><el-table-column label="数量" width="80"
        ><template #default="{ row }">{{
          row._count.cards
        }}</template></el-table-column
      ><el-table-column label="生成时间" min-width="165"
        ><template #default="{ row }">{{
          stamp(row.createdAt)
        }}</template></el-table-column
      ><el-table-column label="操作" min-width="250"
        ><template #default="{ row }"
          ><el-button link @click="showCards(row)">查看卡片</el-button
          ><el-button
            v-if="writable && !row.activatedAt"
            link
            :disabled="busy"
            @click="action('ACTIVATE', row, true)"
            >确认已下载并启用</el-button
          ><el-button
            v-if="writable"
            link
            type="danger"
            :disabled="busy"
            @click="action('VOID', row, true)"
            >作废未兑换卡</el-button
          ></template
        ></el-table-column
      ></el-table
    >
    <el-table key="records" v-else v-loading="loading" :data="rows" border
      ><el-table-column label="编号 / 卡号" min-width="240"
        ><template #default="{ row }"
          >{{ row.card.serialNo }}<small>{{ row.card.cardNo }}</small></template
        ></el-table-column
      ><el-table-column
        prop="memberNoSnapshot"
        label="会员编号"
        width="100"
      /><el-table-column
        prop="verifiedMobile"
        label="验证手机号"
        min-width="150"
      /><el-table-column label="兑换时间" min-width="170"
        ><template #default="{ row }">{{
          stamp(row.redeemedAt)
        }}</template></el-table-column
      ><el-table-column
        prop="clientIp"
        label="来源 IP"
        min-width="140"
      /><el-table-column label="订单" min-width="220"
        ><template #default="{ row }"
          ><el-button
            link
            @click="
              router.push(
                '/commerce-orders?search=' +
                  encodeURIComponent(row.order.orderNo),
              )
            "
            >{{ row.order.orderNo }}</el-button
          ></template
        ></el-table-column
      ><el-table-column label="详情" width="70"
        ><template #default="{ row }"
          ><el-button link @click="detail = row">查看</el-button></template
        ></el-table-column
      ></el-table
    >
    <el-pagination
      v-model:current-page="page"
      :page-size="20"
      :total="total"
      layout="prev, pager, next, total"
      @current-change="load"
    />
    <el-dialog
      v-model="dialog"
      :title="binding ? '修改兑换商品' : '生成兑换卡'"
      width="620px"
      :close-on-click-modal="false"
      ><el-form label-position="top"
        ><el-form-item v-if="!binding" label="批次名称" required
          ><el-input v-model="form.name" maxlength="80" /></el-form-item
        ><el-form-item
          v-if="!binding"
          label="生成数量（每批最多100张）"
          required
          ><el-input-number
            v-model="form.quantity"
            :min="1"
            :max="100" /></el-form-item
        ><el-form-item label="兑换商品" required
          ><el-select v-model="form.productId" filterable @change="resetBinding"
            ><el-option
              v-for="product in products"
              :key="product.id"
              :label="product.displayName || product.name"
              :value="product.id" /></el-select></el-form-item
        ><el-form-item label="允许兑换的规格" required
          ><el-checkbox-group v-model="form.allowedSkuIds"
            ><el-checkbox
              v-for="sku in chosen?.skus || []"
              :key="sku.id"
              :value="sku.id"
              >{{ sku.specification || "默认规格" }} · 库存
              {{ sku.stock }}</el-checkbox
            ></el-checkbox-group
          ></el-form-item
        ><el-form-item label="有效期（留空不限）"
          ><el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
            clearable /></el-form-item
        ><el-alert
          v-if="!binding"
          title="明文仅此次生成时下载，请保存好文件。确认下载后再启用卡片。"
          :closable="false"
          type="warning" /></el-form
      ><template #footer
        ><el-button :disabled="busy" @click="dialog = false">取消</el-button
        ><el-button type="primary" :loading="busy" @click="save">{{
          binding ? "保存修改" : "生成并下载"
        }}</el-button></template
      ></el-dialog
    >
    <el-dialog
      :model-value="!!generated"
      title="保存文件后启用"
      width="480px"
      :close-on-click-modal="false"
      @close="generated = null"
      ><p>
        已发起下载：{{
          generated?.batchNo
        }}.csv。请检查文件已保存且可打开；明文不能再次导出。
      </p>
      <el-checkbox v-model="downloadSaved"
        >我已保存明文文件，确认启用本批次</el-checkbox
      ><template #footer
        ><el-button @click="generated = null">稍后启用</el-button
        ><el-button
          type="primary"
          :disabled="!downloadSaved || busy"
          @click="action('ACTIVATE', generated!, true)"
          >启用兑换卡</el-button
        ></template
      ></el-dialog
    >
    <el-dialog
      :model-value="!!qr"
      title="兑换二维码"
      width="430px"
      @close="qr = null"
      ><div v-if="qr" class="qr">
        <img :src="qr.qrDataUrl" alt="兑换二维码" /><b>{{ qr.serialNo }}</b>
        <p>扫码后仍需输入校验码</p>
        <a :href="qr.qrDataUrl" :download="qr.serialNo + '.png'">下载二维码</a
        ><el-input :model-value="qr.link" readonly /></div
    ></el-dialog>
    <el-drawer
      :model-value="!!detail"
      title="兑换记录"
      size="520px"
      @close="detail = null"
      ><template v-if="detail"
        ><el-descriptions :column="1" border
          ><el-descriptions-item label="会员 ID">{{
            detail.userId
          }}</el-descriptions-item
          ><el-descriptions-item label="验证手机号">{{
            detail.verifiedMobile
          }}</el-descriptions-item
          ><el-descriptions-item label="验证时间">{{
            stamp(detail.verifiedAt)
          }}</el-descriptions-item
          ><el-descriptions-item label="兑换时间">{{
            stamp(detail.redeemedAt)
          }}</el-descriptions-item
          ><el-descriptions-item label="IP">{{
            detail.clientIp
          }}</el-descriptions-item
          ><el-descriptions-item label="商品"
            >{{ detail.productSnapshot.name }} ·
            {{ detail.productSnapshot.specification }}</el-descriptions-item
          ><el-descriptions-item label="收货人"
            >{{ detail.addressSnapshot.name }}
            {{ detail.addressSnapshot.mobile }}</el-descriptions-item
          ><el-descriptions-item label="地址"
            >{{ detail.addressSnapshot.province
            }}{{ detail.addressSnapshot.city
            }}{{ detail.addressSnapshot.district
            }}{{ detail.addressSnapshot.detail }}</el-descriptions-item
          ><el-descriptions-item label="订单">{{
            detail.order.orderNo
          }}</el-descriptions-item></el-descriptions
        ></template
      ></el-drawer
    >
  </section>
</template>
<style scoped>
.gifts-page {
  padding: 28px;
  max-width: 1600px;
}
.heading,
.heading > div,
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.heading {
  justify-content: space-between;
  margin-bottom: 16px;
}
.heading h1 {
  margin: 0;
}
.toolbar {
  margin: 10px 0 20px;
}
.toolbar .el-input {
  width: 300px;
}
.toolbar .el-select {
  width: 140px;
}
.el-pagination {
  margin-top: 20px;
}
small {
  display: block;
  color: #6b7280;
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.qr {
  display: grid;
  gap: 12px;
  justify-items: center;
}
.qr img {
  width: 240px;
  max-width: 100%;
}
.qr p {
  margin: 0;
  color: #687586;
}
.el-checkbox-group {
  display: grid;
  max-height: 240px;
  overflow: auto;
}
.el-checkbox {
  height: auto;
  white-space: normal;
  margin-bottom: 8px;
}
@media (max-width: 600px) {
  .gifts-page {
    padding: 16px;
  }
  .toolbar .el-input {
    width: 100%;
  }
}
</style>
