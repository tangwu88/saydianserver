<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, data, errorMessage } from "../api";
import { date } from "../present";
import { Search, Refresh, User, Share } from "@element-plus/icons-vue";
import PageError from "../components/PageError.vue";
import EmptyState from "../components/EmptyState.vue";
import {
  healthMetricLabel,
  healthReadings,
  healthTime,
} from "@saydian/app-contracts";
const canViewMemberHealth = ref(false);
const error = ref(""),
  detailError = ref(""),
  deviceError = ref(""),
  reportError = ref(""),
  deviceBusy = ref(false),
  reportBusy = ref(false);
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
  listRequest = 0,
  deviceRequest = 0,
  reportRequest = 0;
onBeforeUnmount(() => {
  listRequest++;
  detailRequest++;
  deviceRequest++;
  reportRequest++;
});
async function load() {
  const request = ++listRequest;
  busy.value = true;
  error.value = "";
  try {
    const result = data(
      await api.get("/members", {
        params: { search: search.value, page: page.value },
      }),
    );
    if (request === listRequest) {
      canViewMemberHealth.value = result.canViewMemberHealth === true;
      items.value = result.items;
      total.value = result.total;
    }
  } catch (cause) {
    if (request === listRequest) error.value = errorMessage(cause);
  } finally {
    if (request === listRequest) busy.value = false;
  }
}
onMounted(load);
async function openMember(row: any) {
  deviceRequest++;
  reportRequest++;
  deviceDialog.value = false;
  reportDialog.value = false;
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
  detailError.value = "";
  try {
    if (tab.value === "profile") {
      const result = data(await api.get(`/members/${id}/profile`));
      if (request === detailRequest) {
        profile.value = result;
        canViewMemberHealth.value = result.canViewMemberHealth === true;
      }
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
      reports.value = [];
      detailError.value = errorMessage(cause);
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
  const request = ++deviceRequest;
  deviceBusy.value = true;
  deviceError.value = "";
  child.total = 0;
  child.items = [];
  try {
    const result = data(
      await api.get(`/devices/${device.value.id}/${deviceTab.value}`, {
        params: { page: child.page, pageSize: 30 },
      }),
    );
    if (request !== deviceRequest) return;
    child.items = result.items;
    child.total = result.total;
  } catch (cause) {
    if (request === deviceRequest) deviceError.value = errorMessage(cause);
  } finally {
    if (request === deviceRequest) deviceBusy.value = false;
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
const selectedReportId = ref("");
async function openReport(id: string) {
  const request = ++reportRequest;
  selectedReportId.value = id;
  reportDetail.value = null;
  reportDialog.value = true;
  reportBusy.value = true;
  reportError.value = "";
  try {
    const result = data(await api.get(`/reports/${id}`));
    if (request === reportRequest) reportDetail.value = result;
  } catch (cause) {
    if (request === reportRequest) reportError.value = errorMessage(cause);
  } finally {
    if (request === reportRequest) reportBusy.value = false;
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
        <h1>我的会员</h1>
      </div>
      <el-tag type="info">{{ total }} 位会员</el-tag>
    </div>
    <PageError :message="error" @retry="load" />
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
          :prefix-icon="Search"
          aria-label="搜索会员"
          @clear="
            page = 1;
            load();
          "
          style="max-width: 360px"
        /><el-button native-type="submit" type="primary">搜索</el-button
        ><el-button :icon="Refresh" :loading="busy" @click="load"
          >刷新</el-button
        >
      </form>
      <div v-loading="busy">
        <EmptyState
          v-if="!items.length && !busy && !error"
          :title="search ? '未找到会员' : '还没有会员'"
          :description="
            search
              ? '试试姓名、手机号或会员编号。'
              : '分享专属二维码，新会员注册后会显示在这里。'
          "
          ><router-link
            v-if="!search"
            to="/promotion"
            class="action-link primary"
            ><el-icon><Share /></el-icon>邀请会员</router-link
          ></EmptyState
        >
        <div class="member-grid">
          <article v-for="member in items" :key="member.id" class="record-card">
            <div class="record-head">
              <div class="member-name">
                <el-icon :size="22"><User /></el-icon
                ><b>{{ member.nickname || "未填写昵称" }}</b>
              </div>
              <el-button type="primary" plain @click="openMember(member)">{{
                canViewMemberHealth ? "查看档案" : "查看资料"
              }}</el-button>
            </div>
            <p class="member-contact">
              {{ member.mobile || member.email || "未填写联系方式" }}
            </p>
            <p class="muted member-meta">
              {{ member.memberNo }} · {{ member._count.devices }} 台设备
              <template v-if="canViewMemberHealth">
                · {{ member._count.healthRecords }} 条健康记录</template
              >
            </p>
            <small class="muted">注册于 {{ date(member.createdAt) }}</small>
          </article>
        </div>
      </div>
      <el-pagination
        v-if="total > 30"
        v-model:current-page="page"
        :page-size="30"
        :total="total"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
    <el-drawer
      v-model="drawer"
      class="detail-drawer"
      :title="`${selected?.nickname || '会员'} · ${canViewMemberHealth ? '健康档案' : '会员资料'}`"
      size="min(900px, 100vw)"
      @closed="
        detailRequest++;
        deviceRequest++;
        reportRequest++;
        deviceDialog = false;
        reportDialog = false;
        profile = null;
        health = [];
        devices = [];
      "
      ><el-tabs v-model="tab" @tab-change="loadDetails"
        ><el-tab-pane label="会员资料" name="profile" /><el-tab-pane
          label="设备"
          name="devices" /><el-tab-pane
          v-if="canViewMemberHealth"
          label="健康与测量记录"
          name="health" /><el-tab-pane
          v-if="canViewMemberHealth"
          label="健康报告"
          name="reports"
      /></el-tabs>
      <PageError :message="detailError" @retry="loadDetails" />
      <div v-loading="detailBusy" :aria-busy="detailBusy">
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
          <div v-if="canViewMemberHealth">
            <dt>出生日期</dt>
            <dd>
              {{
                profile.birthday
                  ? String(profile.birthday).slice(0, 10)
                  : "未填写"
              }}
            </dd>
          </div>
          <div v-if="canViewMemberHealth">
            <dt>身高</dt>
            <dd>
              {{
                profile.heightCm == null ? "未填写" : `${profile.heightCm} cm`
              }}
            </dd>
          </div>
          <div v-if="canViewMemberHealth">
            <dt>体重</dt>
            <dd>
              {{
                profile.weightKg == null ? "未填写" : `${profile.weightKg} kg`
              }}
            </dd>
          </div>
          <div v-if="canViewMemberHealth">
            <dt>健康档案时区</dt>
            <dd>{{ profile.healthProfile?.timezone || "未建立档案" }}</dd>
          </div>
        </dl>
        <div v-if="tab === 'devices'" class="mobile-only">
          <EmptyState
            v-if="!devices.length && !detailBusy && !detailError"
            title="暂无设备"
          />
          <article v-for="item in devices" :key="item.id" class="record-card">
            <b>{{ item.displayName || item.model || "设备" }}</b>
            <dl class="mobile-record-facts">
              <div>
                <dt>型号</dt>
                <dd>{{ item.model || "未填写" }}</dd>
              </div>
              <div>
                <dt>最近连接</dt>
                <dd>{{ date(item.lastSeenAt) }}</dd>
              </div>
              <div class="full">
                <dt>设备编号</dt>
                <dd>{{ item.deviceIdentifier }}</dd>
              </div>
            </dl>
            <el-button type="primary" plain @click="openDevice(item)">{{
              canViewMemberHealth ? "连接与测量" : "连接记录"
            }}</el-button>
          </article>
        </div>
        <el-table v-if="tab === 'devices'" :data="devices" class="desktop-only"
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
              ><el-button text type="primary" @click="openDevice(scope.row)">{{
                canViewMemberHealth ? "连接与测量" : "连接记录"
              }}</el-button></template
            ></el-table-column
          ></el-table
        ><template v-if="tab === 'health'"
          ><div class="mobile-only">
            <EmptyState
              v-if="!health.length && !detailBusy && !detailError"
              title="暂无健康与测量记录"
            />
            <article v-for="row in health" :key="row.id" class="record-card">
              <b>{{ healthMetricLabel(row.metric) }}</b>
              <p class="muted mobile-record-time">
                {{ healthTime(row.observedAt, row.timezoneOffsetMinutes) }}
              </p>
              <p class="mobile-readings">{{ readings(row) }}</p>
              <el-button
                v-if="row.ecgArtifact"
                text
                type="primary"
                @click="downloadEcg(row.id)"
                >心电波形</el-button
              >
            </article>
          </div>
          <el-table :data="health" class="desktop-only"
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
          ><div class="mobile-only">
            <EmptyState
              v-if="!reports.length && !detailBusy && !detailError"
              title="暂无健康报告"
            />
            <article v-for="row in reports" :key="row.id" class="record-card">
              <b>健康报告</b>
              <p class="mobile-record-time">
                {{ String(row.windowStart).slice(0, 10) }} 至
                {{ String(row.windowEnd).slice(0, 10) }}
              </p>
              <div class="record-foot">
                <span class="muted">{{
                  row.status === "READY"
                    ? "已生成"
                    : row.status === "REVOKED"
                      ? "已撤回"
                      : "尚未生成"
                }}</span
                ><el-button type="primary" plain @click="openReport(row.id)"
                  >查看报告</el-button
                >
              </div>
            </article>
          </div>
          <el-table :data="reports" class="desktop-only"
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
    <el-dialog
      v-model="reportDialog"
      class="mobile-sheet"
      title="会员健康报告"
      width="760px"
      @closed="
        reportRequest++;
        reportDetail = null;
      "
      ><PageError
        :message="reportError"
        @retry="openReport(selectedReportId)" />
      <div v-if="reportBusy" class="empty" role="status">正在加载报告…</div>
      <template v-if="reportDetail"
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
      class="mobile-sheet"
      :title="device?.displayName || '设备记录'"
      width="900px"
      @closed="
        deviceRequest++;
        child.items = [];
      "
      ><PageError :message="deviceError" @retry="loadDevice" /><el-tabs
        v-model="deviceTab"
        @tab-change="changeDeviceTab"
        ><el-tab-pane label="连接记录" name="connections" /><el-tab-pane
          v-if="canViewMemberHealth"
          label="测量记录"
          name="measurements"
      /></el-tabs>
      <div class="mobile-only" v-loading="deviceBusy">
        <EmptyState
          v-if="!child.items.length && !deviceBusy && !deviceError"
          :title="deviceTab === 'connections' ? '暂无连接记录' : '暂无测量记录'"
        />
        <article v-for="row in child.items" :key="row.id" class="record-card">
          <b>{{
            deviceTab === "connections"
              ? row.displayName || "设备连接"
              : healthMetricLabel(row.metric)
          }}</b>
          <p class="muted mobile-record-time">
            {{
              deviceTab === "connections"
                ? date(row.connectedAt)
                : healthTime(row.observedAt, row.timezoneOffsetMinutes)
            }}
          </p>
          <p v-if="deviceTab === 'connections'" class="mobile-readings">
            固件 {{ row.firmware || "未记录" }}
          </p>
          <p v-else class="mobile-readings">{{ readings(row) }}</p>
        </article>
      </div>
      <el-table :data="child.items" v-loading="deviceBusy" class="desktop-only"
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

<style scoped>
.member-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
  gap: 14px;
}
.member-grid .record-card {
  margin: 0;
}
.member-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.member-name .el-icon {
  color: #b82237;
}
.member-name b {
  overflow-wrap: anywhere;
}
.member-contact {
  font-size: 14px;
  overflow-wrap: anywhere;
  margin: 0 0 12px;
}
.member-meta {
  font-size: 13px;
  line-height: 1.7;
}
.record-head {
  flex-wrap: wrap;
}
@media (max-width: 600px), (max-width: 950px) and (max-height: 500px) {
  .toolbar > .el-input {
    flex-basis: calc(100% - 72px);
    max-width: none !important;
  }
  .member-meta {
    overflow-wrap: anywhere;
    margin: 10px 0;
  }
  .member-grid .record-card {
    padding: 14px;
  }
  .member-name b {
    font-size: 15px;
  }
  .member-name .el-icon {
    display: none;
  }
  .mobile-record-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 14px 0;
    font-size: 13px;
  }
  .mobile-record-facts .full {
    grid-column: 1 / -1;
  }
  .mobile-record-facts dt {
    color: #637084;
    margin-bottom: 5px;
  }
  .mobile-record-facts dd {
    margin: 0;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .mobile-record-time {
    font-size: 12px;
    line-height: 1.6;
    margin: 8px 0;
  }
  .mobile-readings {
    font-size: 14px;
    line-height: 1.8;
    overflow-wrap: anywhere;
    margin: 10px 0 0;
  }
}
</style>
