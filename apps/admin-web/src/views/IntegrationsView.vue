<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { canAdminResource } from '@saydian/app-contracts';
import { api, getAdminRoles, responseData } from '../api';
import { applicableIntegrationFields, draftFor, integrationDefinitions, integrationPayload, integrationStatus, miniPaymentAppIdPayload, validateIntegrationDraft, type ConfigField, type IntegrationDefinition, type IntegrationDraft, type IntegrationRow } from '../integration-settings';

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
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const saveUncertain = ref(false);
const miniIdOpen = ref(false), miniPaymentAppId = ref(''), miniIdSaving = ref(false), miniIdError = ref('');
function beginMiniId() { miniPaymentAppId.value = ''; miniIdError.value = ''; miniIdOpen.value = true; }
async function saveMiniId() {
  if (!writable.value || miniIdSaving.value) return;
  miniIdError.value = '';
  let payload;
  try { payload = miniPaymentAppIdPayload(miniPaymentAppId.value); }
  catch (error) { miniIdError.value = error instanceof Error ? error.message : '请核对 AppID'; return; }
  miniIdSaving.value = true;
  try {
    const result = responseData<{ miniPaymentAppIdSaved?: boolean }>(await api.patch('/integrations/wechat_pay/mini-app-id', payload));
    if (result?.miniPaymentAppIdSaved !== true) throw new Error('补填保存结果未确认');
    ElMessage.success('小程序 AppID 已补填，原商户资料和 H5 支付配置保留。');
    miniIdOpen.value = false; await load();
  } catch (error: any) {
    miniIdError.value = error?.response?.data?.message || '保存结果待确认，请刷新状态后核对；原支付资料不会被空值覆盖。';
  } finally { miniIdSaving.value = false; }
}
let loadId = 0;
const cards = computed(() => [
  ...integrationDefinitions.map(definition => ({ definition, row: rows.value.find(row => row.key === definition.key) ?? { key: definition.key, state: 'UNCONFIGURED' } })),
  ...rows.value.filter(row => !integrationDefinitions.some(d => d.key === row.key)).map(row => ({ row, definition: { key: row.key, title: '其他接入服务', short: '接', group: '运营与系统', purpose: '由维护人员添加的扩展服务。', prepare: '此服务暂无普通配置表单，请联系维护人员；现有配置不会被覆盖。', fields: [], readOnly: true } as IntegrationDefinition })),
].filter(card => category.value === '全部服务' || card.definition.group === category.value));
const dirty = computed(() => JSON.stringify(draft.value) !== initialDraft.value);
const editable = computed(() => writable.value && !selected.value?.definition.readOnly);
const applicableFields = computed(() => selected.value ? applicableIntegrationFields(selected.value.definition, draft.value) : []);
const hasCredentials = computed(() => applicableFields.value.some(field => field.secret));
const credentialLocked = computed(() => selected.value?.row.key === 'wechat_mini' && selected.value.row.state === 'CONFIGURED');
function fieldDisabled(field: ConfigField): boolean { return !editable.value || Boolean(field.secret && !draft.value.replaceSecrets); }
function fieldPlaceholder(field: ConfigField): string { return field.secret && !draft.value.replaceSecrets ? selected.value?.row.hasSecret ? '已加密保存，修改时请勾选上方选项' : '勾选上方选项后填写凭证' : field.kind === 'pem' ? '粘贴完整 PEM，保留换行' : field.advanced ? '留空沿用服务器配置或默认值' : '请填写'; }

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
  errors.value = {}; saveUncertain.value = false; open.value = true;
}
function clear(): void { open.value = false; selected.value = null; draft.value = { state: 'UNCONFIGURED', replaceSecrets: false, values: {} }; initialDraft.value = ''; errors.value = {}; }
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
  errors.value = {};
}
function validate(): boolean {
  if (!selected.value) return false;
  errors.value = validateIntegrationDraft(selected.value.row, selected.value.definition, draft.value);
  return Object.keys(errors.value).length === 0;
}
function displayDate(value?: string | null): string { if (!value) return '尚无记录'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '时间未获取' : date.toLocaleString('zh-CN', { hour12: false }); }
async function save(): Promise<void> {
  if (saving.value || saveUncertain.value || !editable.value || !selected.value || !validate()) return;
  saving.value = true;
  try {
    const payload = integrationPayload(selected.value.row, selected.value.definition, draft.value);
    await api.patch(`/integrations/${encodeURIComponent(selected.value.row.key)}`, payload);
    ElMessage.success(payload.state === 'CONFIGURED' ? '配置已保存并启用，仍需真实调用验证。' : '配置已保存；没有发起第三方调用。');
    clear(); await load();
  } catch {
    saveUncertain.value = true;
    // A lost response can follow a committed save. Re-read instead of retrying blindly.
    ElMessage.error('保存结果待确认。已重新读取服务状态，请关闭表单并核对后再操作，不要重复提交。');
    await load();
  } finally { saving.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="page integration-page">
    <header class="settings-header"><div><h1 class="page-title">第三方服务配置</h1><p>选择服务，填写参数并保存。</p></div><el-button :loading="loading" @click="load">刷新状态</el-button></header>
    <el-alert v-if="!writable" title="当前账号仅可查看。修改配置需要集成管理员或超级管理员权限。" type="info" :closable="false" show-icon />
    <div class="configuration-note"><span class="note-dot" />保存配置 ≠ 已经接通。只有实际业务调用成功，才会显示“已通过真实调用”。</div>
    <el-tabs v-model="category" class="service-tabs"><el-tab-pane v-for="name in categories" :key="name" :label="name" :name="name" /></el-tabs>
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon class="load-error"><el-button @click="load">重新读取</el-button></el-alert>
    <div v-else v-loading="loading" class="service-grid" :aria-busy="loading">
      <article v-for="{ row, definition } in cards" :key="row.key" class="service-card">
        <div class="card-heading"><span class="service-symbol" aria-hidden="true">{{ definition.short }}</span><div><h2>{{ definition.title }}</h2><span class="service-group">{{ definition.group }}</span></div></div>
        <p class="service-purpose">{{ definition.purpose }}</p>
        <div class="card-status"><el-tag :type="definition.readOnly ? 'info' : integrationStatus(row).tone" effect="plain">{{ definition.readOnly ? '系统接入说明' : integrationStatus(row).label }}</el-tag><span v-if="definition.deployment" class="deployment-label">需服务器配置</span></div>
        <p class="card-help">{{ definition.readOnly ? '日常经营请在商城模块操作。' : row.lastError || row.state === 'ERROR' ? '最近调用异常，请核对配置或联系维护人员。' : definition.deployment ? '此页不填写服务器验证资料。' : row.state === 'CONFIGURED' ? '凭证有效性以实际业务调用结果为准。' : '填写参数后保存。' }}</p>
        <el-button v-if="row.key === 'wechat_pay' && writable && row.state === 'CONFIGURED'" plain :disabled="loading" @click="beginMiniId">补填小程序 AppID</el-button>
        <footer><span>{{ row.lastCheckedAt ? `最近验证 ${displayDate(row.lastCheckedAt)}` : '尚无真实验证记录' }}</span><el-button :type="writable && !definition.readOnly ? 'primary' : 'default'" plain :disabled="loading" @click="begin(row, definition)">{{ definition.readOnly ? '查看说明' : writable ? '配置服务' : '查看配置' }}</el-button></footer>
      </article>
    </div>

    <el-dialog v-model="miniIdOpen" title="补填小程序 AppID" width="520px" :close-on-click-modal="false" :close-on-press-escape="!miniIdSaving" :show-close="!miniIdSaving" destroy-on-close>
      <p>此处仅补填小程序 AppID，保留原商户号、密钥、证书、回调地址和 H5 支付状态。须与“商城微信小程序”的 AppID 一致。</p>
      <el-form label-position="top" @submit.prevent="saveMiniId"><el-form-item label="小程序 AppID"><el-input v-model="miniPaymentAppId" placeholder="wx 开头的 AppID" :disabled="miniIdSaving" /></el-form-item></el-form>
      <el-alert v-if="miniIdError" :title="miniIdError" type="error" :closable="false" />
      <p>保存后仍需在“商城微信小程序”开启小程序支付，并在微信商户平台完成 AppID 绑定。</p>
      <template #footer><el-button :disabled="miniIdSaving" @click="miniIdOpen = false">取消</el-button><el-button type="primary" :loading="miniIdSaving" @click="saveMiniId">仅保存小程序 AppID</el-button></template>
    </el-dialog>
    <el-dialog v-model="open" :title="selected?.definition.title" width="760px" class="integration-dialog" :close-on-click-modal="false" :before-close="beforeClose" destroy-on-close>
      <template v-if="selected">
        <div class="dialog-status"><el-tag :type="integrationStatus(selected.row).tone">{{ integrationStatus(selected.row).label }}</el-tag><span>最近保存：{{ displayDate(selected.row.updatedAt) }}</span></div>
        <section v-if="selected.definition.readOnly" class="preparation"><p>{{ selected.definition.purpose }}</p><p>{{ selected.definition.prepare }}</p></section>
        <el-form v-else label-position="top" class="config-form" :disabled="!editable || saving || saveUncertain" @submit.prevent="save">
          <el-form-item label="服务状态" for="integration-state" class="state-field">
            <el-select id="integration-state" v-model="draft.state" @change="errors = {}">
              <el-option label="启用" value="CONFIGURED" /><el-option label="暂停" value="DISABLED" /><el-option label="暂不启用" value="UNCONFIGURED" /><el-option v-if="selected.row.state === 'ERROR'" label="保持当前异常状态" value="ERROR" />
            </el-select>
            <p class="field-hint">保存不会发起测试。{{ draft.state === 'CONFIGURED' ? '启用后按实际业务调用服务。' : '当前选择不启用服务，已存凭证保留。' }}</p>
          </el-form-item>
          <p v-if="selected.definition.deployment" class="deployment-help">{{ selected.definition.prepare }}</p>
          <div v-if="hasCredentials" class="credential-choice">
            <el-checkbox v-model="draft.replaceSecrets" :disabled="credentialLocked" @change="credentialsChanged">{{ selected.row.hasSecret ? '修改凭证' : '填写凭证' }}</el-checkbox>
            <p>{{ credentialLocked ? '小程序身份需单独核验：先将服务暂停并保存，再更换凭证。' : draft.replaceSecrets ? '将整组替换，请填齐全部仍需使用的凭证；可选项留空不会保留旧值。' : '原凭证不回显；不勾选则保持不变。' }}</p>
          </div>
          <el-alert v-if="errors._form" :title="errors._form" type="error" :closable="false" show-icon />
          <div class="fields-grid">
            <el-form-item v-for="field in applicableFields" :key="field.key" :label="field.label" :for="`integration-${field.key}`" :required="field.required && (!field.secret || draft.replaceSecrets)" :error="errors[field.key]" :class="{ 'wide-field': field.kind === 'pem' || field.kind === 'list' }">
              <el-select v-if="field.options" v-model="draft.values[field.key]" :id="`integration-${field.key}`" :disabled="fieldDisabled(field)" :aria-describedby="`hint-${field.key}`" placeholder="请选择接入方式" @change="errors = {}"><el-option v-for="option in field.options" :key="option.value" :label="option.label" :value="option.value" /><el-option v-if="draft.values[field.key] && !field.options.some(o => o.value === draft.values[field.key])" :label="`原接入方式：${draft.values[field.key]}（请重新选择）`" :value="String(draft.values[field.key])" disabled /></el-select>
              <el-select v-else-if="field.kind === 'boolean'" v-model="draft.values[field.key]" :id="`integration-${field.key}`" :disabled="fieldDisabled(field)" :aria-describedby="`hint-${field.key}`"><el-option label="沿用服务器配置" value="inherit" /><el-option label="开启" value="true" /><el-option label="关闭" value="false" /></el-select>
              <el-input v-else v-model="draft.values[field.key]" :id="`integration-${field.key}`" :type="['pem', 'list'].includes(field.kind || '') ? 'textarea' : field.secret ? 'password' : 'text'" :rows="field.kind === 'pem' ? 5 : 3" :show-password="field.secret && field.kind !== 'pem'" :disabled="fieldDisabled(field)" :aria-describedby="`hint-${field.key}`" autocomplete="off" :maxlength="field.kind === 'pem' ? 16000 : 4000" :placeholder="fieldPlaceholder(field)" />
              <p :id="`hint-${field.key}`" class="field-hint">{{ field.hint }}</p>
            </el-form-item>
          </div>
          <p v-if="selected.definition.note" class="service-note">{{ selected.definition.note }}</p>
        </el-form>
        <el-alert v-if="saveUncertain" title="保存结果待确认。当前表单已停止提交，请关闭并重新打开最新配置核对。" type="error" :closable="false" show-icon />
      </template>
      <template #footer><div class="dialog-actions"><el-button :disabled="saving" @click="close">{{ editable ? '取消' : '关闭' }}</el-button><el-button v-if="editable" type="primary" :loading="saving" :disabled="saveUncertain || (!!selected?.row.updatedAt && !dirty)" @click="save">保存</el-button></div></template>
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
.dialog-status { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; color: #637086; font-size: 13px; }.config-form { margin-top: 22px; }.state-field { max-width: 420px; }.service-note,.deployment-help { color: #637086; font-size: 13px; line-height: 1.7; margin: 4px 0 12px; }.preparation h3 { color: #26354a; margin: 24px 0 8px; font-size: 16px; }.preparation p { line-height: 1.85; color: #4e5c70; }.saved-secret { background: #f2f6fb; border-radius: 6px; padding: 12px; line-height: 1.7; }.technical-detail { margin-top: 20px; color: #627086; font-size: 13px; }.technical-detail summary { cursor: pointer; padding: 5px 0; }
.fields-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); column-gap: 22px; }.wide-field { grid-column: 1/-1; }.config-form :deep(.el-select) { width: 100%; }.config-form :deep(.el-form-item__label) { font-size: 14px; color: #26354a; }.config-form :deep(.el-form-item__content) { display: block; }.field-hint { margin: 7px 0 0; color: #637086; font-size: 13px; line-height: 1.65; }.credential-choice { background: #f5f8fc; border: 1px solid #dce5f0; border-radius: 8px; padding: 14px; margin: 18px 0; }.credential-choice p { margin: 6px 0 0; font-size: 13px; color: #56657b; line-height: 1.6; }.credential-choice :deep(.el-alert) { margin-top: 10px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }.dialog-actions :deep(.el-button + .el-button) { margin-left: 0; }.load-error { margin: 10px 0; }
@media (max-width: 1250px) { .service-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (max-width: 760px) { .service-grid,.fields-grid { grid-template-columns: minmax(0,1fr); }.integration-page { padding: 18px; }.settings-header { align-items: flex-start; }.wide-field { grid-column: auto; } }
</style>
<style>.integration-dialog.el-dialog { max-width: calc(100vw - 32px); border-radius: 12px; }.integration-dialog .el-dialog__body { max-height: 68vh; overflow-y: auto; padding: 6px 8px 10px; }.integration-dialog .el-dialog__title { font-size: 20px; font-weight: 600; }.integration-dialog .el-alert__title { line-height: 1.6; }</style>
