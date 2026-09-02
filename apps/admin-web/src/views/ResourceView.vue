<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, readableError, responseData } from "../api";

type Row = Record<string, any>;
const route = useRoute();
const loading = ref(false);
const saving = ref(false);
const rows = ref<Row[]>([]);
const search = ref("");
const dialogVisible = ref(false);
const dialogTitle = ref("");
const dialogMode = ref<"edit" | "health">("edit");
const form = ref<Row>({});
const detailRows = ref<Row[]>([]);
const titles: Record<string, string> = {
  members: "会员", care: "远程关爱", warnings: "健康预警", notifications: "通知",
  devices: "设备", articles: "内容", "legal-documents": "协议", feedback: "反馈",
  "article-categories": "内容分类", settings: "客服与更新",
  integrations: "集成状态", "admin-users": "后台账号", "account-deletions": "注销任务",
  "audit-logs": "审计日志", commerce: "商城后台",
};
const fieldLabels: Record<string, string> = {
  id: "编号", legacyMemberId: "旧会员编号", mobileMasked: "手机号", nickname: "昵称",
  status: "状态", healthRecordCount: "健康记录数", deviceCount: "设备数", createdAt: "创建时间",
  updatedAt: "更新时间", invitationId: "邀请编号", metric: "指标", observedAt: "记录时间",
  title: "标题", summary: "摘要", version: "版本", documentType: "协议类型", active: "启用",
  category: "分类", content: "内容", assignedTo: "负责人", key: "集成项", state: "配置状态",
  username: "账号", displayName: "显示名称", role: "角色", eventId: "事件编号",
};
const resource = computed(() => String(route.params.resource || ""));
const title = computed(() => titles[resource.value] || resource.value);
const editable = computed(() => ["articles", "article-categories", "legal-documents", "settings", "integrations", "admin-users"].includes(resource.value));
const columns = computed(() => {
  const first = rows.value[0];
  return first ? Object.keys(first)
    .filter((key) => !["passwordHash", "secretRef", "contentHtml", "valueSnapshot", "ruleSnapshot"].includes(key))
    .slice(0, 10) : [];
});

async function load(): Promise<void> {
  if (resource.value === "commerce") return;
  loading.value = true;
  try {
    const response = await api.get(`/${resource.value}`, {
      params: resource.value === "members" && search.value ? { search: search.value } : {},
    });
    const data = responseData<unknown>(response);
    rows.value = Array.isArray(data) ? data as Row[] : ((data as { items?: Row[] })?.items ?? []);
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally { loading.value = false; }
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function openCreate(): void {
  dialogMode.value = "edit";
  dialogTitle.value = `新增${title.value}`;
  form.value = resource.value === "admin-users" ? { role: "READ_ONLY", active: true } : {};
  dialogVisible.value = true;
}

function openEdit(row: Row): void {
  dialogMode.value = "edit";
  dialogTitle.value = `编辑${title.value}`;
  form.value = {
    ...row,
    publicConfigText: row.publicConfig ? JSON.stringify(row.publicConfig, null, 2) : "{}",
    valueText: row.value ? JSON.stringify(row.value, null, 2) : "{}",
  };
  dialogVisible.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const id = String(form.value.id ?? "");
    let payload: Row = { ...form.value };
    for (const key of ["id", "createdAt", "updatedAt", "publicConfigText", "category"]) delete payload[key];
    if (resource.value === "integrations") {
      payload = { state: form.value.state, publicConfig: JSON.parse(String(form.value.publicConfigText || "{}")) };
      await api.patch(`/integrations/${encodeURIComponent(String(form.value.key))}`, payload);
    } else if (resource.value === "settings") {
      payload = {
        value: JSON.parse(String(form.value.valueText || "{}")),
        public: form.value.public !== false,
      };
      await api.patch(`/settings/${encodeURIComponent(String(form.value.key))}`, payload);
    } else if (id) {
      await api.patch(`/${resource.value}/${encodeURIComponent(id)}`, payload);
    } else {
      await api.post(`/${resource.value}`, payload);
    }
    ElMessage.success("已保存");
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally { saving.value = false; }
}

async function updateFeedback(row: Row, status: string): Promise<void> {
  try {
    await api.patch(`/feedback/${encodeURIComponent(String(row.id))}`, { status });
    row.status = status;
    ElMessage.success("反馈状态已更新");
  } catch (error) { ElMessage.error(readableError(error)); }
}

async function viewHealth(row: Row, raw: boolean): Promise<void> {
  if (raw) {
    try {
      await ElMessageBox.confirm(
        "查看原始健康记录会写入审计日志。请确认这是处理当前事项所必需的。",
        "敏感数据访问确认",
        { type: "warning", confirmButtonText: "确认查看", cancelButtonText: "取消" },
      );
    } catch { return; }
  }
  try {
    const suffix = raw ? "health-records" : "health-summary";
    const data = responseData<unknown>(await api.get(`/members/${encodeURIComponent(String(row.id))}/${suffix}`));
    detailRows.value = Array.isArray(data) ? data as Row[] : [];
    dialogMode.value = "health";
    dialogTitle.value = raw ? "原始健康记录（已审计）" : "健康数据摘要";
    dialogVisible.value = true;
  } catch (error) { ElMessage.error(readableError(error)); }
}

onMounted(load);
</script>

<template>
  <section class="page">
    <h1 class="page-title">{{ title }}</h1>
    <template v-if="resource === 'commerce'">
      <el-alert title="商品、库存、新订单、支付、物流和售后统一由现有赛电商城管理，本后台不复制管理数据。" type="info" :closable="false" />
      <p><el-button type="primary" tag="a" href="https://stest.saydian.cn" target="_blank">打开商城后台</el-button></p>
    </template>
    <template v-else>
      <div class="toolbar">
        <el-input v-if="resource === 'members'" v-model="search" placeholder="昵称、旧会员编号或手机号" clearable style="width: 300px" @keyup.enter="load" />
        <el-button type="primary" @click="load">刷新</el-button>
        <el-button v-if="editable && !['integrations', 'settings'].includes(resource)" @click="openCreate">新增</el-button>
        <span class="muted">敏感字段已在服务端脱敏；无权限时不会返回原始健康数据。</span>
      </div>
      <el-table v-loading="loading" :data="rows" border stripe empty-text="暂无记录">
        <el-table-column v-for="column in columns" :key="column" :prop="column" :label="fieldLabels[column] || column" min-width="145" show-overflow-tooltip>
          <template #default="scope">{{ render(scope.row[column]) }}</template>
        </el-table-column>
        <el-table-column v-if="resource === 'members'" label="健康数据" width="230" fixed="right">
          <template #default="scope">
            <el-button size="small" @click="viewHealth(scope.row, false)">查看摘要</el-button>
            <el-button size="small" type="warning" plain @click="viewHealth(scope.row, true)">原始记录</el-button>
          </template>
        </el-table-column>
        <el-table-column v-if="resource === 'feedback'" label="处理" width="170" fixed="right">
          <template #default="scope">
            <el-select :model-value="scope.row.status" size="small" @change="(value: string) => updateFeedback(scope.row, value)">
              <el-option label="待处理" value="OPEN" /><el-option label="处理中" value="IN_PROGRESS" />
              <el-option label="已解决" value="RESOLVED" /><el-option label="已关闭" value="CLOSED" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column v-if="editable" label="操作" width="95" fixed="right">
          <template #default="scope"><el-button size="small" @click="openEdit(scope.row)">编辑</el-button></template>
        </el-table-column>
      </el-table>
    </template>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="720px" destroy-on-close>
      <el-table v-if="dialogMode === 'health'" :data="detailRows" border max-height="520" empty-text="暂无记录">
        <el-table-column v-for="column in Object.keys(detailRows[0] || {}).slice(0, 9)" :key="column" :label="fieldLabels[column] || column" min-width="145">
          <template #default="scope">{{ render(scope.row[column]) }}</template>
        </el-table-column>
      </el-table>
      <el-form v-else label-width="110px">
        <template v-if="resource === 'articles'">
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="摘要"><el-input v-model="form.summary" type="textarea" /></el-form-item>
          <el-form-item label="分类编号"><el-input v-model="form.categoryId" /></el-form-item>
          <el-form-item label="封面地址"><el-input v-model="form.coverUrl" /></el-form-item>
          <el-form-item label="正文"><el-input v-model="form.contentHtml" type="textarea" :rows="10" /></el-form-item>
          <el-form-item label="状态"><el-select v-model="form.status"><el-option label="草稿" value="DRAFT" /><el-option label="已发布" value="PUBLISHED" /></el-select></el-form-item>
        </template>
        <template v-else-if="resource === 'article-categories'">
          <el-form-item label="分类名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="上级编号"><el-input v-model="form.parentId" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        </template>
        <template v-else-if="resource === 'legal-documents'">
          <el-form-item label="协议类型"><el-input v-model="form.documentType" /></el-form-item>
          <el-form-item label="版本"><el-input v-model="form.version" /></el-form-item>
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="正文"><el-input v-model="form.contentHtml" type="textarea" :rows="10" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
        </template>
        <template v-else-if="resource === 'integrations'">
          <el-form-item label="集成项"><el-input v-model="form.key" disabled /></el-form-item>
          <el-form-item label="状态"><el-select v-model="form.state"><el-option label="未配置" value="UNCONFIGURED" /><el-option label="已配置" value="CONFIGURED" /><el-option label="已停用" value="DISABLED" /><el-option label="异常" value="ERROR" /></el-select></el-form-item>
          <el-form-item label="公开配置"><el-input v-model="form.publicConfigText" type="textarea" :rows="10" /></el-form-item>
          <el-alert title="密钥不在此处填写；生产密钥应通过受控密钥存储和 secretRef 配置。" type="info" :closable="false" />
        </template>
        <template v-else-if="resource === 'settings'">
          <el-form-item label="设置项"><el-input v-model="form.key" disabled /></el-form-item>
          <el-form-item label="公开"><el-switch v-model="form.public" /></el-form-item>
          <el-form-item label="配置内容"><el-input v-model="form.valueText" type="textarea" :rows="12" /></el-form-item>
        </template>
        <template v-else-if="resource === 'admin-users'">
          <el-form-item label="账号"><el-input v-model="form.username" :disabled="Boolean(form.id)" /></el-form-item>
          <el-form-item label="显示名称"><el-input v-model="form.displayName" /></el-form-item>
          <el-form-item v-if="!form.id" label="初始密码"><el-input v-model="form.password" type="password" show-password /></el-form-item>
          <el-form-item label="角色"><el-select v-model="form.role"><el-option label="超级管理员" value="SUPER_ADMIN" /><el-option label="App 运营" value="APP_OPERATIONS" /><el-option label="内容编辑" value="CONTENT_EDITOR" /><el-option label="客服" value="CUSTOMER_SERVICE" /><el-option label="健康数据审计员" value="HEALTH_AUDITOR" /><el-option label="只读" value="READ_ONLY" /></el-select></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
        </template>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">关闭</el-button><el-button v-if="dialogMode === 'edit'" type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </section>
</template>
