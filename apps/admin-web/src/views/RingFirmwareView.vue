<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { sayRingFirmwareFamilies, sayRingFirmwareTarget } from "@saydian/app-contracts";
import { adminSessionKey, api, getAdminRoles, responseData } from "../api";

type Release = {
  id: string; platform: string; transport: string; model: string; hardware: string;
  fromVersion: string; version: string; minBuild: number; minBattery: number;
  sha256: string; bytes: number; evidence: string; enabled: boolean;
  packageModel: string | null;
};
const allowed = getAdminRoles().some((role) => ["APP_OPERATIONS", "SUPER_ADMIN"].includes(role.toUpperCase()));
const entries = ref<Release[]>([]);
const busy = ref(false);
const formOpen = ref(false);
const error = ref("");
const file = ref<File>();
const form = ref({
  platform: "ios", transport: "qring", model: "", hardware: "", fromVersion: "",
  version: "", minBuild: "", minBattery: "", sha256: "", evidence: "",
});
const models = computed(() => sayRingFirmwareFamilies
  .filter(family => family.transport === form.value.transport)
  .flatMap<string>(family => family.models));
const packageModel = computed(() =>
  sayRingFirmwareTarget(form.value.transport, form.value.model)?.packageModel,
);
const modelLabels: Record<string, string> = { R7Pro: "R7 Pro", R7Ultra: "R7 Ultra (R7u)", R7Y: "R7y" };

function message(problem: unknown) {
  const payload = (problem as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  return typeof payload === "string" ? payload : "操作未完成，请稍后重试。";
}

async function refresh() {
  const session = adminSessionKey();
  try {
    const data = responseData<{entries: Release[]}>(await api.get("/ring-firmware"));
    if (adminSessionKey() === session) entries.value = data.entries;
  } catch (problem) { if (adminSessionKey() === session) error.value = message(problem); }
}

async function stage() {
  if (!file.value || !packageModel.value || busy.value) return;
  const session = adminSessionKey();
  busy.value = true;
  error.value = "";
  try {
    const data = new FormData();
    for (const [key, value] of Object.entries(form.value)) data.append(key, value.trim());
    data.append("packageModel", packageModel.value);
    data.append("file", file.value);
    await api.post("/ring-firmware", data);
    if (adminSessionKey() !== session) return;
    formOpen.value = false;
    file.value = undefined;
    await refresh();
  } catch (problem) { if (adminSessionKey() === session) error.value = message(problem); }
  finally { busy.value = false; }
}

async function setEnabled(row: Release, enabled: boolean) {
  if (busy.value) return;
  const session = adminSessionKey();
  busy.value = true;
  error.value = "";
  try {
    await api.put(`/ring-firmware/${row.id}`, { enabled });
    if (adminSessionKey() === session) await refresh();
  } catch (problem) { if (adminSessionKey() === session) error.value = message(problem); }
  finally { busy.value = false; }
}
onMounted(() => { if (allowed) void refresh(); });
</script>

<template>
  <section v-if="allowed">
    <h1>设备固件</h1>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-button type="primary" @click="formOpen = true">添加原厂固件</el-button>
    <el-table :data="entries" style="margin-top: 16px">
      <el-table-column prop="platform" label="平台" width="90" />
      <el-table-column prop="transport" label="通道" width="110" />
      <el-table-column prop="model" label="型号" min-width="100" />
      <el-table-column prop="packageModel" label="原厂固件包" min-width="120" />
      <el-table-column prop="hardware" label="硬件修订" min-width="120" />
      <el-table-column prop="fromVersion" label="允许源版本" min-width="120" />
      <el-table-column prop="version" label="目标版本" min-width="120" />
      <el-table-column prop="evidence" label="原厂与实测记录" min-width="190" />
      <el-table-column label="分发" min-width="110">
        <template #default="{ row }">
          <el-popconfirm
            :title="row.enabled ? '暂停该固件的后续分发？' : '启用已通过真机验证的固件？'"
            @confirm="setEnabled(row, !row.enabled)"
          >
            <template #reference>
              <el-button :disabled="busy || (!row.enabled && !row.packageModel)">{{ row.enabled ? "暂停分发" : "启用分发" }}</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="formOpen" title="暂存原厂固件" :close-on-click-modal="false">
      <el-form label-position="top" class="firmware-form" @submit.prevent="stage">
        <el-form-item label="平台"><el-select v-model="form.platform">
          <el-option label="iOS" value="ios" /><el-option label="Android" value="android" />
        </el-select></el-form-item>
        <el-form-item label="原厂通道"><el-select v-model="form.transport" @change="form.model = ''">
          <el-option label="QRing" value="qring" /><el-option label="CoolWear" value="coolwear" />
        </el-select></el-form-item>
        <el-form-item label="准确型号"><el-select v-model="form.model">
          <el-option v-for="model in models" :key="model" :label="modelLabels[model] ?? model" :value="model" />
        </el-select></el-form-item>
        <el-form-item v-if="packageModel" label="原厂固件包"><span>{{ packageModel }}</span></el-form-item>
        <el-form-item label="硬件修订"><el-input v-model="form.hardware" /></el-form-item>
        <el-form-item label="允许源版本"><el-input v-model="form.fromVersion" /></el-form-item>
        <el-form-item label="目标版本"><el-input v-model="form.version" /></el-form-item>
        <el-form-item label="最低 App 构建号"><el-input v-model="form.minBuild" inputmode="numeric" /></el-form-item>
        <el-form-item label="原厂最低电量 (%)"><el-input v-model="form.minBattery" inputmode="numeric" /></el-form-item>
        <el-form-item label="原厂文件 SHA-256"><el-input v-model="form.sha256" maxlength="64" /></el-form-item>
        <el-form-item label="原厂适配与真机验证记录">
          <el-input v-model="form.evidence" maxlength="240" />
        </el-form-item>
        <el-form-item label="固件包（8 MB 以内）">
          <input type="file" @change="file = ($event.target as HTMLInputElement).files?.[0]" />
        </el-form-item>
        <el-alert v-if="error" :title="error" type="error" :closable="false" />
        <el-button native-type="submit" type="primary" :loading="busy" :disabled="!file || !packageModel">暂存</el-button>
      </el-form>
    </el-dialog>
  </section>
  <el-alert v-else title="当前账号无法管理固件。" type="warning" :closable="false" />
</template>
