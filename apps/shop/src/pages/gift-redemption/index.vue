<template>
  <DesktopHeader />
  <view class="page gift-page"
    ><view class="gift-container">
      <view class="gift-heading"
        ><view class="gift-icon" aria-hidden="true">🎁</view>
        <h1>礼品兑换</h1>
        <text>凭兑换卡领取礼品，商品免费、包邮</text></view
      >
      <view v-if="error" class="error-state" role="alert">{{ error }}</view>
      <view v-if="!enabled && ready" class="card unavailable"
        ><h2>暂未开放兑换</h2>
        <text>请联系发卡方确认，或稍后再试。</text
        ><button role="button" class="outline-btn" @click="restore">
          重新加载
        </button></view
      >
      <template v-else-if="ready">
        <view v-if="!token" class="card gift-form"
          ><h2>验证兑换卡</h2>
          <label
            ><text>卡号</text
            ><input
              v-model="cardNo"
              class="input"
              inputmode="numeric"
              type="number"
              maxlength="8"
              autocomplete="off"
              placeholder="请输入8位卡号"
              :disabled="busy" /></label
          ><label
            ><text>校验码</text
            ><input
              v-model="checkCode"
              class="input"
              inputmode="numeric"
              type="number"
              maxlength="6"
              autocomplete="off"
              placeholder="请输入6位校验码"
              :disabled="busy"
            /><text class="muted"
              >请输入兑换卡上的6位数字，不是手机短信验证码。</text
            ></label
          ><button
            role="button"
            class="primary-btn"
            :loading="busy"
            :disabled="busy || !cardNo || !checkCode"
            @click="validateCard"
          >
            验证并选礼品</button
          ><button role="button" class="text-button" @click="orders">
            查看已兑换订单 ›
          </button></view
        >
        <template v-else-if="!completed">
          <view class="gift-steps" aria-label="兑换步骤"
            ><text :class="stage === 'spec' && 'active'">1 选规格</text
            ><text :class="stage === 'phone' && 'active'">2 验证手机</text
            ><text :class="['address', 'confirm'].includes(stage) && 'active'"
              >3 确认收货</text
            ></view
          >
          <view v-if="product" class="card gift-product"
            ><CatalogImage
              v-if="product.coverImage"
              :source="product.coverImage"
              :width="480"
              sizes="120px"
              priority
            /><view
              ><button
                role="button"
                class="gift-product-title"
                tabindex="0"
                aria-haspopup="dialog"
                @click="productDetailsVisible = true"
                @keydown.enter.prevent="productDetailsVisible = true"
                @keydown.space.prevent="productDetailsVisible = true"
              >
                <b>{{ product.displayName || product.name }}</b
                ><text>查看商品详情 ›</text></button
              ><text>兑换 1 件 · 包邮</text
              ><text v-if="card?.expiresAt"
                >有效期至 {{ date(card.expiresAt) }}</text
              ><strong>实付 ¥0.00</strong></view
            ></view
          >
          <view v-if="stage === 'spec'" class="card gift-form"
            ><h2>选择规格</h2>
            <view class="sku-options"
              ><button
                role="button"
                v-for="sku in product?.skus || []"
                :key="sku.id"
                :class="['sku-option', skuId === sku.id && 'selected']"
                :disabled="!giftSkuRedeemable(sku) || busy"
                :aria-pressed="skuId === sku.id"
                @click="
                  skuId = sku.id;
                  persist();
                "
              >
                {{ sku.specification || "默认规格"
                }}<text v-if="!giftSkuRedeemable(sku)">暂时缺货</text
                ><text v-else
                  >{{ giftDispatchText(sku)
                  }}{{ skuId === sku.id ? " · ✓ 已选" : "" }}</text
                >
              </button></view
            ><text v-if="!product?.skus?.some(giftSkuRedeemable)" class="muted"
              >当前规格暂时缺货，兑换卡尚未使用，可稍后再来。</text
            ><button
              role="button"
              class="primary-btn"
              :disabled="!skuId || busy"
              @click="nextFromSpec"
            >
              下一步</button
            ><button
              role="button"
              class="text-button"
              :disabled="busy || !!frozen"
              @click="reset"
            >
              更换兑换卡
            </button></view
          >
          <view v-else-if="stage === 'phone'" class="card gift-form"
            ><h2>验证手机号</h2>
            <text class="muted"
              >验证后将登录该手机号的会员账户，礼品订单保存在这个账户中。</text
            ><label
              ><text>手机号</text
              ><input
                v-model="mobile"
                type="tel"
                inputmode="tel"
                class="input"
                maxlength="11"
                placeholder="请输入11位手机号"
                :disabled="busy" /></label
            ><label
              ><text>短信验证码</text
              ><view class="code-row"
                ><input
                  v-model="smsCode"
                  class="input"
                  inputmode="numeric"
                  type="number"
                  maxlength="6"
                  autocomplete="one-time-code"
                  placeholder="6位验证码"
                  :disabled="busy"
                /><button
                  role="button"
                  class="outline-btn"
                  :disabled="
                    busy || cooldown > 0 || !/^1[3-9]\d{9}$/.test(mobile)
                  "
                  @click="sendSms"
                >
                  {{ cooldown > 0 ? cooldown + "秒后重发" : "获取验证码" }}
                </button></view
              ></label
            ><view class="consent"
              ><checkbox
                :checked="consent"
                :disabled="busy"
                @click="consent = !consent"
              /><text
                >已阅读并同意
                <text class="legal-link" @click="legal('agreement')"
                  >用户协议</text
                >
                和
                <text class="legal-link" @click="legal('privacy')"
                  >隐私政策</text
                ></text
              ></view
            ><button
              role="button"
              class="primary-btn"
              :loading="busy"
              :disabled="busy || !consent || smsCode.length !== 6"
              @click="verifyPhone"
            >
              验证并继续</button
            ><button
              role="button"
              class="text-button"
              :disabled="busy"
              @click="stage = 'spec'"
            >
              返回选择规格
            </button></view
          >
          <view v-else-if="stage === 'address'" class="card gift-form"
            ><h2>选择收货地址</h2>
            <button
              role="button"
              v-for="address in addresses"
              :key="address.id"
              :class="[
                'address-option',
                addressId === address.id && 'selected',
              ]"
              :disabled="busy"
              @click="
                addressId = address.id;
                persist();
              "
            >
              <b>{{ address.name }} {{ address.mobile }}</b
              ><text
                >{{ address.province }}{{ address.city }}{{ address.district
                }}{{ address.detail }}</text
              ><text v-if="addressId === address.id" class="selected-label"
                >✓ 已选</text
              ></button
            ><text v-if="!addresses.length" class="muted"
              >请添加收货信息，可粘贴地址自动识别。</text
            ><button
              role="button"
              class="outline-btn"
              :disabled="busy"
              @click="addAddress"
            >
              ＋ 新增 / 识别地址</button
            ><button
              role="button"
              class="primary-btn"
              :loading="busy"
              :disabled="busy || !addressId"
              @click="prepare"
            >
              核对兑换信息</button
            ><button
              role="button"
              class="text-button"
              :disabled="busy"
              @click="stage = 'spec'"
            >
              返回选择规格
            </button></view
          >
          <view v-else-if="stage === 'confirm'" class="card gift-form"
            ><h2>{{ frozen ? "确认兑换结果" : "请核对兑换信息" }}</h2>
            <template v-if="quote"
              ><view class="review-line"
                ><text>商品规格</text
                ><b>{{ quote.sku.specification || "默认规格" }}</b></view
              ><view class="review-line"><text>数量</text><b>1 件</b></view
              ><view class="gift-dispatch-notice" role="note"
                ><b>{{ giftDispatchText(quote.sku) }}</b
                ><text>个性定制产品，发货时长稍长，请耐心等待。</text></view
              ><view class="review-address"
                ><b>{{ quote.address.name }} {{ quote.address.mobile }}</b
                ><text
                  >{{ quote.address.province }}{{ quote.address.city
                  }}{{ quote.address.district }}{{ quote.address.detail }}</text
                ></view
              ><view class="review-line"
                ><text>商品金额</text
                ><text>{{ money(quote.sku.priceCents) }}</text></view
              ><view class="review-line"
                ><text>礼品卡抵扣</text
                ><text>−{{ money(quote.giftDiscountCents) }}</text></view
              ><view class="review-line"
                ><text>运费</text><text>¥0.00</text></view
              ><view class="review-line review-total"
                ><b>实付</b><strong>¥0.00</strong></view
              ></template
            ><text v-if="frozen" class="muted"
              >兑换正在确认，请查询结果或继续原兑换请求。</text
            ><button
              role="button"
              v-if="frozen"
              class="outline-btn"
              :loading="busy"
              :disabled="busy"
              @click="checkResult"
            >
              查询兑换结果</button
            ><button
              role="button"
              class="primary-btn"
              :loading="busy"
              :disabled="busy"
              @click="submit"
            >
              {{ frozen ? "继续确认原兑换" : "确认兑换 · 免费包邮" }}</button
            ><button
              role="button"
              v-if="!frozen"
              class="text-button"
              :disabled="busy"
              @click="stage = 'address'"
            >
              修改收货信息
            </button></view
          >
        </template>
        <view v-else class="card gift-success"
          ><view class="success-mark" aria-hidden="true">✓</view>
          <h2>兑换成功</h2>
          <text>礼品已下单，可在订单中查看发货和物流。</text
          ><text class="muted">{{ completed.orderNo }}</text
          ><button
            role="button"
            class="primary-btn"
            @click="openOrder(completed.orderId)"
          >
            查看礼品订单</button
          ><button role="button" class="outline-btn" @click="reset">
            兑换另一张卡
          </button></view
        >
      </template>
      <text v-else class="loading-state">正在读取兑换信息…</text>
      <button
        v-if="token || !enabled"
        role="button"
        class="gift-support text-button"
        @click="orders"
      >
        查看已兑换订单 ›
      </button>
      <button
        role="button"
        class="gift-support text-button"
        @click="legal('service')"
      >
        需要帮助？联系客服 ›
      </button>
    </view></view
  >
  <GiftProductDetails
    v-if="productDetailsVisible && product"
    :product-id="product.id"
    :title="product.displayName || product.name"
    @close="productDetailsVisible = false"
  />
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import DesktopHeader from "../../components/DesktopHeader.vue";
import CatalogImage from "../../components/CatalogImage.vue";
import GiftProductDetails from "../../components/GiftProductDetails.vue";
import {
  api,
  mallSessionStamp,
  money,
  saveMallSession,
  toast,
} from "../../api";
import { mallStorage } from "../../realm";
import {
  readGiftDraft,
  saveGiftDraft,
  giftSkuRedeemable,
  giftDispatchText,
  type GiftDraft,
} from "../../gift-redemption";
const endpoint = "/storefront/gift-redemptions",
  cardNo = ref(""),
  checkCode = ref(""),
  token = ref(""),
  expiresAt = ref(""),
  skuId = ref(""),
  addressId = ref(""),
  ownerId = ref(""),
  mobile = ref(""),
  smsCode = ref(""),
  consent = ref(false),
  consentVersion = ref(""),
  cooldown = ref(0),
  product = ref<any>(null),
  productDetailsVisible = ref(false),
  card = ref<any>(null),
  quote = ref<any>(null),
  addresses = ref<any[]>([]),
  completed = ref<any>(null),
  frozen = ref<GiftDraft["request"]>(),
  stage = ref("spec"),
  busy = ref(false),
  error = ref(""),
  enabled = ref(false),
  ready = ref(false),
  verified = ref(false);
const storage = () =>
  typeof sessionStorage === "undefined" ? undefined : sessionStorage;
const currentOwner = () => String(mallStorage.get("saidian-user")?.id || "");
let alive = true,
  revision = 0,
  ticking: ReturnType<typeof setInterval> | undefined;
const proofOwner = computed(
  () => verified.value && ownerId.value === currentOwner(),
);
function persist() {
  saveGiftDraft(
    storage(),
    token.value
      ? {
          token: token.value,
          expiresAt: expiresAt.value,
          skuId: skuId.value,
          addressId: addressId.value,
          ownerId: ownerId.value,
          ...(frozen.value ? { request: frozen.value } : {}),
        }
      : null,
  );
}
function reset() {
  if (busy.value) return;
  revision++;
  token.value = "";
  checkCode.value = "";
  cardNo.value = "";
  ownerId.value = "";
  product.value = null;
  productDetailsVisible.value = false;
  card.value = null;
  completed.value = null;
  frozen.value = undefined;
  quote.value = null;
  addresses.value = [];
  addressId.value = "";
  skuId.value = "";
  verified.value = false;
  error.value = "";
  smsCode.value = "";
  mobile.value = "";
  consent.value = false;
  persist();
}
async function restore() {
  ready.value = false;
  error.value = "";
  try {
    enabled.value = (await api(endpoint + "/capabilities")).enabled;
    if (!enabled.value) return;
    const saved = readGiftDraft(storage());
    if (saved) {
      token.value = saved.token;
      expiresAt.value = saved.expiresAt;
      skuId.value = saved.skuId;
      addressId.value = saved.addressId;
      ownerId.value = saved.ownerId;
      frozen.value = saved.request;
      if (ownerId.value && ownerId.value === currentOwner()) {
        const result = await api(endpoint + "/result", {
          method: "POST",
          auth: true,
          data: { token: token.value },
        }).catch(() => null);
        if (result?.completed) {
          finish(result);
          return;
        }
      }
      const view = await api(endpoint + "/session", {
        method: "POST",
        data: { token: token.value },
      });
      product.value = view.product;
      card.value = view.card;
      consentVersion.value = view.consentVersion;
      verified.value = view.phoneVerified && ownerId.value === currentOwner();
      if (frozen.value) {
        stage.value = "confirm";
        if (proofOwner.value) {
          const restored = await api(endpoint + "/preview", {
            method: "POST",
            auth: true,
            data: frozen.value,
          });
          if (restored.fingerprint === frozen.value.fingerprint)
            quote.value = restored;
          else
            error.value =
              "商品或地址已更新，请先查询原兑换结果，再重新核对信息。";
        }
        return;
      }
      stage.value = proofOwner.value ? "address" : "spec";
      if (proofOwner.value) await loadAddresses();
    }
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : "兑换信息暂时无法读取";
    if (!frozen.value) {
      token.value = "";
      persist();
    }
  } finally {
    ready.value = true;
  }
}
async function validateCard() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const value = await api(endpoint + "/validate", {
      method: "POST",
      data: { cardNo: cardNo.value, checkCode: checkCode.value },
    });
    token.value = value.token;
    expiresAt.value = value.expiresAt;
    product.value = value.product;
    card.value = value.card;
    consentVersion.value = value.consentVersion;
    checkCode.value = "";
    skuId.value =
      value.product.skus.length === 1 &&
      giftSkuRedeemable(value.product.skus[0])
        ? value.product.skus[0].id
        : "";
    stage.value = "spec";
    persist();
  } catch (cause) {
    toast(cause);
    error.value = cause instanceof Error ? cause.message : "卡片验证失败";
  } finally {
    busy.value = false;
  }
}
async function nextFromSpec() {
  if (!skuId.value) return;
  if (proofOwner.value) {
    stage.value = "address";
    await loadAddresses();
  } else stage.value = "phone";
}
async function sendSms() {
  if (busy.value || cooldown.value > 0) return;
  busy.value = true;
  error.value = "";
  try {
    await api(endpoint + "/sms/request", {
      method: "POST",
      data: { token: token.value, mobile: mobile.value },
    });
    verified.value = false;
    ownerId.value = "";
    addresses.value = [];
    addressId.value = "";
    quote.value = null;
    smsCode.value = "";
    persist();
    cooldown.value = 60;
    if (ticking) clearInterval(ticking);
    ticking = setInterval(() => {
      cooldown.value = Math.max(0, cooldown.value - 1);
      if (!cooldown.value && ticking) clearInterval(ticking);
    }, 1000);
    uni.showToast({ title: "验证码已发送", icon: "none" });
  } catch (cause) {
    toast(cause);
  } finally {
    busy.value = false;
  }
}
async function verifyPhone() {
  if (busy.value) return;
  if (currentOwner()) {
    const answer = await uni.showModal({
      title: "确认登录手机号",
      content: `将使用 ${mobile.value} 对应的会员账户兑换礼品，订单和收货地址以该账户为准。`,
    });
    if (!answer.confirm) return;
  }
  busy.value = true;
  error.value = "";
  const expectedStamp = mallSessionStamp();
  try {
    const result = await api(endpoint + "/sms/verify", {
      method: "POST",
      data: {
        token: token.value,
        mobile: mobile.value,
        code: smsCode.value,
        consentAccepted: consent.value,
        consentVersion: consentVersion.value,
      },
    });
    if (!alive || expectedStamp !== mallSessionStamp())
      throw new Error("账号已切换，请重新验证手机号");
    await saveMallSession(result, expectedStamp);
    ownerId.value = result.user.id;
    verified.value = true;
    smsCode.value = "";
    addresses.value = [];
    addressId.value = "";
    quote.value = null;
    stage.value = "address";
    persist();
    await loadAddresses();
  } catch (cause) {
    toast(cause);
    error.value = cause instanceof Error ? cause.message : "手机号验证失败";
    if (/协议/.test(error.value)) {
      consent.value = false;
      try {
        consentVersion.value = (
          await api(endpoint + "/session", {
            method: "POST",
            data: { token: token.value },
          })
        ).consentVersion;
      } catch {}
    }
  } finally {
    busy.value = false;
  }
}
async function loadAddresses() {
  const owner = currentOwner(),
    stamp = mallSessionStamp();
  const values = await api<any[]>("/storefront/addresses", { auth: true });
  if (!alive || owner !== currentOwner() || stamp !== mallSessionStamp())
    return;
  addresses.value = values;
  if (!values.some((row) => row.id === addressId.value))
    addressId.value =
      values.find((row) => row.isDefault)?.id || values[0]?.id || "";
  persist();
}
function addAddress() {
  if (!busy.value) uni.navigateTo({ url: "/pages/address-edit/index" });
}
async function prepare() {
  if (busy.value || !proofOwner.value) return;
  busy.value = true;
  error.value = "";
  const stamp = mallSessionStamp();
  try {
    const value = await api(endpoint + "/preview", {
      method: "POST",
      auth: true,
      data: {
        token: token.value,
        skuId: skuId.value,
        addressId: addressId.value,
      },
    });
    if (!alive || stamp !== mallSessionStamp()) return;
    quote.value = value;
    stage.value = "confirm";
    persist();
  } catch (cause) {
    toast(cause);
    error.value = cause instanceof Error ? cause.message : "请重新核对兑换信息";
    if (/手机号|验证|登录/.test(error.value)) {
      verified.value = false;
      stage.value = "phone";
    }
  } finally {
    busy.value = false;
  }
}
function finish(result: any) {
  completed.value = result;
  frozen.value = undefined;
  saveGiftDraft(storage(), null);
  error.value = "";
}
async function queryResult() {
  const result = await api(endpoint + "/result", {
    method: "POST",
    auth: true,
    data: { token: token.value },
  });
  if (result.completed) {
    finish(result);
    return true;
  }
  return false;
}
async function checkResult() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!(await queryResult()))
      error.value = "暂未查到兑换订单，可以继续确认原兑换请求。";
  } catch (cause) {
    toast(cause);
  } finally {
    busy.value = false;
  }
}
async function submit() {
  if (busy.value || (!quote.value && !frozen.value)) return;
  busy.value = true;
  error.value = "";
  const stamp = mallSessionStamp(),
    attempt = ++revision;
  try {
    if (frozen.value && (await queryResult())) return;
    if (!frozen.value) {
      frozen.value = {
        token: token.value,
        skuId: skuId.value,
        addressId: addressId.value,
        fingerprint: quote.value.fingerprint,
        requestKey: globalThis.crypto.randomUUID(),
      };
      persist();
    }
    const value = await api(endpoint + "/submit", {
      method: "POST",
      auth: true,
      sessionStamp: stamp,
      data: frozen.value,
    });
    if (alive && attempt === revision && stamp === mallSessionStamp())
      finish(value);
  } catch (cause) {
    if (!alive || attempt !== revision || stamp !== mallSessionStamp()) return;
    const code = (cause as any)?.status;
    if ([400, 403, 409].includes(code)) {
      frozen.value = undefined;
      quote.value = null;
      stage.value = code === 403 ? "phone" : "address";
      persist();
      if (stage.value === "address") await loadAddresses().catch(toast);
    }
    error.value =
      code === undefined && frozen.value
        ? "网络连接中断，兑换结果尚未确认。请查询结果或继续原兑换。"
        : cause instanceof Error
          ? cause.message
          : "兑换结果暂未确认，请查询结果";
  } finally {
    if (attempt === revision) busy.value = false;
  }
}
function orders() {
  uni.navigateTo({ url: "/pages/orders/index?kind=gift" });
}
function openOrder(id: string) {
  uni.redirectTo({
    url: "/pages/order-detail/index?id=" + encodeURIComponent(id),
  });
}
function legal(section: string) {
  uni.navigateTo({ url: "/pages/help/index?section=" + section });
}
function date(value: unknown) {
  return new Date(String(value)).toLocaleDateString();
}
onLoad(async (options) => {
  const linked = String(options?.cardNo || "");
  if (linked && linked !== cardNo.value) {
    const saved = readGiftDraft(storage());
    if (!saved?.request) saveGiftDraft(storage(), null);
    cardNo.value = linked.slice(0, 8);
  }
  await restore();
});
onShow(() => {
  if (
    ready.value &&
    token.value &&
    ownerId.value &&
    ownerId.value !== currentOwner()
  ) {
    verified.value = false;
    addresses.value = [];
    addressId.value = "";
    quote.value = null;
    stage.value = "phone";
    error.value = "账号已切换，请重新验证兑换手机号";
  } else if (ready.value && proofOwner.value && stage.value === "address")
    void loadAddresses().catch(toast);
});
onBeforeUnmount(() => {
  alive = false;
  revision++;
  if (ticking) clearInterval(ticking);
});
</script>
<style scoped>
.gift-page {
  padding: 28px 16px 64px;
}
.gift-container {
  max-width: 600px;
  margin: auto;
}
.gift-heading {
  text-align: center;
  margin: 4px 0 24px;
}
.gift-heading h1 {
  margin: 10px 0;
  font-size: 26px;
}
.gift-heading > text {
  color: var(--muted);
  font-size: 14px;
}
.gift-icon {
  font-size: 36px;
}
.gift-form {
  padding: 24px;
  display: grid;
  gap: 18px;
}
.gift-form h2 {
  font-size: 19px;
  margin: 0;
}
.gift-form label {
  display: grid;
  gap: 9px;
}
.gift-form label > text {
  font-size: 14px;
}
.input {
  width: 100%;
  box-sizing: border-box;
  min-height: 48px;
  font-size: 17px;
}
.gift-form button,
.gift-success button {
  min-height: 48px;
  height: auto;
  line-height: 1.5;
  padding: 12px;
  margin: 0;
  font-size: 15px;
}
.gift-steps {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 18px;
}
.gift-steps text.active {
  font-weight: 700;
  color: var(--green);
}
.gift-product {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 18px;
  padding: 18px;
}
.gift-product .catalog-image {
  width: 100px;
  height: 100px;
  flex: none;
  border-radius: 12px;
}
.gift-product > view {
  display: grid;
  gap: 8px;
}
.gift-product b {
  font-size: 16px;
}
.gift-product .gift-product-title {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 2px 0;
  min-height: 44px;
  background: transparent;
  text-align: left;
  color: var(--ink);
  font-size: inherit;
  line-height: 1.5;
  white-space: normal;
}
.gift-product-title::after {
  border: 0;
}
.gift-product .gift-product-title text {
  color: var(--green);
}
.gift-product text {
  font-size: 13px;
  color: var(--muted);
}
.gift-product strong {
  color: var(--green);
  font-size: 20px;
}
.sku-options {
  display: grid;
  gap: 12px;
}
.sku-option,
.address-option {
  background: white;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink);
}
.sku-option.selected,
.address-option.selected {
  border-color: var(--green);
  background: #f2f7ee;
}
.sku-option text {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--green);
}
.sku-option[disabled] {
  color: #9298a0;
  background: #f5f5f5;
}
.code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 120px;
  gap: 10px;
}
.consent {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-size: 13px;
  line-height: 1.8;
}
.consent checkbox {
  transform: scale(0.85);
  transform-origin: top left;
  flex: none;
}
.legal-link {
  color: var(--green);
  text-decoration: underline;
}
.muted {
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted);
}
.address-option {
  display: grid;
  gap: 8px;
}
.address-option text {
  display: block;
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.selected-label {
  color: var(--green);
}
.review-line {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  font-size: 14px;
}
.review-line b {
  text-align: right;
  max-width: 65%;
  overflow-wrap: anywhere;
}
.review-address {
  padding: 16px;
  border-radius: 10px;
  background: #f5f7f8;
  display: grid;
  gap: 10px;
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.gift-dispatch-notice {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #f2f7ee;
  color: var(--green);
  font-size: 14px;
  line-height: 1.7;
}
.gift-dispatch-notice text {
  color: var(--muted);
  font-size: 13px;
}
.review-total {
  border-top: 1px solid var(--line);
  padding-top: 18px;
  align-items: center;
}
.review-total strong {
  font-size: 26px;
  color: var(--green);
}
.gift-success {
  text-align: center;
  display: grid;
  gap: 18px;
  padding: 28px 24px;
}
.gift-success h2 {
  margin: 0;
}
.gift-success > text {
  font-size: 14px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.success-mark {
  border-radius: 50%;
  margin: auto;
  width: 64px;
  height: 64px;
  background: #e9f1e1;
  color: var(--green);
  display: grid;
  place-items: center;
  font-size: 32px;
}
.gift-support {
  margin: 18px auto 0;
  font-size: 13px;
}
.unavailable {
  text-align: center;
  display: grid;
  gap: 16px;
  padding: 24px;
}
.loading-state {
  display: block;
  text-align: center;
  padding: 40px;
}
.error-state {
  margin-bottom: 16px;
  font-size: 14px;
  line-height: 1.7;
}
@media (max-width: 380px) {
  .gift-form {
    padding: 18px;
  }
  .gift-product .catalog-image {
    width: 80px;
    height: 80px;
  }
  .code-row {
    grid-template-columns: minmax(0, 1fr) 112px;
  }
}
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .gift-page {
    padding-bottom: calc(40px + env(safe-area-inset-bottom));
  }
}
</style>
