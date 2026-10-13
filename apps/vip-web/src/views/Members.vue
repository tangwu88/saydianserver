<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, data, errorMessage } from "../api";
import { date } from "../present";
import {
  healthMetricLabel,
  healthReadings,
  healthTime,
} from "@saydian/app-contracts";
const search = ref(""),
  page = ref(1),
  total = ref(0),
  items = ref<any[]>([]),
  busy = ref(false);
const selected = ref<any>(),
  drawer = ref(false),
  tab = ref("profile"),
  profile = ref<any>(),
  devices = ref<any[]>([]),
  health = ref<any[]>([]),
  healthTotal = ref(0),
  healthPage = ref(1);
const reports = ref<any[]>([]),
  reportTotal = ref(0),
  reportPage = ref(1),
  reportDetail = ref<any>(),
  reportDialog = ref(false);
const device = ref<any>(),
  deviceDialog = ref(false),
  deviceTab = ref("connections"),
  child = reactive({ items: [] as any[], total: 0, page: 1 }),
  detailBusy = ref(false);
let detailRequest = 0,
  listRequest = 0;
async function load() {
  const request = ++listRequest;
  busy.value = true;
  try {
    const result = data(
      await api.get("/members", {
        params: { search: search.value, page: page.value },
      }),
    );
    if (request === listRequest) {
      items.value = result.items;
      total.value = result.total;
    }
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  } finally {
    if (request === listRequest) busy.value = false;
  }
}
onMounted(load);
async function openMember(row: any) {
  selected.value = row;
  drawer.value = true;
  tab.value = "profile";
  profile.value = null;
  devices.value = [];
  health.value = [];
  healthPage.value = 1;
  reports.value = [];
  reportPage.value = 1;
  await loadDetails();
}
async function loadDetails() {
  if (!selected.value) return;
  const id = selected.value.id,
    request = ++detailRequest;
  detailBusy.value = true;
  try {
    if (tab.value === "profile") {
      const result = data(await api.get(`/members/${id}/profile`));
      if (request === detailRequest) profile.value = result;
    } else if (tab.value === "devices") {
      const result = data(await api.get(`/members/${id}/devices`));
      if (request === detailRequest) devices.value = result.items;
    } else if (tab.value === "reports") {
      const result = data(
        await api.get(`/members/${id}/reports`, {
          params: { page: reportPage.value },
        }),
      );
      if (request === detailRequest) {
        reports.value = result.items;
        reportTotal.value = result.total;
      }
    } else {
      const result = data(
        await api.get(`/members/${id}/health-records`, {
          params: { page: healthPage.value, pageSize: 30 },
        }),
      );
      if (request === detailRequest) {
        health.value = result.items;
        healthTotal.value = result.total;
      }
    }
  } catch (cause) {
    if (request === detailRequest) {
      profile.value = null;
      devices.value = [];
      health.value = [];
      ElMessage.error(errorMessage(cause));
    }
  } finally {
    if (request === detailRequest) detailBusy.value = false;
  }
}
async function openDevice(row: any) {
  device.value = row;
  deviceDialog.value = true;
  deviceTab.value = "connections";
  child.page = 1;
  await loadDevice();
}
async function loadDevice() {
  child.items = [];
  try {
    const result = data(
      await api.get(`/devices/${device.value.id}/${deviceTab.value}`, {
        params: { page: child.page, pageSize: 30 },
      }),
    );
    child.items = result.items;
    child.total = result.total;
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
}
async function downloadEcg(id: string) {
  try {
    const response = await api.get(`/health-records/${id}/ecg`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ecg-${id}.gz`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
}
async function openReport(id: string) {
  reportDetail.value = null;
  reportDialog.value = true;
  try {
    reportDetail.value = data(await api.get(`/reports/${id}`));
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
}
function reportText(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(reportText);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(reportText);
  return [];
}
function readings(row: Record<string, unknown>) {
  return healthReadings(row)
    .map((item) => `${item.label}：${item.text}`)
    .join(" · ");
}
function changeDeviceTab() {
  child.page = 1;
  void loadDevice();
}
</script>
<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>会员与健康档案</h1>
        <p>查看归属您的会员资料、设备及历史测量记录</p>
      </div>
      <el-tag type="info">{{ total }} 位会员</el-tag>
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
          placeholder="搜索昵称、会员编号、手机号或邮箱"
          clearable
          style="max-width: 360px"
        /><el-button native-type="submit" type="primary">查询</el-button
        ><el-button @click="load">刷新</el-button>
      </form>
      <el-table :data="items" v-loading="busy"
        ><el-table-column
          prop="memberNo"
          label="会员编号"
          width="120"
        /><el-table-column
          prop="nickname"
          label="昵称"
          min-width="150"
        /><el-table-column label="联系方式" min-width="220"
          ><template #default="scope"
            ><div>{{ scope.row.mobile || "—" }}</div>
            <span class="muted">{{ scope.row.email || "" }}</span></template
          ></el-table-column
        ><el-table-column label="设备" width="80"
          ><template #default="scope">{{
            scope.row._count.devices
          }}</template></el-table-column
        ><el-table-column label="健康记录" width="100"
          ><template #default="scope">{{
            scope.row._count.healthRecords
          }}</template></el-table-column
        ><el-table-column label="注册时间" min-width="180"
          ><template #default="scope">{{
            date(scope.row.createdAt)
          }}</template></el-table-column
        ><el-table-column label="操作" width="110" fixed="right"
          ><template #default="scope"
            ><el-button text type="primary" @click="openMember(scope.row)"
              >查看档案</el-button
            ></template
          ></el-table-column
        ></el-table
      ><el-pagination
        v-model:current-page="page"
        :page-size="30"
        :total="total"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
    <el-drawer
      v-model="drawer"
      :title="`${selected?.nickname || '会员'} · 健康档案`"
      size="min(900px, 100vw)"
      @closed="
        detailRequest++;
        profile = null;
        health = [];
        devices = [];
      "
      ><el-tabs v-model="tab" @tab-change="loadDetails"
        ><el-tab-pane label="会员资料" name="profile" /><el-tab-pane
          label="设备"
          name="devices" /><el-tab-pane
          label="健康与测量记录"
          name="health" /><el-tab-pane label="健康报告" name="reports"
      /></el-tabs>
      <div v-loading="detailBusy">
        <dl v-if="tab === 'profile' && profile" class="facts">
          <div>
            <dt>会员编号</dt>
            <dd>{{ profile.memberNo }}</dd>
          </div>
          <div>
            <dt>昵称</dt>
            <dd>{{ profile.nickname }}</dd>
          </div>
          <div>
            <dt>性别</dt>
            <dd>
              {{
                { MALE: "男", FEMALE: "女", UNSPECIFIED: "未填写" }[
                  profile.gender as string
                ] || "未填写"
              }}
            </dd>
          </div>
          <div>
            <dt>手机号</dt>
            <dd>{{ profile.mobile || "未填写" }}</dd>
          </div>
          <div>
            <dt>邮箱</dt>
            <dd>{{ profile.email || "未填写" }}</dd>
          </div>
          <div>
            <dt>出生日期</dt>
            <dd>
              {{
                profile.birthday
                  ? String(profile.birthday).slice(0, 10)
                  : "未填写"
              }}
            </dd>
          </div>
          <div>
            <dt>身高</dt>
            <dd>
              {{
                profile.heightCm == null ? "未填写" : `${profile.heightCm} cm`
              }}
            </dd>
          </div>
          <div>
            <dt>体重</dt>
            <dd>
              {{
                profile.weightKg == null ? "未填写" : `${profile.weightKg} kg`
              }}
            </dd>
          </div>
          <div>
            <dt>健康档案时区</dt>
            <dd>{{ profile.healthProfile?.timezone || "未建立档案" }}</dd>
          </div>
        </dl>
        <el-table v-if="tab === 'devices'" :data="devices"
          ><el-table-column
            prop="displayName"
            label="设备名称"
            min-width="140"
          /><el-table-column prop="model" label="型号" /><el-table-column
            prop="deviceIdentifier"
            label="设备编号"
            min-width="220"
          /><el-table-column label="最近连接" min-width="180"
            ><template #default="scope">{{
              date(scope.row.lastSeenAt)
            }}</template></el-table-column
          ><el-table-column label="操作" width="120"
            ><template #default="scope"
              ><el-button text type="primary" @click="openDevice(scope.row)"
                >连接与测量</el-button
              ></template
            ></el-table-column
          ></el-table
        ><template v-if="tab === 'health'"
          ><el-table :data="health"
            ><el-table-column label="指标" width="100"
              ><template #default="scope">{{
                healthMetricLabel(scope.row.metric)
              }}</template></el-table-column
            ><el-table-column label="测量时间" min-width="175"
              ><template #default="scope">{{
                healthTime(
                  scope.row.observedAt,
                  scope.row.timezoneOffsetMinutes,
                )
              }}</template></el-table-column
            ><el-table-column label="测量值" min-width="250"
              ><template #default="scope"
                ><span class="record-values">{{
                  readings(scope.row)
                }}</span></template
              ></el-table-column
            ><el-table-column label="附件" width="110"
              ><template #default="scope"
                ><el-button
                  v-if="scope.row.ecgArtifact"
                  text
                  type="primary"
                  @click="downloadEcg(scope.row.id)"
                  >心电波形</el-button
                ><span v-else>—</span></template
              ></el-table-column
            ></el-table
          ><el-pagination
            v-model:current-page="healthPage"
            :page-size="30"
            :total="healthTotal"
            layout="prev, pager, next, total"
            @current-change="loadDetails" /></template
        ><template v-if="tab === 'reports'"
          ><el-table :data="reports"
            ><el-table-column label="报告周期"
              ><template #default="scope"
                >{{ String(scope.row.windowStart).slice(0, 10) }} 至
                {{ String(scope.row.windowEnd).slice(0, 10) }}</template
              ></el-table-column
            ><el-table-column label="状态" width="130"
              ><template #default="scope">{{
                scope.row.status === "READY"
                  ? "已生成"
                  : scope.row.status === "REVOKED"
                    ? "已撤回"
                    : "尚未生成"
              }}</template></el-table-column
            ><el-table-column label="操作" width="110"
              ><template #default="scope"
                ><el-button
                  text
                  type="primary"
                  @click="openReport(scope.row.id)"
                  >查看</el-button
                ></template
              ></el-table-column
            ></el-table
          ><el-pagination
            v-model:current-page="reportPage"
            :page-size="30"
            :total="reportTotal"
            layout="prev, pager, next, total"
            @current-change="loadDetails"
        /></template></div
    ></el-drawer>
    <el-dialog v-model="reportDialog" title="会员健康报告" width="760px"
      ><template v-if="reportDetail"
        ><p class="muted">
          {{ String(reportDetail.windowStart).slice(0, 10) }} 至
          {{ String(reportDetail.windowEnd).slice(0, 10) }}
        </p>
        <p
          v-for="(text, index) in reportText(
            reportDetail.fullContent || reportDetail.freePreview,
          )"
          :key="index"
          style="white-space: pre-wrap; line-height: 1.9"
        >
          {{ text }}
        </p>
        <el-empty
          v-if="
            !reportText(reportDetail.fullContent || reportDetail.freePreview)
              .length
          "
          description="暂无报告内容" /></template
    ></el-dialog>
    <el-dialog
      v-model="deviceDialog"
      :title="device?.displayName || '设备记录'"
      width="900px"
      ><el-tabs v-model="deviceTab" @tab-change="changeDeviceTab"
        ><el-tab-pane label="连接记录" name="connections" /><el-tab-pane
          label="测量记录"
          name="measurements" /></el-tabs
      ><el-table :data="child.items"
        ><el-table-column label="时间" width="180"
          ><template #default="scope">{{
            date(scope.row.connectedAt || scope.row.observedAt)
          }}</template></el-table-column
        ><el-table-column
          v-if="deviceTab === 'connections'"
          prop="displayName"
          label="设备名称"
        /><el-table-column
          v-if="deviceTab === 'connections'"
          prop="firmware"
          label="固件"
        /><el-table-column v-else label="指标" width="100"
          ><template #default="scope">{{
            healthMetricLabel(scope.row.metric)
          }}</template></el-table-column
        ><el-table-column
          v-if="deviceTab === 'measurements'"
          label="测量值"
          min-width="280"
          ><template #default="scope"
            ><span class="record-values">{{
              readings(scope.row)
            }}</span></template
          ></el-table-column
        ></el-table
      ><el-pagination
        v-model:current-page="child.page"
        :page-size="30"
        :total="child.total"
        layout="prev, pager, next, total"
        @current-change="loadDevice"
    /></el-dialog>
  </section>
</template>
