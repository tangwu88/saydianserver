<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, data, errorMessage } from "../api";
import { money, date, statuses } from "../present";
const orders = ref<any[]>([]),
  total = ref(0),
  page = ref(1),
  busy = ref(false),
  detail = ref<any>(),
  logistics = ref<any[]>([]),
  drawer = ref(false);
async function load() {
  busy.value = true;
  try {
    const result = data(
      await api.get("/orders", { params: { page: page.value } }),
    );
    orders.value = result.items;
    total.value = result.total;
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  } finally {
    busy.value = false;
  }
}
onMounted(load);
async function open(id: string) {
  detail.value = null;
  logistics.value = [];
  drawer.value = true;
  try {
    const [order, shipments] = await Promise.all([
      api.get(`/orders/${id}`),
      api.get(`/orders/${id}/logistics`),
    ]);
    detail.value = data(order);
    logistics.value = data(shipments).items;
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
}
</script>
<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>采购订单</h1>
        <p>查询采购记录、ERP 发货状态与物流信息</p>
      </div>
      <el-button @click="load">刷新</el-button>
    </div>
    <div class="panel">
      <el-table :data="orders" v-loading="busy"
        ><el-table-column
          prop="orderNo"
          label="订单号"
          min-width="245"
        /><el-table-column label="商品" min-width="230"
          ><template #default="scope"
            ><div v-for="item in scope.row.items" :key="item.id">
              {{ item.nameSnapshot }} × {{ item.quantity }}
            </div></template
          ></el-table-column
        ><el-table-column label="应付金额" width="130"
          ><template #default="scope"
            ><b>{{ money(scope.row.payableCents) }}</b></template
          ></el-table-column
        ><el-table-column label="状态" width="130"
          ><template #default="scope"
            ><el-tag
              :type="scope.row.status === 'REFUNDED' ? 'info' : 'success'"
              >{{ statuses[scope.row.status] || scope.row.status }}</el-tag
            ></template
          ></el-table-column
        ><el-table-column label="下单时间" min-width="180"
          ><template #default="scope">{{
            date(scope.row.createdAt)
          }}</template></el-table-column
        ><el-table-column label="操作" width="120" fixed="right"
          ><template #default="scope"
            ><el-button text type="primary" @click="open(scope.row.id)"
              >详情与物流</el-button
            ></template
          ></el-table-column
        ></el-table
      ><el-pagination
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
    <el-drawer v-model="drawer" title="采购订单详情" size="min(820px, 100vw)"
      ><template v-if="detail"
        ><h2>{{ detail.orderNo }}</h2>
        <el-tag>{{ statuses[detail.status] || detail.status }}</el-tag>
        <dl class="facts" style="margin-top: 26px">
          <div>
            <dt>成交等级</dt>
            <dd>{{ detail.partnerLevelSnapshot }}</dd>
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
            <dt>ERP 订单号</dt>
            <dd>{{ detail.erpOrderId || "等待同步" }}</dd>
          </div>
          <div>
            <dt>ERP 状态</dt>
            <dd>{{ detail.erpStatus || "等待同步" }}</dd>
          </div>
          <div>
            <dt>下单时间</dt>
            <dd>{{ date(detail.createdAt) }}</dd>
          </div>
        </dl>
        <h3>收货信息</h3>
        <p>{{ detail.recipientName }} · {{ detail.recipientMobile }}</p>
        <p class="muted">
          {{ detail.province }} {{ detail.city }} {{ detail.district }}
          {{ detail.addressDetail }}
        </p>
        <el-table :data="detail.items"
          ><el-table-column prop="nameSnapshot" label="商品" /><el-table-column
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
        <h3 style="margin-top: 30px">发货与物流</h3>
        <el-empty v-if="!logistics.length" description="暂无发货记录" />
        <div v-for="shipment in logistics" :key="shipment.id" class="shipment">
          <b>{{ shipment.logisticsCompany }} · {{ shipment.trackingNo }}</b>
          <p class="muted">发货时间：{{ date(shipment.shippedAt) }}</p>
          <el-timeline v-if="shipment.traces.length"
            ><el-timeline-item
              v-for="(trace, index) in shipment.traces"
              :key="index"
              :timestamp="trace.time"
              >{{ trace.description }}</el-timeline-item
            ></el-timeline
          >
          <p v-else class="muted">暂无运输轨迹</p>
        </div>
        <template v-if="detail.afterSales.length"
          ><h3 style="margin-top: 26px">售后记录</h3>
          <el-table :data="detail.afterSales"
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
      ></el-drawer
    >
  </section>
</template>
<style scoped>
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
</style>
