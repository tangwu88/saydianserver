<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { api, data, errorMessage, requestKey } from "../api";
import { money } from "../present";
import {
  readCheckout,
  saveCheckout,
  clearCheckout,
} from "../checkout-recovery";
import type { PartnerCheckoutInput } from "@saydian/app-contracts";
import axios from "axios";
const products = ref<any[]>([]),
  page = ref(1),
  total = ref(0),
  search = ref(""),
  level = ref(""),
  busy = ref(false),
  quantities = reactive<Record<string, number>>({}),
  quote = ref<any>(),
  checkout = ref(false),
  submitting = ref(false);
const address = reactive({
    recipientName: "",
    recipientMobile: "",
    countryCode: "CN",
    province: "",
    city: "",
    district: "",
    addressDetail: "",
    postalCode: "",
  }),
  buyerRemark = ref("");
const selected = computed(() =>
  Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([skuId, quantity]) => ({ skuId, quantity })),
);
const router = useRouter();
let checkoutKey = "",
  submittedRequest: PartnerCheckoutInput | null = null,
  partnerId = "";
async function load() {
  busy.value = true;
  try {
    const result = data(
      await api.get("/products", {
        params: { search: search.value, page: page.value },
      }),
    );
    products.value = result.items;
    total.value = result.total;
    level.value = result.level;
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try {
    partnerId = data(await api.get("/auth/me")).id;
    const pending = readCheckout(sessionStorage, partnerId);
    if (pending) {
      submittedRequest = pending.input;
      checkoutKey = pending.input.idempotencyKey;
      quote.value = pending.quote;
      Object.assign(address, pending.input.address);
      buyerRemark.value = pending.input.buyerRemark || "";
      checkout.value = true;
    }
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
  await load();
});
async function review() {
  if (submittedRequest) {
    checkout.value = true;
    return;
  }
  if (!selected.value.length) {
    ElMessage.info("请选择采购数量");
    return;
  }
  try {
    quote.value = data(await api.post("/quote", { items: selected.value }));
    checkoutKey = requestKey();
    submittedRequest = null;
    checkout.value = true;
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
}
async function purchase() {
  if (submitting.value) return;
  if (
    !address.recipientName ||
    !address.recipientMobile ||
    !address.province ||
    !address.city ||
    !address.addressDetail
  ) {
    ElMessage.warning("请填写完整收货信息");
    return;
  }
  submitting.value = true;
  // Retain one exact request through an uncertain network result; re-opening creates a fresh quote.
  submittedRequest ??= {
    items: quote.value.lines.map((line: any) => ({
      skuId: line.skuId,
      quantity: line.quantity,
    })),
    address: { ...address },
    buyerRemark: buyerRemark.value,
    expectedQuote: quote.value.fingerprint,
    idempotencyKey: checkoutKey,
  };
  saveCheckout(sessionStorage, {
    partnerId,
    input: submittedRequest,
    quote: quote.value,
  });
  try {
    await api.post("/orders", submittedRequest);
    clearCheckout(sessionStorage, partnerId, checkoutKey);
    submittedRequest = null;
    ElMessage.success("采购成功，已从余额扣款");
    checkout.value = false;
    Object.keys(quantities).forEach((key) => delete quantities[key]);
    await router.push("/orders");
  } catch (cause) {
    if (
      axios.isAxiosError(cause) &&
      [400, 404, 409, 422].includes(cause.response?.status ?? 0)
    ) {
      clearCheckout(sessionStorage, partnerId, checkoutKey);
      submittedRequest = null;
    }
    ElMessage.error(errorMessage(cause));
  } finally {
    submitting.value = false;
  }
}
</script>
<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>分销采购</h1>
        <p>按当前分销等级价格采购，付款后进入发货流程</p>
      </div>
      <el-tag type="info">{{ level || "正在加载等级" }}</el-tag>
    </div>
    <div class="panel">
      <form
        class="toolbar"
        @submit.prevent="
          page = 1;
          load();
        "
      >
        <el-input
          v-model="search"
          clearable
          placeholder="搜索商品"
          style="max-width: 320px"
        /><el-button native-type="submit" type="primary">查询</el-button
        ><router-link to="/wallet"
          ><el-button>余额与充值</el-button></router-link
        >
      </form>
      <div class="product-list" v-loading="busy">
        <article v-for="product in products" :key="product.id" class="product">
          <img
            v-if="product.coverImage"
            :src="product.coverImage"
            :alt="product.name"
          />
          <div v-else class="product-placeholder">SAYDIAN</div>
          <div class="product-main">
            <h2>{{ product.name }}</h2>
            <el-tag size="small" type="info">{{
              product.fulfillmentSource === "LOCAL" ? "自营商品" : "统一供货"
            }}</el-tag>
            <p class="muted">{{ product.subtitle }}</p>
            <div v-for="sku in product.skus" :key="sku.id" class="sku-row">
              <span
                >{{ sku.specification || "默认规格"
                }}<small v-if="sku.stock < 0">付款后安排补货</small></span
              ><b :class="{ price: sku.purchasable }">{{
                sku.purchasable
                  ? money(sku.distributionPriceCents)
                  : "暂未设置分销价"
              }}</b
              ><el-input-number
                v-if="sku.purchasable"
                v-model="quantities[sku.id]"
                :min="0"
                :max="9999"
                :precision="0"
                controls-position="right"
                size="small"
                aria-label="采购数量"
              /><span v-else class="muted">暂不可采购</span>
            </div>
            <p v-if="!product.skus.length" class="muted">暂无可采购规格</p>
          </div>
        </article>
        <el-empty v-if="!products.length && !busy" description="暂无商品" />
      </div>
      <el-pagination
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
    <div class="checkout-bar">
      <span>已选 {{ selected.length }} 个规格</span
      ><el-button
        type="primary"
        size="large"
        :disabled="!selected.length && !submittedRequest"
        @click="review"
        >确认采购 →</el-button
      >
    </div>
    <el-dialog
      v-model="checkout"
      title="确认采购订单"
      width="780px"
      :close-on-click-modal="false"
      ><template v-if="quote"
        ><el-alert
          v-if="submittedRequest"
          title="请继续核对上次采购请求，避免重复下单。"
          type="warning"
          :closable="false"
          style="margin-bottom: 12px"
        /><el-alert
          :title="`当前分销等级：${quote.level}，订单将使用余额付款`"
          type="info"
          :closable="false"
        /><el-table :data="quote.lines" style="margin: 18px 0"
          ><el-table-column
            prop="name"
            label="商品"
            min-width="150"
          /><el-table-column
            prop="specification"
            label="规格"
          /><el-table-column
            prop="quantity"
            label="数量"
            width="75"
          /><el-table-column label="金额" width="130"
            ><template #default="scope">{{
              money(scope.row.totalCents)
            }}</template></el-table-column
          ></el-table
        ><el-form
          label-position="top"
          :disabled="submitting || !!submittedRequest"
          ><el-row :gutter="16"
            ><el-col :span="12"
              ><el-form-item label="收货人"
                ><el-input
                  v-model="address.recipientName"
                  maxlength="80" /></el-form-item></el-col
            ><el-col :span="12"
              ><el-form-item label="手机号"
                ><el-input
                  v-model="address.recipientMobile"
                  maxlength="30" /></el-form-item></el-col
            ><el-col :span="8"
              ><el-form-item label="省份"
                ><el-input
                  v-model="address.province"
                  maxlength="80" /></el-form-item></el-col
            ><el-col :span="8"
              ><el-form-item label="城市"
                ><el-input
                  v-model="address.city"
                  maxlength="80" /></el-form-item></el-col
            ><el-col :span="8"
              ><el-form-item label="区县"
                ><el-input
                  v-model="address.district"
                  maxlength="80" /></el-form-item></el-col></el-row
          ><el-form-item label="详细地址"
            ><el-input
              v-model="address.addressDetail"
              maxlength="300" /></el-form-item
          ><el-form-item label="订单备注"
            ><el-input v-model="buyerRemark" maxlength="500" /></el-form-item
        ></el-form>
        <div class="quote-totals">
          <span
            >商品 {{ money(quote.subtotalCents) }} + 运费
            {{ money(quote.shippingCents) }}</span
          ><strong>合计 {{ money(quote.payableCents) }}</strong>
        </div></template
      ><template #footer
        ><el-button :disabled="submitting" @click="checkout = false"
          >返回</el-button
        ><el-button type="primary" :loading="submitting" @click="purchase"
          >确认并支付</el-button
        ></template
      ></el-dialog
    >
  </section>
</template>
<style scoped>
.product {
  display: flex;
  gap: 22px;
  padding: 26px 0;
  border-bottom: 1px solid #e8ebf1;
}
.product:first-child {
  padding-top: 8px;
}
.product > img,
.product-placeholder {
  width: 130px;
  height: 130px;
  object-fit: contain;
  background: #f8f9fb;
  border-radius: 10px;
}
.product-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9da6b5;
  font-size: 13px;
}
.product-main {
  flex: 1;
  min-width: 0;
}
.product-main h2 {
  margin-bottom: 8px;
}
.product-main > p {
  font-size: 12px;
}
.sku-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 180px 125px;
  gap: 18px;
  align-items: center;
  padding: 12px 0;
  font-size: 14px;
}
.sku-row small {
  display: block;
  color: #b08044;
  font-size: 11px;
  margin-top: 6px;
}
.checkout-bar {
  position: sticky;
  bottom: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  background: white;
  padding: 18px 24px;
  border: 1px solid #e8ebf1;
  border-radius: 12px;
  box-shadow: 0 4px 20px #18212f0a;
}
.quote-totals {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-top: 18px;
  font-size: 13px;
}
.quote-totals strong {
  color: #c9223b;
  font-size: 22px;
}
@media (max-width: 760px) {
  .product {
    flex-direction: column;
  }
  .product > img {
    width: 90px;
    height: 90px;
  }
  .sku-row {
    grid-template-columns: 1fr 120px;
    gap: 10px;
  }
  .sku-row > span:first-child {
    grid-column: 1 / -1;
  }
  .sku-row b {
    font-size: 13px;
  }
  .quote-totals {
    flex-direction: column;
    align-items: flex-end;
  }
}
</style>
