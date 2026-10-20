<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, data, errorMessage } from "../api";
import { money, date, statuses, partnerOrderStatus, erpStatuses } from "../present";
import { partnerLevelName } from "@saydian/app-contracts";
import { Refresh, Van, CopyDocument } from "@element-plus/icons-vue";
import PageError from "../components/PageError.vue";
import EmptyState from "../components/EmptyState.vue";
const error = ref(""),
  detailError = ref(""),
  logisticsError = ref(""),
  detailBusy = ref(false),
  selectedId = ref("");
const processing = ref<any>(),
  processingError = ref(""),
  processingBusy = ref(false);
let processingTimer: ReturnType<typeof setTimeout> | undefined;
let listRequest = 0,
  detailRequest = 0, processingRequest = 0;
onBeforeUnmount(() => {
  clearTimeout(processingTimer);
  listRequest++;
  detailRequest++;
});
const orders = ref<any[]>([]),
  total = ref(0),
  page = ref(1),
  busy = ref(false),
  detail = ref<any>(),
  logistics = ref<any[]>([]),
  drawer = ref(false);
async function load() {
  const request = ++listRequest;
  busy.value = true;
  error.value = "";
  try {
    const result = data(
      await api.get("/orders", { params: { page: page.value } }),
    );
    if (request !== listRequest) return;
    orders.value = result.items;
    total.value = result.total;
  } catch (cause) {
    if (request === listRequest) error.value = errorMessage(cause);
  } finally {
    if (request === listRequest) busy.value = false;
  }
}
onMounted(load);
async function open(id: string) {
  const request = ++detailRequest;
  selectedId.value = id;
  clearTimeout(processingTimer);
  processing.value = null;
  processingError.value = "";
  detail.value = null;
  logistics.value = [];
  detailError.value = "";
  logisticsError.value = "";
  drawer.value = true;
  detailBusy.value = true;
  const [order, shipments] = await Promise.allSettled([
    api.get(`/orders/${id}`),
    api.get(`/orders/${id}/logistics`),
  ]);
  if (request !== detailRequest) return;
  if (order.status === "fulfilled") detail.value = data(order.value);
  else detailError.value = errorMessage(order.reason);
  if (shipments.status === "fulfilled")
    logistics.value = data(shipments.value).items;
  else logisticsError.value = errorMessage(shipments.reason);
  detailBusy.value = false;
  if (detail.value) void loadProcessing(id, request);
}
function stopProcessing() {
  processingRequest++;
  clearTimeout(processingTimer);
}
async function loadProcessing(
  id = selectedId.value,
  request = detailRequest,
  poll = 0,
  cycle = ++processingRequest,
) {
  clearTimeout(processingTimer);
  processingBusy.value = true;
  processingError.value = "";
  try {
    const result = data(await api.get(`/orders/${id}/processing`));
    if (request !== detailRequest || cycle !== processingRequest || id !== selectedId.value || !drawer.value)
      return;
    processing.value = result;
    if (detail.value && Object.prototype.hasOwnProperty.call(result, "erpStatus")) {
      const patch = { erpStatus: result.erpStatus, ...(result.orderStatus ? { status: result.orderStatus } : {}) };
      detail.value = { ...detail.value, ...patch };
      orders.value = orders.value.map(order => order.id === id ? { ...order, ...patch } : order);
    }
    if (result.state === "PENDING" && poll < 12)
      processingTimer = setTimeout(() => {
        void loadProcessing(id, request, poll + 1, cycle);
      }, 2500);
    if (result.state === "READY") {
      try {
        const shipments = data(await api.get(`/orders/${id}/logistics`)).items;
        if (request === detailRequest && cycle === processingRequest && drawer.value) { logistics.value = shipments; logisticsError.value = ""; }
      } catch (cause) { if (request === detailRequest && cycle === processingRequest) logisticsError.value = errorMessage(cause); }
    }
  } catch (cause) {
    if (request === detailRequest && cycle === processingRequest) processingError.value = errorMessage(cause);
  } finally {
    if (request === detailRequest && cycle === processingRequest) processingBusy.value = false;
  }
}
async function copyTracking(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success("运单号已复制");
  } catch {
    ElMessage.info("请选中运单号后复制");
  }
}
</script>
<template>
  <section class="page">
    <div class="page-head">
      <h1>我的订单</h1>
      <div class="button-row">
        <router-link to="/products" class="action-link primary"
          >采购商品</router-link
        ><el-button :icon="Refresh" :loading="busy" @click="load"
          >刷新</el-button
        >
      </div>
    </div>
    <PageError :message="error" @retry="load" />
    <div class="panel order-list" v-loading="busy">
      <EmptyState
        v-if="!orders.length && !busy && !error"
        title="还没有采购订单"
        description="选择商品并付款后，可在这里查看发货和物流。"
        ><router-link to="/products" class="action-link primary"
          >去选商品</router-link
        ></EmptyState
      >
      <article v-for="order in orders" :key="order.id" class="record-card">
        <div class="record-head">
          <div>
            <b class="record-number">{{ order.orderNo }}</b
            ><small>{{ date(order.createdAt) }}</small>
          </div>
          <el-tag>{{ partnerOrderStatus(order) }}</el-tag>
        </div>
        <div v-for="item in order.items" :key="item.id" class="order-item">
          <img
            v-if="item.imageSnapshot"
            :src="item.imageSnapshot"
            :alt="item.nameSnapshot"
          />
          <div>
            <b>{{ item.nameSnapshot }}</b
            ><small>{{ item.specificationSnapshot || "默认规格" }}</small>
          </div>
          <span>× {{ item.quantity }}</span>
        </div>
        <div class="record-foot">
          <span
            >订单金额 <strong>{{ money(order.payableCents) }}</strong></span
          ><el-button type="primary" plain :icon="Van" @click="open(order.id)"
            >详情 / 物流</el-button
          >
        </div>
      </article>
      <el-pagination
        v-if="total > 30"
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
    <el-drawer
      v-model="drawer"
      class="detail-drawer"
      title="采购订单详情"
      size="min(820px, 100vw)"
      @closed="
        detailRequest++;
        stopProcessing();
        detail = null;
      "
      ><div v-loading="detailBusy" :aria-busy="detailBusy">
        <PageError :message="detailError" @retry="open(selectedId)" /><template
          v-if="detail"
          ><h2 class="detail-order-number">{{ detail.orderNo }}</h2>
          <el-tag>{{ partnerOrderStatus(detail) }}</el-tag>
          <dl class="facts" style="margin-top: 26px">
            <div>
              <dt>成交等级</dt>
              <dd>{{ partnerLevelName(detail.partnerLevelSnapshot) }}</dd>
            </div>
            <div>
              <dt>余额付款</dt>
              <dd>{{ money(detail.payableCents) }}</dd>
            </div>
            <div>
              <dt>运费</dt>
              <dd>{{ money(detail.shippingCents) }}</dd>
            </div>
            <div>
              <dt>发货单号</dt>
              <dd>{{ detail.erpOrderId || "等待同步" }}</dd>
            </div>
            <div>
              <dt>发货处理</dt>
              <dd>
                {{
                  erpStatuses[detail.erpStatus] ||
                  detail.erpStatus || "等待同步"
                }}
              </dd>
            </div>
            <div>
              <dt>下单时间</dt>
              <dd>{{ date(detail.createdAt) }}</dd>
            </div>
          </dl>
          <h3>收货信息</h3>
          <p class="recipient-line">
            {{ detail.recipientName }} · {{ detail.recipientMobile }}
          </p>
          <p class="muted recipient-line">
            {{ detail.province }} {{ detail.city }} {{ detail.district }}
            {{ detail.addressDetail }}
          </p>
          <div class="mobile-only detail-products">
            <article
              v-for="item in detail.items"
              :key="item.id"
              class="detail-product"
            >
              <b>{{ item.nameSnapshot }}</b>
              <p class="muted">
                {{ item.specificationSnapshot || "默认规格" }}
              </p>
              <div>
                <span>单价 {{ money(item.unitPriceCents) }}</span
                ><strong>× {{ item.quantity }}</strong>
              </div>
            </article>
          </div>
          <el-table :data="detail.items" class="desktop-only"
            ><el-table-column
              prop="nameSnapshot"
              label="商品"
            /><el-table-column
              prop="specificationSnapshot"
              label="规格"
            /><el-table-column
              prop="quantity"
              label="数量"
              width="75"
            /><el-table-column label="成交单价" width="120"
              ><template #default="scope">{{
                money(scope.row.unitPriceCents)
              }}</template></el-table-column
            ></el-table
          >
          <div class="record-head" style="margin-top: 26px">
            <h3>ERP 处理明细</h3>
            <el-button
              :icon="Refresh"
              :loading="processingBusy"
              @click="loadProcessing()"
              >同步 / 刷新</el-button
            >
          </div>
          <PageError :message="processingError" @retry="loadProcessing()" />
          <p v-if="processing?.syncedAt" class="muted">
            同步于 {{ date(processing.syncedAt) }}
          </p>
          <el-timeline v-if="processing?.items?.length">
            <el-timeline-item
              v-for="event in processing.items"
              :key="event.id"
              :timestamp="event.time"
            >
              <b>{{ event.name }}</b
              ><span v-if="event.operator" class="muted">
                · {{ event.operator }}</span
              >
              <p v-if="event.remark" class="erp-remark">{{ event.remark }}</p>
            </el-timeline-item>
          </el-timeline>
          <p v-if="processing?.state === 'PENDING'" class="muted">
            正在同步 ERP 处理记录…
          </p>
          <p v-else-if="processing?.state === 'ERROR'" class="inline-error">
            ERP 处理记录同步失败，请联系管理员检查接口权限。
          </p>
          <p v-else-if="processing?.state === 'UNAVAILABLE'" class="muted">
            ERP 接口暂不可用。
          </p>
          <p
            v-else-if="!processing?.items?.length && !processingError"
            class="muted"
          >
            {{
              processing?.state === "WAITING_ORDER"
                ? "订单正在提交至 ERP。"
                : "ERP 暂未返回处理记录。"
            }}
          </p>
          <p v-if="processing?.truncated" class="muted">
            记录较多，当前显示最近同步取得的 300 条记录。
          </p>
          <h3 style="margin-top: 30px">发货与物流</h3>
          <PageError
            :message="logisticsError"
            @retry="open(selectedId)"
          /><EmptyState
            v-if="!logistics.length && !logisticsError"
            :title="detail.erpStatus === 'Sent' || detail.status === 'SHIPPED' ? '物流信息待同步' : '暂无发货信息'"
            :description="processing?.state === 'PENDING' ? '正在向 ERP 获取物流信息…' : '可点击上方同步 / 刷新，获取 ERP 实际返回的快递公司和运单号。'"
          />
          <div
            v-for="shipment in logistics"
            :key="shipment.id"
            class="shipment"
          >
            <div class="button-row">
              <b class="record-number"
                >{{ shipment.logisticsCompany }} · {{ shipment.trackingNo }}</b
              ><el-button
                v-if="shipment.trackingNo"
                text
                :icon="CopyDocument"
                @click="copyTracking(shipment.trackingNo)"
                >复制运单号</el-button
              >
            </div>
            <p class="muted">发货时间：{{ date(shipment.shippedAt) }}</p>
            <el-timeline v-if="shipment.traces?.length"
              ><el-timeline-item
                v-for="(trace, index) in shipment.traces"
                :key="index"
                :timestamp="trace.time"
                >{{ trace.description }}</el-timeline-item
              ></el-timeline
            >
            <p v-else class="muted">暂无运输轨迹</p>
          </div>
          <template v-if="detail.afterSales?.length"
            ><h3 style="margin-top: 26px">售后记录</h3>
            <div class="mobile-only">
              <article
                v-for="sale in detail.afterSales"
                :key="sale.id"
                class="record-card"
              >
                <div class="record-head">
                  <b class="record-number">{{ sale.afterSaleNo }}</b
                  ><el-tag>{{ statuses[sale.status] || sale.status }}</el-tag>
                </div>
                <p>申请金额 {{ money(sale.requestedCents) }}</p>
              </article>
            </div>
            <el-table :data="detail.afterSales" class="desktop-only"
              ><el-table-column
                prop="afterSaleNo"
                label="售后编号"
              /><el-table-column label="状态"
                ><template #default="scope">{{
                  statuses[scope.row.status] || scope.row.status
                }}</template></el-table-column
              ><el-table-column label="申请金额"
                ><template #default="scope">{{
                  money(scope.row.requestedCents)
                }}</template></el-table-column
              ></el-table
            ></template
          ></template
        >
      </div></el-drawer
    >
  </section>
</template>
<style scoped>
.erp-remark {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 6px 0;
}
.order-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}
.order-item img {
  width: 54px;
  height: 54px;
  object-fit: contain;
  border-radius: 7px;
}
.order-item > div {
  flex: 1;
  min-width: 0;
}
.order-item b {
  font-size: 14px;
  line-height: 1.5;
}
.order-item small {
  display: block;
  color: #637084;
  margin-top: 5px;
}
.order-item > span {
  white-space: nowrap;
}
.record-foot {
  flex-wrap: wrap;
}

.shipment {
  border: 1px solid #e8ebf1;
  border-radius: 10px;
  padding: 20px;
  margin-top: 16px;
}
.shipment p {
  font-size: 13px;
  margin-top: 12px;
}
.detail-order-number {
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.recipient-line {
  overflow-wrap: anywhere;
  line-height: 1.7;
}
@media (max-width: 600px), (max-width: 950px) and (max-height: 500px) {
  .order-list {
    padding: 0;
    border: 0;
    background: transparent;
  }
  .order-list .record-card:first-child {
    margin-top: 0;
  }
  .record-foot > span {
    font-size: 13px;
  }
  .record-foot strong {
    font-size: 19px;
  }
  .record-foot .el-button {
    margin-left: auto;
    padding: 10px;
  }
  .order-item {
    gap: 10px;
  }
  .order-item img {
    width: 48px;
    height: 48px;
  }
  .order-item small {
    font-size: 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .order-item b {
    overflow-wrap: anywhere;
  }
  .detail-order-number {
    font-size: 17px;
    margin-bottom: 12px;
  }
  .detail-products {
    border: 1px solid #e8ebf1;
    border-radius: 10px;
    padding: 0 14px;
  }
  .detail-product {
    padding: 14px 0;
    border-bottom: 1px solid #edf0f4;
    font-size: 14px;
  }
  .detail-product:last-child {
    border-bottom: 0;
  }
  .detail-product > b {
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .detail-product p {
    font-size: 13px;
    line-height: 1.6;
    margin: 6px 0 10px;
    overflow-wrap: anywhere;
  }
  .detail-product > div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .shipment {
    padding: 14px;
  }
  .shipment .button-row {
    gap: 4px;
  }
  .record-head h3 {
    margin: 0;
    font-size: 16px;
  }
}
</style>
