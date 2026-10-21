<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import {
  Search,
  ShoppingCart,
  Delete,
  Wallet,
  Picture,
  MagicStick,
  Location,
} from "@element-plus/icons-vue";
import { api, data, errorMessage, requestKey } from "../api";
import { money } from "../present";
import {
  readCheckout,
  saveCheckout,
  clearCheckout,
} from "../checkout-recovery";
import {
  addressFields,
  addressError,
  isDefiniteOrderFailure,
} from "../checkout-form";
import type {
  PartnerCheckoutInput,
  PartnerQuoteContract,
} from "@saydian/app-contracts";
import PageError from "../components/PageError.vue";
import EmptyState from "../components/EmptyState.vue";
import axios from "axios";
import {
  recognizeAddress,
  type RecognizedAddress,
} from "../address-recognition";
type PurchaseConfirmation = {
  input: PartnerCheckoutInput;
  quote: PartnerQuoteContract;
  balanceCents: number | undefined;
  resuming: boolean;
};
const products = ref<any[]>([]),
  page = ref(1),
  pageSize = ref(10),
  categoryId = ref(""),
  categories = ref<any[]>([]),
  total = ref(0),
  search = ref(""),
  level = ref(""),
  busy = ref(false),
  reviewing = ref(false),
  quantities = reactive<Record<string, number>>({}),
  catalog = reactive<Record<string, any>>({}),
  quote = ref<any>(),
  checkout = ref(false),
  submitting = ref(false),
  preparingPurchase = ref(false),
  paymentReview = ref<PurchaseConfirmation | null>(null),
  error = ref(""),
  checkoutError = ref(""),
  quoteStale = ref(false),
  balance = ref<number>(),
  submittedRequest = ref<PartnerCheckoutInput | null>(null),
  addressForm = ref<FormInstance>();
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
const pastedAddress = ref(""),
  addressNotice = ref(""),
  addressIncomplete = ref(false);
const previousAddress = ref<RecognizedAddress>();
function fillAddress() {
  if (
    submitting.value ||
    preparingPurchase.value ||
    paymentReview.value ||
    submittedRequest.value
  )
    return;
  const result = recognizeAddress(pastedAddress.value);
  if (result.error || !result.recognized) {
    addressIncomplete.value = true;
    addressNotice.value =
      result.error || "暂未识别，请检查内容或在下方手动填写";
    return;
  }
  previousAddress.value = { ...address };
  // Replace the entire recipient: never mix a new address with the old person's phone.
  Object.assign(address, result.fields);
  addressForm.value?.clearValidate();
  addressIncomplete.value =
    result.missing.length > 0 || result.warnings.length > 0;
  addressNotice.value = result.missing.length
    ? `已填写识别到的信息，还需补充：${result.missing.join("、")}`
    : result.warnings.join("；") || "已自动填写，请核对收货信息";
}
function undoAddress() {
  if (
    submitting.value ||
    preparingPurchase.value ||
    paymentReview.value ||
    submittedRequest.value ||
    !previousAddress.value
  )
    return;
  Object.assign(address, previousAddress.value);
  previousAddress.value = undefined;
  addressNotice.value = "";
  addressForm.value?.clearValidate();
}
const rules: FormRules = Object.fromEntries(
  addressFields.map((field) => [
    field,
    [
      {
        required: true,
        trigger: "blur",
        validator: (
          _rule: unknown,
          value: unknown,
          done: (error?: Error) => void,
        ) => {
          const error = addressError(field, value);
          done(error ? new Error(error) : undefined);
        },
      },
    ],
  ]),
);
const selected = computed(() =>
  Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([skuId, quantity]) => ({ skuId, quantity })),
);
const itemCount = computed(() =>
  selected.value.reduce((sum, item) => sum + item.quantity, 0),
);
const subtotal = computed(() =>
  selected.value.reduce(
    (sum, item) =>
      sum + (catalog[item.skuId]?.distributionPriceCents ?? 0) * item.quantity,
    0,
  ),
);
const insufficient = computed(
  () =>
    balance.value != null &&
    quote.value &&
    balance.value < quote.value.payableCents,
);
const confirmationVisible = computed({
  get: () => paymentReview.value !== null,
  set: (visible) => {
    if (!visible) cancelPurchaseConfirmation();
  },
});
const confirmationCount = computed(
  () =>
    paymentReview.value?.input.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    ) ?? 0,
);
const confirmationAddress = computed(() => {
  const address = paymentReview.value?.input.address;
  if (!address) return "";
  return [
    address.province,
    address.city === address.province ? "" : address.city,
    address.district,
    address.addressDetail,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(" ");
});
const router = useRouter();
let checkoutKey = "",
  partnerId = "",
  listRequest = 0,
  alive = true;
onBeforeUnmount(() => {
  alive = false;
  listRequest++;
});
async function filterProducts() {
  page.value = 1;
  await load();
}
async function changePagination(nextPage: number, nextSize: number) {
  if (page.value === nextPage && pageSize.value === nextSize) return;
  page.value = nextSize === pageSize.value ? nextPage : 1;
  pageSize.value = nextSize;
  await load();
}
async function load() {
  const request = ++listRequest;
  busy.value = true;
  error.value = "";
  try {
    const result = data(
      await api.get("/products", {
        params: { search: search.value, page: page.value, pageSize: pageSize.value, categoryId: categoryId.value },
      }),
    );
    if (request !== listRequest) return;
    categories.value = result.categories ?? [];
    products.value = result.items;
    total.value = result.total;
    level.value = result.level;
    for (const product of products.value)
      for (const sku of product.skus) {
        catalog[sku.id] = { ...sku, name: sku.name ?? product.name };
        quantities[sku.id] ??= 0;
      }
  } catch (cause) {
    if (request === listRequest) {
      products.value = [];
      total.value = 0;
      error.value = errorMessage(cause);
    }
  } finally {
    if (request === listRequest) busy.value = false;
  }
}
onMounted(async () => {
  try {
    partnerId = data(await api.get("/auth/me")).id;
    const pending = readCheckout(sessionStorage, partnerId);
    if (pending) {
      submittedRequest.value = pending.input;
      checkoutKey = pending.input.idempotencyKey;
      quote.value = pending.quote;
      Object.assign(address, pending.input.address);
      buyerRemark.value = pending.input.buyerRemark || "";
      for (const item of pending.input.items)
        quantities[item.skuId] = item.quantity;
      checkout.value = true;
    }
    balance.value = data(await api.get("/wallet")).balanceCents;
  } catch (cause) {
    error.value = errorMessage(cause);
  }
  if (alive) await load();
});
function available(product: any) {
  return product.skus.filter((sku: any) => sku.purchasable);
}
function productPrice(product: any) {
  const values = available(product).map(
    (sku: any) => sku.distributionPriceCents as number,
  );
  if (!values.length) return "暂无合作价";
  const min = Math.min(...values),
    max = Math.max(...values);
  return min === max ? money(min) : `${money(min)} ~ ${money(max)}`;
}
function selectedCount(product: any) {
  return product.skus.reduce(
    (sum: number, sku: any) => sum + (quantities[sku.id] || 0),
    0,
  );
}
async function review() {
  if (
    reviewing.value ||
    submitting.value ||
    preparingPurchase.value ||
    paymentReview.value
  )
    return;
  if (submittedRequest.value) {
    checkout.value = true;
    return;
  }
  if (!selected.value.length) {
    ElMessage.info("请先选择商品数量");
    return;
  }
  reviewing.value = true;
  checkoutError.value = "";
  try {
    if (!partnerId) partnerId = data(await api.get("/auth/me")).id;
    const [quoted, wallet] = await Promise.all([
      api.post("/quote", { items: selected.value }),
      api.get("/wallet"),
    ]);
    if (!alive) return;
    quote.value = data(quoted);
    balance.value = data(wallet).balanceCents;
    checkoutKey = requestKey();
    quoteStale.value = false;
    checkout.value = true;
  } catch (cause) {
    checkoutError.value = errorMessage(cause);
    ElMessage.error(checkoutError.value);
  } finally {
    reviewing.value = false;
  }
}
function clearCart() {
  if (submittedRequest.value || paymentReview.value || submitting.value) return;
  resetCart();
}
function resetCart() {
  Object.keys(quantities).forEach((key) => delete quantities[key]);
}
function cancelPurchaseConfirmation() {
  if (!submitting.value) paymentReview.value = null;
}
async function preparePurchase() {
  if (
    submitting.value ||
    preparingPurchase.value ||
    paymentReview.value ||
    !quote.value ||
    quoteStale.value ||
    !partnerId
  )
    return;
  preparingPurchase.value = true;
  checkoutError.value = "";
  try {
    if (!submittedRequest.value) {
      if (!(await addressForm.value?.validate().catch(() => false))) return;
      if (!alive) return;
      if (balance.value == null || insufficient.value) {
        checkoutError.value = "余额不足，请先充值";
        return;
      }
    }
    const input: PartnerCheckoutInput = submittedRequest.value || {
      items: quote.value.lines.map((line: any) => ({
        skuId: line.skuId,
        quantity: line.quantity,
      })),
      address: { ...address },
      buyerRemark: buyerRemark.value,
      expectedQuote: quote.value.fingerprint,
      idempotencyKey: checkoutKey,
    };
    // Confirm and send the same snapshot, including during payment recovery.
    paymentReview.value = {
      input: JSON.parse(JSON.stringify(input)),
      quote: JSON.parse(JSON.stringify(quote.value)),
      balanceCents: balance.value,
      resuming: !!submittedRequest.value,
    };
  } finally {
    preparingPurchase.value = false;
  }
}
async function purchase() {
  if (
    submitting.value ||
    !paymentReview.value ||
    !partnerId ||
    quoteStale.value
  )
    return;
  const approved = paymentReview.value;
  submitting.value = true;
  checkoutError.value = "";
  try {
    if (!submittedRequest.value) {
      if (approved.resuming) return;
      try {
        saveCheckout(sessionStorage, {
          partnerId,
          input: approved.input,
          quote: approved.quote,
        });
      } catch {
        checkoutError.value = "浏览器无法保存订单状态，请允许本站存储后再付款";
        return;
      }
      submittedRequest.value = approved.input;
    }
    await api.post("/orders", submittedRequest.value);
    try {
      clearCheckout(sessionStorage, partnerId, checkoutKey);
    } catch {}
    submittedRequest.value = null;
    checkout.value = false;
    paymentReview.value = null;
    resetCart();
    ElMessage.success("采购成功，已从余额扣款");
    await router.push("/orders");
  } catch (cause) {
    if (
      axios.isAxiosError(cause) &&
      isDefiniteOrderFailure(cause.response?.status)
    ) {
      try {
        clearCheckout(sessionStorage, partnerId, checkoutKey);
      } catch {}
      submittedRequest.value = null;
      quoteStale.value = true;
    }
    checkoutError.value = errorMessage(cause);
  } finally {
    submitting.value = false;
    paymentReview.value = null;
  }
}
</script>
<template>
  <section class="page products-page">
    <div class="page-head">
      <h1>商品采购</h1>
      <el-tag v-if="level" type="info">{{ level }} · 合作价</el-tag>
    </div>
    <PageError :message="error" @retry="load" />
    <div class="panel catalog-panel">
      <form
        class="toolbar"
        @submit.prevent="
          page = 1;
          load();
        "
      >
        <el-input
          v-model="search"
          :prefix-icon="Search"
          clearable
          placeholder="搜索商品名称"
          aria-label="搜索商品名称"
          style="max-width: 320px"
          @clear="
            page = 1;
            load();
          "
        /><el-select v-model="categoryId" clearable filterable placeholder="全部分类" aria-label="商品分类" style="width: 220px" @change="filterProducts">
          <el-option label="未分类" value="uncategorized" />
          <el-option v-for="category in categories" :key="category.id" :label="category.label" :value="category.id" />
        </el-select><el-button native-type="submit" type="primary">搜索</el-button
        ><router-link to="/wallet" class="wallet-link"
          ><el-icon><Wallet /></el-icon>余额 {{ money(balance) }}</router-link
        >
      </form>
      <div v-loading="busy">
        <article v-for="product in products" :key="product.id" class="product">
          <img
            v-if="product.coverImage"
            :src="product.coverImage"
            :alt="product.name"
            loading="lazy"
          /><el-icon v-else class="product-placeholder"><Picture /></el-icon>
          <div class="product-main">
            <h2>{{ product.name }}</h2>
            <p v-if="product.fulfillmentSource === 'ERP'" class="muted">
              款式：{{ product.erpItemId }}
            </p>
            <details class="product-specs" :open="product.skus.length === 1">
              <summary>
                <span
                  >{{ available(product).length }} 个规格 ·
                  {{ productPrice(product) }}</span
                ><span
                  >{{
                    selectedCount(product)
                      ? `已选 ${selectedCount(product)} 件 · `
                      : ""
                  }}选择规格与数量</span
                >
              </summary>
              <div
                v-for="sku in available(product)"
                :key="sku.id"
                class="sku-row"
              >
                <div class="sku-description">
                  {{
                    sku.name && sku.name !== product.name
                      ? sku.name + " · "
                      : ""
                  }}{{ sku.specification || "默认规格" }}
                  <small v-if="sku.retailPriceCents != null"
                    >零售价 {{ money(sku.retailPriceCents) }}</small
                  >
                  <small v-if="sku.stock <= 0">可下单，需安排补货</small>
                </div>
                <b class="price">{{ money(sku.distributionPriceCents) }}</b
                ><el-input-number
                  v-model="quantities[sku.id]"
                  :min="0"
                  :max="9999"
                  :precision="0"
                  :disabled="!!submittedRequest"
                  :aria-label="`${sku.name || product.name} ${sku.specification || '默认规格'} 数量`"
                />
              </div>
              <details
                v-if="product.skus.some((sku: any) => !sku.purchasable)"
                class="quiet-details"
              >
                <summary>
                  {{ product.skus.length - available(product).length }}
                  个规格暂不可采购
                </summary>
                <p
                  v-for="sku in product.skus.filter(
                    (sku: any) => !sku.purchasable,
                  )"
                  :key="sku.id"
                >
                  {{ sku.specification || "默认规格" }} · 暂无合作价
                </p>
              </details>
              <p v-if="!product.skus.length" class="muted">暂无可采购规格</p>
            </details>
          </div>
        </article>
        <EmptyState
          v-if="!products.length && !busy && !error"
          :title="search ? '未找到相关商品' : '暂无可采购商品'"
          :description="
            search ? '试试其他名称，或清空搜索。' : '可联系赛电开通商品合作价。'
          "
        />
      </div>
      <el-pagination
        :current-page="page"
        :total="total"
        :page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :disabled="busy"
        layout="total, sizes, prev, pager, next"
        @current-change="changePagination($event, pageSize)"
        @size-change="changePagination(1, $event)"
      />
    </div>
    <div class="checkout-bar">
      <div>
        <span>已选 {{ itemCount }} 件</span
        ><strong v-if="itemCount">商品小计 {{ money(subtotal) }}</strong>
      </div>
      <div class="button-row">
        <el-button
          v-if="itemCount && !submittedRequest"
          class="clear-cart"
          text
          :icon="Delete"
          aria-label="清空已选商品"
          @click="clearCart"
          ><span>清空</span></el-button
        ><el-button
          type="primary"
          size="large"
          :icon="ShoppingCart"
          :loading="reviewing"
          :disabled="!selected.length && !submittedRequest"
          @click="review"
          >{{ submittedRequest ? "核对上次订单" : "去结算" }}</el-button
        >
      </div>
    </div>
    <el-dialog
      v-model="checkout"
      class="mobile-sheet checkout-sheet"
      title="确认订单"
      width="760px"
      :close-on-click-modal="false"
      :close-on-press-escape="
        !submitting && !paymentReview && !preparingPurchase
      "
      :show-close="!submitting && !paymentReview && !preparingPurchase"
    >
      <template v-if="quote">
        <el-alert
          v-if="submittedRequest"
          title="上次付款结果待确认，请核对原订单，避免重复付款。"
          type="warning"
          :closable="false"
          class="section-space"
        />
        <div
          v-for="line in quote.lines"
          :key="line.skuId"
          class="checkout-item"
        >
          <div>
            <b>{{ line.name }}</b
            ><small
              >{{ line.specification || "默认规格" }} ·
              {{ money(line.unitPriceCents) }} × {{ line.quantity }}</small
            >
          </div>
          <strong>{{ money(line.totalCents) }}</strong>
        </div>
        <h2 class="address-title">收货地址</h2>
        <div class="address-recognition">
          <label for="paste-address">粘贴地址，快速填写</label>
          <el-input
            id="paste-address"
            v-model="pastedAddress"
            type="textarea"
            :rows="2"
            maxlength="1000"
            placeholder="例：张三 13800138000 广东省深圳市南山区科技园路8号2栋1201"
            :disabled="
              submitting ||
              preparingPurchase ||
              !!paymentReview ||
              !!submittedRequest
            "
          />
          <div class="button-row">
            <el-button
              :icon="MagicStick"
              type="primary"
              plain
              :disabled="
                !pastedAddress.trim() ||
                submitting ||
                preparingPurchase ||
                !!paymentReview ||
                !!submittedRequest
              "
              @click="fillAddress"
              >识别并填写</el-button
            >
            <el-button
              v-if="previousAddress"
              text
              :disabled="
                submitting ||
                preparingPurchase ||
                !!paymentReview ||
                !!submittedRequest
              "
              @click="undoAddress"
              >撤销填写</el-button
            >
          </div>
          <p
            v-if="addressNotice"
            :class="['address-notice', { 'inline-error': addressIncomplete }]"
            role="status"
          >
            {{ addressNotice }}
          </p>
        </div>
        <el-form
          ref="addressForm"
          :model="address"
          :rules="rules"
          scroll-to-error
          label-position="top"
          :disabled="
            submitting ||
            preparingPurchase ||
            !!paymentReview ||
            !!submittedRequest
          "
          ><div class="address-grid">
            <el-form-item label="收货人" prop="recipientName" required
              ><el-input
                v-model="address.recipientName"
                maxlength="80"
                autocomplete="shipping name" /></el-form-item
            ><el-form-item label="联系电话" prop="recipientMobile" required
              ><el-input
                v-model="address.recipientMobile"
                maxlength="30"
                inputmode="tel"
                autocomplete="shipping tel" /></el-form-item
            ><el-form-item label="省份" prop="province" required
              ><el-input
                v-model="address.province"
                maxlength="80"
                placeholder="如：广东省"
                autocomplete="shipping address-level1" /></el-form-item
            ><el-form-item label="城市" prop="city" required
              ><el-input
                v-model="address.city"
                maxlength="80"
                placeholder="如：深圳市"
                autocomplete="shipping address-level2" /></el-form-item
            ><el-form-item label="区县"
              ><el-input
                v-model="address.district"
                maxlength="80"
                placeholder="如：南山区"
            /></el-form-item>
          </div>
          <el-form-item label="详细地址" prop="addressDetail" required
            ><el-input
              v-model="address.addressDetail"
              maxlength="300"
              placeholder="街道、楼栋、门牌号"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              autocomplete="shipping street-address" /></el-form-item
          ><el-form-item label="备注（选填）"
            ><el-input v-model="buyerRemark" maxlength="500" /></el-form-item
        ></el-form>
        <div class="quote-totals">
          <span
            >商品 {{ money(quote.subtotalCents) }} + 运费
            {{ money(quote.shippingCents) }}</span
          ><strong>合计 {{ money(quote.payableCents) }}</strong>
        </div>
        <p class="balance-note">
          余额 {{ money(balance)
          }}<template v-if="!insufficient && balance != null">
            · 付款后 {{ money(balance - quote.payableCents) }}</template
          >
        </p>
        <el-alert
          v-if="insufficient && !submittedRequest"
          :title="`余额不足，还差 ${money(quote.payableCents - (balance ?? 0))}。充值后点击更新报价。`"
          type="warning"
          :closable="false"
          show-icon
        />
        <p v-if="checkoutError" class="inline-error" role="alert">
          {{ checkoutError }}
        </p>
      </template>
      <template #footer
        ><div class="button-row checkout-actions">
          <el-button
            :disabled="submitting || preparingPurchase || !!paymentReview"
            @click="checkout = false"
            >继续选购</el-button
          ><a
            v-if="insufficient && !submittedRequest"
            href="/vip/wallet"
            target="_blank"
            rel="noopener"
            class="action-link"
            >打开充值页</a
          ><el-button
            v-if="(quoteStale || insufficient) && !submittedRequest"
            :loading="reviewing"
            @click="review"
            >更新报价与余额</el-button
          ><el-button
            type="primary"
            :loading="submitting || preparingPurchase"
            :disabled="
              !submittedRequest &&
              (insufficient || quoteStale || balance == null)
            "
            @click="preparePurchase"
            >{{
              submittedRequest
                ? "核对原订单"
                : `余额支付 ${money(quote?.payableCents)}`
            }}</el-button
          >
        </div></template
      >
    </el-dialog>
    <el-dialog
      v-model="confirmationVisible"
      class="mobile-sheet confirmation-sheet"
      :title="paymentReview?.resuming ? '核对原订单' : '确认付款'"
      width="620px"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
    >
      <template v-if="paymentReview">
        <el-alert
          v-if="paymentReview.resuming"
          title="核对上次付款结果"
          type="warning"
          :closable="false"
          class="section-space"
        />
        <div class="confirmation-recipient">
          <el-icon><Location /></el-icon>
          <div>
            <b>{{ paymentReview.input.address.recipientName }}</b>
            <span>{{ paymentReview.input.address.recipientMobile }}</span>
            <p>{{ confirmationAddress }}</p>
          </div>
        </div>
        <div class="confirmation-heading">
          <h2>采购商品</h2>
          <span>共 {{ confirmationCount }} 件</span>
        </div>
        <div
          v-for="line in paymentReview.quote.lines"
          :key="line.skuId"
          class="checkout-item"
        >
          <div>
            <b>{{ line.name }}</b
            ><small
              >{{ line.specification || "默认规格" }} ·
              {{ money(line.unitPriceCents) }} × {{ line.quantity }}</small
            >
          </div>
          <strong>{{ money(line.totalCents) }}</strong>
        </div>
        <p v-if="paymentReview.input.buyerRemark" class="confirmation-remark">
          备注：{{ paymentReview.input.buyerRemark }}
        </p>
        <div class="quote-totals">
          <span
            >商品 {{ money(paymentReview.quote.subtotalCents) }} + 运费
            {{ money(paymentReview.quote.shippingCents) }}</span
          >
          <strong>合计 {{ money(paymentReview.quote.payableCents) }}</strong>
        </div>
        <p v-if="paymentReview.balanceCents != null" class="balance-note">
          当前余额 {{ money(paymentReview.balanceCents)
          }}<template v-if="!paymentReview.resuming">
            · 付款后
            {{
              money(
                paymentReview.balanceCents - paymentReview.quote.payableCents,
              )
            }}</template
          >
        </p>
      </template>
      <template #footer>
        <div class="button-row checkout-actions">
          <el-button
            :disabled="submitting"
            @click="cancelPurchaseConfirmation"
            >{{ paymentReview?.resuming ? "返回" : "返回修改" }}</el-button
          >
          <el-button type="primary" :loading="submitting" @click="purchase">{{
            paymentReview?.resuming
              ? "确认核对原订单"
              : `确认付款并下单 ${money(paymentReview?.quote.payableCents)}`
          }}</el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>
<style scoped>
.catalog-panel :deep(.el-pagination) { flex-wrap: wrap; gap: 8px; }
.product-specs > summary {
  cursor: pointer;
  color: #355773;
  padding: 12px 0;
  line-height: 1.8;
}
.product-specs > summary span {
  display: block;
}
.product-specs > summary span + span {
  font-size: 13px;
}
.confirmation-recipient {
  display: flex;
  gap: 12px;
  padding: 18px;
  background: #f5f6f9;
  border-radius: 10px;
  overflow-wrap: anywhere;
}
.confirmation-recipient .el-icon {
  margin-top: 3px;
  color: #b82237;
}
.confirmation-recipient span {
  margin-left: 14px;
}
.confirmation-recipient p {
  margin: 8px 0 0;
  line-height: 1.6;
}
.confirmation-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
}
.confirmation-heading h2 {
  font-size: 16px;
  margin: 0;
}
.confirmation-heading span {
  color: #667085;
}
.confirmation-remark {
  overflow-wrap: anywhere;
  color: #667085;
  line-height: 1.6;
}
.wallet-link {
  margin-left: auto;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.product {
  display: flex;
  gap: 20px;
  padding: 24px 0;
  border-bottom: 1px solid #edf0f4;
}
.product > img,
.product-placeholder {
  width: 100px;
  height: 100px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 9px;
  background: #f8f9fb;
}
.product-placeholder {
  font-size: 36px;
  color: #94a0b2;
}
.product-main {
  flex: 1;
  min-width: 0;
}
.product-main h2 {
  font-size: 17px;
  line-height: 1.6;
  margin-bottom: 10px;
}
.sku-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 150px;
  gap: 14px;
  align-items: center;
  padding: 12px 0;
  font-size: 14px;
}
.sku-row small {
  display: block;
  color: #8a6127;
  margin-top: 5px;
  font-size: 12px;
}
.sku-row .el-input-number {
  width: 150px;
}
.checkout-bar {
  position: sticky;
  bottom: 12px;
  background: #fff;
  border: 1px solid #dce1e9;
  border-radius: 12px;
  box-shadow: 0 4px 20px #18212f12;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.checkout-bar strong {
  display: block;
  font-size: 14px;
  color: #b82237;
  margin-top: 5px;
}
.checkout-item {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid #edf0f4;
  font-size: 14px;
}
.checkout-item small {
  display: block;
  color: #637084;
  margin-top: 6px;
}
.checkout-item > strong {
  white-space: nowrap;
}
.address-title {
  margin-top: 24px;
  font-size: 18px;
}
.address-recognition {
  display: grid;
  gap: 10px;
  padding: 16px;
  margin-bottom: 20px;
  border: 1px solid #e5e7ec;
  border-radius: 10px;
  background: #f5f6f9;
}
.address-recognition label {
  font-weight: 600;
}
.address-notice {
  margin: 0;
  font-size: 13px;
}
.address-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}
.quote-totals {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.quote-totals strong {
  font-size: 23px;
  color: #bc2038;
}
.balance-note {
  font-size: 13px;
  text-align: right;
  color: #637084;
  margin-top: 12px;
}
.checkout-actions {
  justify-content: flex-end;
}
.inline-error {
  color: #af302c;
  line-height: 1.6;
  margin: 14px 0 0;
}
@media (max-width: 720px) {
  .product > img,
  .product-placeholder {
    width: 72px;
    height: 72px;
  }
  .product {
    gap: 12px;
  }
  .sku-row {
    grid-template-columns: 1fr 140px;
    gap: 10px;
  }
  .sku-row > .sku-description {
    grid-column: 1/-1;
  }
  .product-main h2 {
    font-size: 15px;
  }
  .checkout-bar {
    padding: 12px;
  }
  .checkout-bar .button-row {
    gap: 0;
  }
  .wallet-link {
    margin-left: 0;
  }
  .address-grid {
    gap: 0 12px;
  }
}
@media (max-width: 420px) {
  .product {
    flex-wrap: wrap;
  }
  .product-main {
    flex-basis: 100%;
  }
  .checkout-bar .el-button {
    padding: 10px;
  }
  .address-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px), (max-width: 950px) and (max-height: 500px) {
  .products-page {
    padding-bottom: 88px;
  }
  .catalog-panel {
    border: 0;
    background: transparent;
    padding: 0;
  }
  .toolbar {
    padding: 12px;
    border: 1px solid #e8ebf1;
    border-radius: 12px;
    background: white;
  }
  .toolbar > .el-input {
    max-width: none !important;
  }
  .wallet-link {
    flex-basis: 100%;
    min-height: 32px;
    font-size: 13px;
  }
  .product {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
    padding: 16px;
    margin-bottom: 12px;
    background: white;
    border: 1px solid #e8ebf1;
    border-radius: 12px;
  }
  .product > img,
  .product-placeholder {
    width: 64px;
    height: 64px;
    grid-column: 1;
    grid-row: 1;
  }
  .product-main {
    display: contents;
  }
  .product-main h2 {
    grid-column: 2;
    grid-row: 1;
    align-self: center;
    margin: 0;
    font-size: 15px;
  }
  .sku-row,
  .product-main > details,
  .product-main > p {
    grid-column: 1 / -1;
  }
  .sku-row {
    grid-template-columns: minmax(0, 1fr) 144px;
    border-top: 1px solid #edf0f4;
    padding: 12px 0 0;
    gap: 8px;
  }
  .sku-row > .sku-description {
    overflow-wrap: anywhere;
    line-height: 1.5;
    grid-column: 1 / -1;
  }
  .sku-row .el-input-number {
    width: 144px;
  }
  .sku-row .price {
    font-size: 18px;
    overflow-wrap: anywhere;
  }
  .checkout-bar {
    position: fixed;
    z-index: 45;
    bottom: calc(var(--vip-bottom-nav-height) + 8px);
    left: 14px;
    right: 14px;
    padding: 10px 12px;
    min-height: 66px;
  }
  .checkout-bar > div:first-child {
    min-width: 0;
  }
  .checkout-bar > div:first-child > span {
    font-size: 12px;
    color: #637084;
  }
  .checkout-bar strong {
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .checkout-bar .button-row {
    flex-shrink: 0;
    gap: 4px;
    flex-wrap: nowrap;
  }
  .checkout-bar .clear-cart {
    width: 44px;
    padding: 0;
  }
  .clear-cart span {
    display: none;
  }
  .checkout-item {
    gap: 10px;
    line-height: 1.6;
  }
  .checkout-item > div {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .address-title {
    margin: 18px 0 12px;
    font-size: 17px;
  }
  .address-recognition {
    padding: 12px;
    margin-bottom: 16px;
  }
  .address-recognition label {
    font-size: 14px;
  }
  .address-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 12px;
  }
  .quote-totals {
    display: grid;
    justify-content: stretch;
    gap: 8px;
  }
  .quote-totals strong {
    font-size: 24px;
  }
  .balance-note {
    text-align: left;
    line-height: 1.7;
    margin-bottom: 0;
  }
  .confirmation-recipient {
    padding: 14px;
  }
  .confirmation-recipient > div {
    min-width: 0;
  }
  .confirmation-recipient span {
    display: block;
    margin: 6px 0 0;
    font-size: 14px;
  }
  .confirmation-heading {
    margin-bottom: 8px;
  }
}
@media (min-width: 601px) and (max-width: 950px) and (max-height: 500px) {
  .product {
    padding: 12px;
    gap: 8px;
  }
  .checkout-bar {
    min-height: 56px;
    padding: 5px 12px;
  }
  .page-head {
    display: none;
  }
  .toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .wallet-link {
    white-space: nowrap;
    min-height: 44px;
  }
  .product > img,
  .product-placeholder {
    grid-row: 1 / span 2;
    align-self: center;
  }
  .product-main h2 {
    align-self: start;
  }
  .sku-row {
    grid-column: 2;
    grid-template-columns: minmax(0, 1fr) 100px 144px;
    padding-top: 8px;
  }
  .sku-row > .sku-description {
    grid-column: auto;
  }
  .sku-row .price {
    font-size: 16px;
  }
}
</style>
