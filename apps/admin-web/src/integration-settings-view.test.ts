import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { canAdminResource } from '@saydian/app-contracts';
import { draftFor, integrationDefinitions, integrationPayload, integrationStatus, validateIntegrationDraft } from './integration-settings';

// Exercise the actual SFC's script with explicit UI/network substitutes, not a duplicate save implementation.
function harness(role = 'INTEGRATION_ADMIN') {
  const sfc = readFileSync(new URL('./views/IntegrationsView.vue', import.meta.url), 'utf8');
  const source = ts.createSourceFile('view.ts', sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(source.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, source)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const api = { get: vi.fn(async () => ({ data: { data: [] } })), patch: vi.fn(async () => ({ data: { data: {} } })) };
  const messages = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
  const confirm = vi.fn(async () => 'confirm');
  const deps = { computed, ref, onBeforeUnmount: vi.fn(), onMounted: vi.fn(), onBeforeRouteLeave: vi.fn(), ElMessage: messages, ElMessageBox: { confirm }, canAdminResource, api, getAdminRoles: () => [role], responseData: (response: any) => response.data.data, draftFor, integrationDefinitions, integrationPayload, integrationStatus, validateIntegrationDraft };
  const instance = new Function(...Object.keys(deps), code + '\nreturn { load, begin, next, save, close, clear, credentialsChanged, draft, selected, step, errors, acknowledged, saveUncertain, loading, loadError, saving, editable, open };')(...Object.values(deps));
  return { ...instance, api, messages, confirm, definition: integrationDefinitions.find(d => d.key === 'sms')! };
}
const fixture = { key: 'sms', state: 'UNCONFIGURED', hasSecret: true, publicConfig: { provider: 'webhook', retained: { keep: true } }, updatedAt: '2026-09-09T00:00:00Z' };
describe('integration setup interaction boundaries', () => {
  it('keeps readonly accounts out of save even when called outside the template', async () => {
    const h = harness('READ_ONLY'); h.begin(fixture, h.definition); h.acknowledged.value = true; await h.save();
    expect(h.editable.value).toBe(false); expect(h.api.patch).not.toHaveBeenCalled();
  });
  it('requires confirmation and valid fields before any request', async () => {
    const h = harness(); h.begin(fixture, h.definition); await h.save(); expect(h.api.patch).not.toHaveBeenCalled();
    h.acknowledged.value = true; h.draft.value.replaceSecrets = true; h.draft.value.values.webhookUrl = 'invalid'; await h.save();
    expect(h.errors.value.webhookUrl).toBeTruthy(); expect(h.errors.value.webhookToken).toBeTruthy(); expect(h.api.patch).not.toHaveBeenCalled();
  });
  it('preserves unchanged credentials and hidden public fields during a successful save', async () => {
    const h = harness(); h.begin(fixture, h.definition); h.draft.value.values.webhookUrl = 'https://example.com/synthetic'; h.acknowledged.value = true; await h.save();
    expect(h.api.patch).toHaveBeenCalledExactlyOnceWith('/integrations/sms', { state: 'UNCONFIGURED', publicConfig: { provider: 'webhook', retained: { keep: true }, webhookUrl: 'https://example.com/synthetic' } });
    expect(h.open.value).toBe(false); expect(h.selected.value).toBe(null); expect(h.draft.value.values).toEqual({}); expect(h.api.get).toHaveBeenCalledTimes(1);
  });
  it('sends only one request while save is in flight', async () => {
    const h = harness(); h.begin(fixture, h.definition); h.acknowledged.value = true;
    let finish!: () => void; h.api.patch.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = h.save(); await h.save(); expect(h.api.patch).toHaveBeenCalledTimes(1); expect(h.saving.value).toBe(true);
    finish(); await pending; expect(h.saving.value).toBe(false);
  });
  it('does not retry a failed save and refreshes status without claiming rollback', async () => {
    const h = harness(); h.begin(fixture, h.definition); h.acknowledged.value = true; h.api.patch.mockRejectedValueOnce(new Error('synthetic network failure'));
    await h.save(); await h.save();
    expect(h.api.patch).toHaveBeenCalledTimes(1); expect(h.api.get).toHaveBeenCalledTimes(1); expect(h.saveUncertain.value).toBe(true);
    expect(h.messages.error.mock.calls[0][0]).toContain('保存结果待确认'); expect(h.messages.success).not.toHaveBeenCalled();
  });
  it('clears abandoned plaintext fields on confirmed cancel and does not submit', async () => {
    const h = harness(); h.begin(fixture, h.definition); h.draft.value.replaceSecrets = true; h.draft.value.values.webhookToken = 'synthetic-discard-me';
    await h.close(); expect(h.confirm).toHaveBeenCalledTimes(1); expect(h.api.patch).not.toHaveBeenCalled(); expect(h.draft.value.values).toEqual({});
    h.begin(fixture, h.definition); expect(h.draft.value.values.webhookToken).toBe('');
  });
  it('keeps the form when the user declines discarding and clears secrets when replacement is unchecked', async () => {
    const h = harness(); h.begin(fixture, h.definition); h.draft.value.replaceSecrets = true; h.draft.value.values.webhookToken = 'synthetic-discard-me';
    h.confirm.mockRejectedValueOnce('cancel'); await h.close(); expect(h.open.value).toBe(true);
    h.draft.value.replaceSecrets = false; h.credentialsChanged(); expect(h.draft.value.values.webhookToken).toBe(''); expect(h.api.patch).not.toHaveBeenCalled();
  });
  it('allows reaching the pause choice before validating inherited server fields', async () => {
    const h = harness(); h.begin({ ...fixture, state: 'CONFIGURED', publicConfig: {} }, h.definition);
    h.next(); h.next(); expect(h.step.value).toBe(2); h.draft.value.state = 'DISABLED'; h.acknowledged.value = true; await h.save();
    expect(h.api.patch).toHaveBeenCalledExactlyOnceWith('/integrations/sms', { state: 'DISABLED', publicConfig: {} });
  });
  it('handles malformed or failed reads without inventing successful states', async () => {
    const h = harness(); h.api.get.mockResolvedValueOnce({ data: { data: {} } }); await h.load();
    expect(h.loadError.value).toContain('无法读取'); expect(h.loading.value).toBe(false);
  });
});
