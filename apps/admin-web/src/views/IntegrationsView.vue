<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { canAdminResource } from '@saydian/app-contracts';
import { api, getAdminRoles, responseData } from '../api';
import { draftFor, integrationDefinitions, integrationPayload, integrationStatus, validateIntegrationDraft, type ConfigField, type IntegrationDefinition, type IntegrationDraft, type IntegrationRow } from '../integration-settings';

const rows = ref<IntegrationRow[]>([]);
const loading = ref(false);
const loadError = ref('');
const category = ref('全部服务');
const categories = ['全部服务', '登录与消息', '支付收款', '运营与系统'];
const writable = computed(() => canAdminResource(getAdminRoles(), 'integrations', 'write'));
const selected = ref<{ row: IntegrationRow; definition: IntegrationDefinition } | null>(null);
const draft = ref<IntegrationDraft>({ state: 'UNCONFIGURED', replaceSecrets: false, values: {} });
const initialDraft = ref('');
const open = ref(false);
const step = ref(0);
const advanced = ref<string[]>([]);
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const saveUncertain = ref(false);
const acknowledged = ref(false);
let loadId = 0;
const cards = computed(() => [
  ...integrationDefinitions.map(definition => ({ definition, row: rows.value.find(row => row.key === definition.key) ?? { key: definition.key, state: 'UNCONFIGURED' } })),
  ...rows.value.filter(row => !integrationDefinitions.some(d => d.key === row.key)).map(row => ({ row, definition: { key: row.key, title: '其他接入服务', short: '接', group: '运营与系统', purpose: '由维护人员添加的扩展服务。', prepare: '此服务暂无普通配置表单，请联系维护人员；现有配置不会被覆盖。', fields: [], readOnly: true } as IntegrationDefinition })),
].filter(card => category.value === '全部服务' || card.definition.group === category.value));
const dirty = computed(() => JSON.stringify(draft.value) !== initialDraft.value);
const editable = computed(() => writable.value && !selected.value?.definition.readOnly);
const hasCredentials = computed(() => selected.value?.definition.fields.some(field => field.secret));
const fields = computed(() => selected.value?.definition.fields.filter(field => !field.secret || draft.value.replaceSecrets) ?? []);
const basicFields = computed(() => fields.value.filter(field => !field.advanced));
const advancedFields = computed(() => fields.value.filter(field => field.advanced));
const submitLabel = computed(() => draft.value.state === 'CONFIGURED' ? selected.value?.row.state === 'CONFIGURED' ? '保存并保持启用' : '保存并启用服务' : draft.value.state === 'DISABLED' ? '保存并暂停服务' : '保存资料，暂不启用');

async function load(): Promise<void> {
  const id = ++loadId; loading.value = true; loadError.value = '';
  try {
    const data = responseData<unknown>(await api.get('/integrations'));
    if (!Array.isArray(data)) throw new Error('Unexpected integrations response');
    if (id === loadId) rows.value = data.filter(row => row && typeof row.key === 'string');
  } catch { if (id === loadId) loadError.value = '暂时无法读取服务配置，请重试。当前不允许根据旧数据修改配置。'; }
  finally { if (id === loadId) loading.value = false; }
}
function begin(row: IntegrationRow, definition: IntegrationDefinition): void {
  selected.value = { row: JSON.parse(JSON.stringify(row)) as IntegrationRow, definition };
  draft.value = draftFor(row, definition); initialDraft.value = JSON.stringify(draft.value);
  step.value = 0; errors.value = {}; advanced.value = []; acknowledged.value = false; saveUncertain.value = false; open.value = true;
}
function clear(): void { open.value = false; selected.value = null; draft.value = { state: 'UNCONFIGURED', replaceSecrets: false, values: {} }; initialDraft.value = ''; errors.value = {}; acknowledged.value = false; }
async function allowClose(): Promise<boolean> {
  if (saving.value) return false;
  if (!dirty.value || !editable.value) return true;
  try { await ElMessageBox.confirm('未保存的填写内容将丢弃，凭证不会保留在本机。', '退出配置？', { confirmButtonText: '退出，不保存', cancelButtonText: '继续填写', type: 'warning' }); return true; } catch { return false; }
}
async function close(): Promise<void> { if (await allowClose()) clear(); }
async function beforeClose(done: () => void): Promise<void> { if (await allowClose()) { clear(); done(); } }
onBeforeRouteLeave(async () => { if (open.value && !await allowClose()) return false; clear(); return true; });
onBeforeUnmount(() => { loadId++; clear(); });
function credentialsChanged(): void {
  if (!draft.value.replaceSecrets) for (const field of selected.value?.definition.fields ?? []) if (field.secret) draft.value.values[field.key] = '';
  errors.value = {}; acknowledged.value = false;
}
function validate(): boolean {
  if (!selected.value) return false;
  errors.value = validateIntegrationDraft(selected.value.row, selected.value.definition, draft.value);
  if (Object.keys(errors.value).length) { advanced.value = advancedFields.value.some(field => errors.value[field.key]) ? ['advanced'] : advanced.value; return false; }
  return true;
}
function next(): void { step.value++; errors.value = {}; acknowledged.value = false; }
function displayDate(value?: string | null): string { if (!value) return '尚无记录'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '时间未获取' : date.toLocaleString('zh-CN', { hour12: false }); }
function reviewValue(field: ConfigField): string { const value = draft.value.values[field.key]; return field.secret ? value ? '本次替换（内容隐藏）' : '本次不保存，可能使用服务器配置' : field.kind === 'boolean' ? value === 'inherit' ? '沿用服务器配置' : value === 'true' ? '开启' : '关闭' : field.options?.find(option => option.value === value)?.label ?? String(value || '留空，沿用服务器配置或系统默认'); }
async function save(): Promise<void> {
  if (saving.value || saveUncertain.value || !editable.value || !selected.value || !validate()) return;
  if (!acknowledged.value) { ElMessage.warning('请先确认本次保存的影响。'); return; }
  saving.value = true;
  try {
    const payload = integrationPayload(selected.value.row, selected.value.definition, draft.value);
    await api.patch(`/integrations/${encodeURIComponent(selected.value.row.key)}`, payload);
    ElMessage.success(payload.state === 'CONFIGURED' ? '配置已保存并启用，仍需真实调用验证。' : '配置已保存；没有发起第三方调用。');
    clear(); await load();
  } catch {
    saveUncertain.value = true;
    // Legacy API saves public fields, credentials and state separately; a failure may be partial.
    ElMessage.error('保存结果待确认。已重新读取服务状态，请关闭表单并核对后再操作，不要重复提交。');
    await load();
  } finally { saving.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="page integration-page">
    <header class="settings-header"><div><h1 class="page-title">第三方服务配置</h1><p>选择需要使用的服务，按提示准备资料并填写。无需编辑代码。</p></div><el-button :loading="loading" @click="load">刷新状态</el-button></header>
    <el-alert v-if="!writable" title="当前账号仅可查看。修改配置需要集成管理员或超级管理员权限。" type="info" :closable="false" show-icon />
    <div class="configuration-note"><span class="note-dot" />保存配置 ≠ 已经接通。只有实际业务调用成功，才会显示“已通过真实调用”。</div>
    <el-tabs v-model="category" class="service-tabs"><el-tab-pane v-for="name in categories" :key="name" :label="name" :name="name" /></el-tabs>
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon class="load-error"><el-button @click="load">重新读取</el-button></el-alert>
    <div v-else v-loading="loading" class="service-grid" :aria-busy="loading">
      <article v-for="{ row, definition } in cards" :key="row.key" class="service-card">
        <div class="card-heading"><span class="service-symbol" aria-hidden="true">{{ definition.short }}</span><div><h2>{{ definition.title }}</h2><span class="service-group">{{ definition.group }}</span></div></div>
        <p class="service-purpose">{{ definition.purpose }}</p>
        <div class="card-status"><el-tag :type="definition.readOnly ? 'info' : integrationStatus(row).tone" effect="plain">{{ definition.readOnly ? '系统接入说明' : integrationStatus(row).label }}</el-tag><span v-if="definition.deployment" class="deployment-label">需服务器配置</span></div>
        <p class="card-help">{{ definition.readOnly ? '日常经营请在商城模块操作。' : row.lastError || row.state === 'ERROR' ? '最近调用异常，请核对配置或联系维护人员。' : definition.deployment ? '此页不填写服务器验证资料。' : row.state === 'CONFIGURED' ? '凭证有效性以实际业务调用结果为准。' : '准备好资料后，再按步骤填写。' }}</p>
        <footer><span>{{ row.lastCheckedAt ? `最近验证 ${displayDate(row.lastCheckedAt)}` : '尚无真实验证记录' }}</span><el-button :type="writable && !definition.readOnly ? 'primary' : 'default'" plain :disabled="loading" @click="begin(row, definition)">{{ definition.readOnly ? '查看说明' : writable ? '配置服务' : '查看配置' }}</el-button></footer>
      </article>
    </div>

    <el-dialog v-model="open" :title="selected?.definition.title" width="760px" class="integration-dialog" :close-on-click-modal="false" :before-close="beforeClose" destroy-on-close>
      <template v-if="selected">
        <div class="dialog-status"><el-tag :type="integrationStatus(selected.row).tone">{{ integrationStatus(selected.row).label }}</el-tag><span>最近保存：{{ displayDate(selected.row.updatedAt) }}</span></div>
        <el-steps v-if="editable" :active="step" simple class="setup-steps"><el-step title="准备资料" /><el-step title="填写配置" /><el-step title="确认保存" /></el-steps>
        <section v-if="step === 0 || !editable" class="preparation">
          <h3>这个服务用来做什么？</h3><p>{{ selected.definition.purpose }}</p>
          <h3>先准备这些资料</h3><p>{{ selected.definition.prepare }}</p>
          <el-alert v-if="selected.definition.note" :title="selected.definition.note" type="warning" :closable="false" show-icon />
          <p v-if="selected.row.hasSecret" class="saved-secret">已有加密凭证。默认保持不变，后台不会显示原内容；这不代表凭证已验证。</p>
          <template v-if="!editable && !selected.definition.readOnly"><h3>当前填写情况</h3><dl class="read-summary"><template v-for="field in selected.definition.fields.filter(f => !f.secret)" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ reviewValue(field) }}</dd></template></dl></template>
          <p v-if="!writable" class="field-hint">需要修改时，请联系拥有配置权限的管理员。</p>
          <details class="technical-detail"><summary>供维护人员核对</summary><p>服务标识：{{ selected.row.key }}。密钥只在服务端加密保存；此页不读取原密钥，也不会测试发短信、付款、推送或 ERP 同步。</p></details>
        </section>
        <el-form v-else-if="step === 1" label-position="top" class="config-form" :disabled="saving || saveUncertain" @submit.prevent>
          <el-alert v-if="selected.definition.deployment" :title="selected.definition.note || ''" type="warning" :closable="false" show-icon />
          <div v-if="hasCredentials" class="credential-choice">
            <el-checkbox v-model="draft.replaceSecrets" :disabled="selected.row.state === 'CONFIGURED'" @change="credentialsChanged">{{ selected.row.hasSecret ? '替换整组凭证' : '填写整组凭证' }}</el-checkbox>
            <p v-if="selected.row.state === 'CONFIGURED'">服务正在启用。如需更换凭证，请先在下一步选择“暂停服务”并保存，再重新打开配置。</p>
            <p v-else-if="!draft.replaceSecrets">不勾选则保留原凭证或服务器配置，不提交任何空密钥。</p>
            <el-alert v-else title="将整体替换数据库中的原凭证，请重新填写仍需使用的全部项目。可选项留空不会保留旧值，但可能继续使用服务器环境配置。" type="warning" :closable="false" show-icon />
          </div>
          <el-alert v-if="errors._form" :title="errors._form" type="error" :closable="false" show-icon />
          <div class="fields-grid">
            <el-form-item v-for="field in basicFields" :key="field.key" :label="field.label" :for="`integration-${field.key}`" :required="field.required" :error="errors[field.key]" :class="{ 'wide-field': field.kind === 'pem' }">
              <el-select v-if="field.options" v-model="draft.values[field.key]" :id="`integration-${field.key}`" :aria-describedby="`hint-${field.key}`" placeholder="请选择接入方式"><el-option v-for="option in field.options" :key="option.value" :label="option.label" :value="option.value" /><el-option v-if="draft.values[field.key] && !field.options.some(o => o.value === draft.values[field.key])" :label="`原接入方式：${draft.values[field.key]}（请重新选择）`" :value="String(draft.values[field.key])" disabled /></el-select>
              <el-input v-else-if="field.kind === 'pem'" v-model="draft.values[field.key]" :id="`integration-${field.key}`" type="textarea" :rows="5" :aria-describedby="`hint-${field.key}`" autocomplete="off" :maxlength="16000" placeholder="粘贴完整 PEM，保留所有换行。仅显示本次输入，不回显原凭证。" />
              <el-input v-else v-model="draft.values[field.key]" :id="`integration-${field.key}`" :type="field.secret ? 'password' : 'text'" :show-password="field.secret" :aria-describedby="`hint-${field.key}`" autocomplete="off" :maxlength="4000" placeholder="请填写" />
              <p :id="`hint-${field.key}`" class="field-hint">{{ field.hint }}</p>
            </el-form-item>
          </div>
          <el-collapse v-if="advancedFields.length" v-model="advanced"><el-collapse-item title="高级选项（通常不需要修改）" name="advanced"><div class="fields-grid"><el-form-item v-for="field in advancedFields" :key="field.key" :label="field.label" :for="`integration-${field.key}`" :error="errors[field.key]">
            <el-select v-if="field.kind === 'boolean'" v-model="draft.values[field.key]" :id="`integration-${field.key}`"><el-option label="沿用服务器配置" value="inherit" /><el-option label="开启" value="true" /><el-option label="关闭" value="false" /></el-select>
            <el-input v-else v-model="draft.values[field.key]" :id="`integration-${field.key}`" :type="field.kind === 'list' ? 'textarea' : 'text'" :rows="3" :maxlength="4000" :aria-describedby="`hint-${field.key}`" placeholder="留空沿用服务器配置或系统默认" />
            <p :id="`hint-${field.key}`" class="field-hint">{{ field.hint }}</p>
          </el-form-item></div></el-collapse-item></el-collapse>
          <p v-if="!fields.length && !selected.definition.deployment" class="field-hint">原凭证保持不变。如需更新，请选择上方“填写 / 替换整组凭证”。</p>
        </el-form>
        <section v-else class="save-review">
          <h3>保存后如何使用？</h3>
          <el-radio-group v-model="draft.state" class="state-options" :disabled="saving || saveUncertain" @change="acknowledged = false; errors = {}">
            <el-radio value="UNCONFIGURED" border>仅保存资料，暂不启用</el-radio><el-radio value="CONFIGURED" border>启用服务，等待真实验证</el-radio><el-radio value="DISABLED" border>暂停使用此服务</el-radio><el-radio v-if="selected.row.state === 'ERROR'" value="ERROR" border>保持当前异常状态</el-radio>
          </el-radio-group>
          <el-alert :title="draft.state === 'CONFIGURED' ? '启用后实际业务可能调用供应商，并产生费用或数据传输。保存本身不是连通性验证。' : '保存不会发起供应商测试；已有凭证不会因为暂停服务而被删除。'" :type="draft.state === 'CONFIGURED' ? 'warning' : 'info'" :closable="false" show-icon />
          <p class="saved-secret">{{ draft.replaceSecrets ? '凭证处理：替换整组，不回显内容。' : '凭证处理：全部保持原样。' }}</p>
          <details class="technical-detail"><summary>查看本次填写摘要</summary><dl class="read-summary"><template v-for="field in fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ reviewValue(field) }}</dd></template></dl></details>
          <el-alert v-if="Object.keys(errors).length" title="还有资料需要核对，请返回上一步修改。" type="error" :closable="false"><ul><li v-for="(message, key) in errors" :key="key">{{ message }}</li></ul></el-alert>
          <el-checkbox v-model="acknowledged" :disabled="saving || saveUncertain" class="save-ack">我已核对资料与上述影响，确认{{ draft.replaceSecrets ? '整组替换凭证并' : '' }}{{ draft.state === 'CONFIGURED' ? '启用服务' : draft.state === 'DISABLED' ? '暂停服务' : '保存当前设置' }}</el-checkbox>
        </section>
        <el-alert v-if="saveUncertain" title="保存结果待确认。当前表单已停止提交，请关闭并重新打开最新配置核对。" type="error" :closable="false" show-icon />
      </template>
      <template #footer><div class="dialog-actions"><el-button :disabled="saving" @click="close">{{ editable ? '取消' : '关闭' }}</el-button><template v-if="editable"><el-button v-if="step > 0" :disabled="saving || saveUncertain" @click="step--; errors = {}; acknowledged = false">上一步</el-button><el-button v-if="step < 2" type="primary" :disabled="saveUncertain" @click="next">{{ step === 0 ? '开始填写' : '下一步：确认保存' }}</el-button><el-button v-else type="primary" :loading="saving" :disabled="!acknowledged || saveUncertain || (!!selected?.row.updatedAt && !dirty)" @click="save">{{ submitLabel }}</el-button></template></div></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.integration-page { max-width: 1540px; margin: 0 auto; font-size: 16px; }
.settings-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.settings-header .page-title { margin-bottom: 8px; }.settings-header p { margin: 0; color: #586678; font-size: 15px; line-height: 1.6; }
.configuration-note { display: flex; gap: 10px; align-items: center; color: #435268; background: #eaf2fc; border-radius: 8px; padding: 13px 16px; margin: 16px 0 12px; line-height: 1.6; }.note-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #2874cb; }
.service-tabs :deep(.el-tabs__header) { margin-bottom: 20px; }.service-tabs :deep(.el-tabs__item) { font-size: 15px; }
.service-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 18px; min-height: 160px; }.service-card { display: flex; flex-direction: column; min-width: 0; background: #fff; border: 1px solid #e0e6ee; border-radius: 12px; padding: 20px; }
.card-heading { display: flex; align-items: center; gap: 12px; }.service-symbol { display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px; border-radius: 11px; background: #eef4fc; color: #2769b5; font-size: 18px; font-weight: 700; }.card-heading h2 { font-size: 17px; margin: 0 0 5px; line-height: 1.4; }.service-group { color: #697789; font-size: 13px; }.service-purpose { min-height: 42px; line-height: 1.6; color: #455267; margin: 16px 0; }
.card-status { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }.deployment-label { font-size: 13px; color: #66758b; }.card-help { color: #5c697c; font-size: 13px; line-height: 1.6; margin: 10px 0 20px; flex: 1; }.service-card footer { padding-top: 15px; border-top: 1px solid #edf0f5; display: flex; gap: 10px; align-items: center; justify-content: space-between; }.service-card footer > span { font-size: 12px; line-height: 1.5; color: #697789; }
.dialog-status { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; color: #637086; font-size: 13px; }.setup-steps { margin: 22px 0; }.preparation h3,.save-review h3 { color: #26354a; margin: 24px 0 8px; font-size: 16px; }.preparation p { line-height: 1.85; color: #4e5c70; }.saved-secret { background: #f2f6fb; border-radius: 6px; padding: 12px; line-height: 1.7; }.technical-detail { margin-top: 20px; color: #627086; font-size: 13px; }.technical-detail summary { cursor: pointer; padding: 5px 0; }
.fields-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); column-gap: 22px; }.wide-field { grid-column: 1/-1; }.config-form :deep(.el-select) { width: 100%; }.config-form :deep(.el-form-item__label) { font-size: 14px; color: #26354a; }.config-form :deep(.el-form-item__content) { display: block; }.field-hint { margin: 7px 0 0; color: #637086; font-size: 13px; line-height: 1.65; }.credential-choice { background: #f5f8fc; border: 1px solid #dce5f0; border-radius: 8px; padding: 14px; margin: 18px 0; }.credential-choice p { margin: 6px 0 0; font-size: 13px; color: #56657b; line-height: 1.6; }.credential-choice :deep(.el-alert) { margin-top: 10px; }
.state-options { display: grid; gap: 10px; margin: 16px 0; }.state-options :deep(.el-radio) { margin: 0; height: auto; padding: 12px; white-space: normal; }.state-options :deep(.el-radio__label) { white-space: normal; line-height: 1.5; }.save-ack { margin: 18px 0; height: auto; }.save-ack :deep(.el-checkbox__label) { white-space: normal; line-height: 1.7; }.read-summary { display: grid; grid-template-columns: minmax(120px,1fr) 2fr; gap: 10px 18px; margin: 16px 0; line-height: 1.6; }.read-summary dt { color: #455267; }.read-summary dd { margin: 0; overflow-wrap: anywhere; }.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }.dialog-actions :deep(.el-button + .el-button) { margin-left: 0; }.load-error { margin: 10px 0; }
@media (max-width: 1250px) { .service-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (max-width: 760px) { .service-grid,.fields-grid { grid-template-columns: minmax(0,1fr); }.integration-page { padding: 18px; }.settings-header { align-items: flex-start; }.wide-field { grid-column: auto; }.read-summary { grid-template-columns: 1fr; gap: 5px; }.read-summary dd { margin-bottom: 8px; } }
</style>
<style>.integration-dialog.el-dialog { max-width: calc(100vw - 32px); border-radius: 12px; }.integration-dialog .el-dialog__body { max-height: 68vh; overflow-y: auto; padding: 6px 8px 10px; }.integration-dialog .el-dialog__title { font-size: 20px; font-weight: 600; }.integration-dialog .el-alert__title { line-height: 1.6; }</style>
