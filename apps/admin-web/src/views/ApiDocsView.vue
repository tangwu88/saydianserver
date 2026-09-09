<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, getAdminRoles, readableError, responseData } from "../api";
import { canAdminResource } from "@saydian/app-contracts";

type DocRow = {
  routeKey: string;
  method: string;
  path: string;
  auth: string;
  roles?: string[];
  request?: string;
  response?: string;
  dependency?: string;
  title: string;
  summary: string;
  businessExample?: unknown;
  errorGuidance?: unknown;
  tags: string[];
  deprecated: boolean;
  deprecationNote?: string | null;
  stale: boolean;
  draftRevision: number;
  publishedRevision?: number | null;
  contract?: { status: string; note: string; source: string };
};
type Release = { id: string; version: number; status: string; changeNote: string; createdAt: string; publishedAt?: string | null };

const loading = ref(false);
const canEdit = computed(() => canAdminResource(getAdminRoles(), "api-docs", "write"));
const canPublish = computed(() => getAdminRoles().includes("SUPER_ADMIN"));
const saving = ref(false);
const search = ref("");
const rows = ref<DocRow[]>([]);
const releases = ref<Release[]>([]);
const routeDigest = ref("");
const dialogVisible = ref(false);
const releaseVisible = ref(false);
const form = ref<Record<string, any>>({});
const filteredRows = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return rows.value;
  return rows.value.filter((row) =>
    [row.method, row.path, row.title, row.summary, ...(row.tags ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(keyword),
  );
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [docsResponse, releasesResponse] = await Promise.all([
      api.get("/api-docs"),
      api.get("/api-docs/releases/list"),
    ]);
    const docs = responseData<{ routeDigest: string; items: DocRow[] }>(docsResponse);
    rows.value = docs.items;
    routeDigest.value = docs.routeDigest;
    releases.value = responseData<Release[]>(releasesResponse);
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    loading.value = false;
  }
}

function edit(row: DocRow): void {
  form.value = {
    ...row,
    tagsText: (row.tags ?? []).join("，"),
    businessExampleText: JSON.stringify(row.businessExample ?? {}, null, 2),
    errorGuidanceText: JSON.stringify(row.errorGuidance ?? {}, null, 2),
  };
  dialogVisible.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    await api.patch(`/api-docs/${encodeURIComponent(String(form.value.routeKey))}`, {
      title: form.value.title,
      summary: form.value.summary,
      businessExample: JSON.parse(String(form.value.businessExampleText || "{}")),
      errorGuidance: JSON.parse(String(form.value.errorGuidanceText || "{}")),
      tags: String(form.value.tagsText || "").split(/[,，\r\n]/).map((item) => item.trim()).filter(Boolean),
      deprecated: form.value.deprecated === true,
      deprecationNote: form.value.deprecationNote,
    });
    ElMessage.success("接口说明草稿已保存");
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    saving.value = false;
  }
}

async function createRelease(): Promise<void> {
  try {
    const response = await ElMessageBox.prompt("说明本次接口文档变化，便于审核和回滚。", "创建文档版本", {
      inputPlaceholder: "例如：新增健康报告和统一支付接口",
      inputValidator: (value) => value.trim().length >= 5 || "请填写至少5个字的变更说明",
    });
    await api.post("/api-docs/releases", { changeNote: response.value.trim() });
    ElMessage.success("文档草稿版本已创建");
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(readableError(error));
  }
}

async function releaseAction(release: Release, action: "submit" | "publish" | "rollback"): Promise<void> {
  try {
    const message = action === "submit" ? "确认提交审核？" : action === "publish" ? "确认发布此接口文档版本？" : "确认恢复此历史版本？";
    await ElMessageBox.confirm(message, "文档版本操作", { type: "warning" });
    await api.post(`/api-docs/releases/${release.id}/${action}`, action === "rollback" ? { changeNote: `恢复到版本 ${release.version}` } : undefined);
    ElMessage.success("文档版本状态已更新");
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(readableError(error));
  }
}

async function exportDocs(format: "markdown" | "openapi"): Promise<void> {
  try {
    const data = responseData<{ content: unknown }>(await api.get("/api-docs/export/file", { params: { format } }));
    const content = typeof data.content === "string" ? data.content : JSON.stringify(data.content, null, 2);
    const blob = new Blob([content], { type: format === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = format === "markdown" ? "saydian-api.md" : "saydian-openapi.json";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error(readableError(error));
  }
}

onMounted(load);
</script>

<template>
  <section class="page">
    <h1 class="page-title">接口中心</h1>
    <el-alert title="路由、参数与字段契约来自代码。已复核接口提供真实字段的合成示例和OpenAPI Schema；缺少字段的接口明确标记待完善，不以空模板代表兼容完成。旧接口须检查业务code。" type="info" :closable="false" show-icon />
    <div class="toolbar">
      <el-input v-model="search" placeholder="搜索路径、标题或标签" clearable style="width: 360px" />
      <el-button type="primary" @click="load">刷新</el-button>
      <el-button v-if="canEdit" @click="createRelease">创建发布版本</el-button>
      <el-button @click="releaseVisible = true">版本记录</el-button>
      <el-dropdown @command="exportDocs">
        <el-button>导出文档</el-button>
        <template #dropdown><el-dropdown-menu><el-dropdown-item command="markdown">Markdown</el-dropdown-item><el-dropdown-item command="openapi">OpenAPI</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
      <span class="muted">路由摘要：{{ routeDigest.slice(0, 12) }}</span>
    </div>
    <el-table v-loading="loading" :data="filteredRows" border stripe empty-text="暂无接口" height="calc(100vh - 220px)">
      <el-table-column prop="method" label="方法" width="90" />
      <el-table-column prop="path" label="路径" min-width="330" show-overflow-tooltip />
      <el-table-column prop="title" label="中文说明" min-width="210" show-overflow-tooltip />
      <el-table-column prop="auth" label="鉴权" width="110" />
      <el-table-column label="字段契约" width="130"><template #default="scope"><el-tag :type="scope.row.contract?.status === 'request-reviewed' ? 'success' : 'warning'">{{ scope.row.contract?.status === 'request-reviewed' ? '请求已复核' : '字段待完善' }}</el-tag></template></el-table-column>
      <el-table-column label="状态" width="115"><template #default="scope"><el-tag v-if="scope.row.stale" type="danger">待复核</el-tag><el-tag v-else-if="scope.row.deprecated" type="warning">已弃用</el-tag><el-tag v-else type="success">正常</el-tag></template></el-table-column>
      <el-table-column label="操作" width="90" fixed="right"><template #default="scope"><el-button size="small" @click="edit(scope.row)">{{ canEdit ? '编辑' : '查看' }}</el-button></template></el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="canEdit ? '编辑接口业务说明' : '查看接口业务说明'" width="760px" destroy-on-close>
      <el-alert v-if="form.contract" :title="form.contract.note" :type="form.contract.status === 'request-reviewed' ? 'info' : 'warning'" :closable="false" style="margin-bottom: 16px" />
      <el-form label-width="110px" :disabled="!canEdit">
        <el-form-item label="代码路由"><el-input :model-value="`${form.method} ${form.path}`" disabled /></el-form-item>
        <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="业务说明"><el-input v-model="form.summary" type="textarea" :rows="5" /></el-form-item>
        <el-form-item label="业务示例"><el-input v-model="form.businessExampleText" type="textarea" :rows="10" placeholder="JSON 格式；包含可复制 curl、请求说明及预期返回" /></el-form-item>
        <el-form-item label="错误处理"><el-input v-model="form.errorGuidanceText" type="textarea" :rows="6" placeholder="JSON 格式；按状态码说明处理方式" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="form.tagsText" placeholder="多个标签用逗号分隔" /></el-form-item>
        <el-form-item label="弃用"><el-switch v-model="form.deprecated" /></el-form-item>
        <el-form-item v-if="form.deprecated" label="弃用说明"><el-input v-model="form.deprecationNote" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">关闭</el-button><el-button v-if="canEdit" type="primary" :loading="saving" @click="save">保存草稿</el-button></template>
    </el-dialog>

    <el-dialog v-model="releaseVisible" title="接口文档版本" width="840px">
      <el-table :data="releases" border empty-text="暂无版本">
        <el-table-column prop="version" label="版本" width="80" />
        <el-table-column prop="status" label="状态" width="120" />
        <el-table-column prop="changeNote" label="变更说明" min-width="250" />
        <el-table-column prop="createdAt" label="创建时间" width="180" />
        <el-table-column label="操作" width="210"><template #default="scope"><el-button v-if="canEdit && scope.row.status === 'DRAFT'" size="small" @click="releaseAction(scope.row, 'submit')">提交审核</el-button><el-button v-if="canPublish && scope.row.status === 'IN_REVIEW'" size="small" type="primary" @click="releaseAction(scope.row, 'publish')">发布</el-button><el-button v-if="canPublish && ['PUBLISHED', 'ARCHIVED'].includes(scope.row.status)" size="small" @click="releaseAction(scope.row, 'rollback')">恢复</el-button></template></el-table-column>
      </el-table>
    </el-dialog>
  </section>
</template>
