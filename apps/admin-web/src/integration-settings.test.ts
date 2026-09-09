import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { canAdminResource } from '@saydian/app-contracts';
import { draftFor, integrationDefinitions, integrationPayload, integrationStatus, validateIntegrationDraft, type IntegrationRow } from './integration-settings';

const definition = (key: string) => integrationDefinitions.find(row => row.key === key)!;
const row = (key = 'sms', extra: Partial<IntegrationRow> = {}): IntegrationRow => ({ key, state: 'UNCONFIGURED', publicConfig: {}, ...extra });
describe('plain-language integration settings', () => {
  it('covers all twelve built-in services without conflating official and native WeChat', () => {
    expect(new Set(integrationDefinitions.map(d => d.key)).size).toBe(12);
    expect(definition('wechat_official').fields.some(f => f.key === 'redirectUri')).toBe(true);
    expect(definition('wechat_login').fields.some(f => f.key === 'redirectUri')).toBe(false);
  });
  it('does not let a saved status masquerade as a successful provider call', () => {
    expect(integrationStatus(row('sms', { state: 'CONFIGURED' })).label).toContain('待验证');
    expect(integrationStatus(row('sms', { hasSecret: true })).label).toContain('未启用');
    expect(integrationStatus(row('sms', { state: 'CONFIGURED', verificationStatus: 'VERIFIED' })).tone).not.toBe('success');
    expect(integrationStatus(row('sms', { state: 'CONFIGURED', verificationStatus: 'VERIFIED', lastCheckedAt: '2026-09-09T00:00:00Z' })).tone).toBe('success');
  });
  it('shows failures and disabled state accurately', () => {
    expect(integrationStatus(row('sms', { state: 'ERROR' })).label).toBe('需要检查');
    expect(integrationStatus(row('sms', { state: 'CONFIGURED', lastError: 'synthetic failure' })).tone).toBe('danger');
    expect(integrationStatus(row('sms', { state: 'DISABLED', lastError: 'old failure' })).label).toBe('已暂停');
  });
  it('never reads secret-looking public values into credential inputs', () => {
    const draft = draftFor(row('ai', { publicConfig: { apiKey: 'should-not-be-echoed' } }), definition('ai'));
    expect(draft.values.apiKey).toBe(''); expect(draft.replaceSecrets).toBe(false);
  });
  it('omits secret writes and clearSecrets by default, retaining state', () => {
    const original = row('sms', { state: 'DISABLED', hasSecret: true, publicConfig: { provider: 'webhook', opaqueOption: { retain: [1, 2] } } });
    const draft = draftFor(original, definition('sms')); draft.values.webhookUrl = 'https://example.com/sms';
    const payload = integrationPayload(original, definition('sms'), draft);
    expect(payload.state).toBe('DISABLED'); expect(payload).not.toHaveProperty('secrets'); expect(payload).not.toHaveProperty('clearSecrets');
    expect(payload.publicConfig.opaqueOption).toEqual({ retain: [1, 2] });
  });
  it('preserves unedited nested and unknown public settings even from a Vue proxy', () => {
    const original = reactive(row('jushuitan', { publicConfig: { paths: { sku: '/custom/sku', unknown: '/leave/me' }, extra: { x: 3 } } }));
    const draft = draftFor(original, definition('jushuitan')); draft.values['paths.orderUpload'] = '/custom/order';
    const payload = integrationPayload(original, definition('jushuitan'), draft);
    expect(payload.publicConfig.paths).toEqual({ sku: '/custom/sku', unknown: '/leave/me', orderUpload: '/custom/order' });
    expect(payload.publicConfig.extra).toEqual({ x: 3 }); expect(original.publicConfig?.paths).toEqual({ sku: '/custom/sku', unknown: '/leave/me' });
  });
  it('does not override an inherited boolean or null default without a user change', () => {
    for (const publicConfig of [{}, { forcePathStyle: null }, { forcePathStyle: true }]) {
      const original = row('object_storage', { publicConfig }); const draft = draftFor(original, definition('object_storage'));
      expect(integrationPayload(original, definition('object_storage'), draft).publicConfig).toEqual(publicConfig);
    }
  });
  it('saves an explicitly changed boolean and preserves unrelated values', () => {
    const original = row('object_storage', { publicConfig: { forcePathStyle: true, keep: 9 } }); const draft = draftFor(original, definition('object_storage'));
    draft.values.forcePathStyle = 'false';
    expect(integrationPayload(original, definition('object_storage'), draft).publicConfig).toEqual({ forcePathStyle: false, keep: 9 });
  });
  it('requires all required credentials for an explicit replacement', () => {
    const original = row('wecom', { hasSecret: true }); const draft = draftFor(original, definition('wecom')); draft.replaceSecrets = true; draft.values.corpId = 'synthetic-corp';
    const errors = validateIntegrationDraft(original, definition('wecom'), draft);
    expect(errors.agentId).toBeTruthy(); expect(errors.secret).toBeTruthy();
    expect(() => integrationPayload(original, definition('wecom'), draft)).toThrow();
  });
  it('blocks replacing credentials in a running service even if the same draft says pause', () => {
    const original = row('sms', { state: 'CONFIGURED', hasSecret: true }); const draft = draftFor(original, definition('sms'));
    draft.state = 'DISABLED'; draft.replaceSecrets = true; draft.values.webhookToken = 'synthetic-not-a-real-token';
    expect(validateIntegrationDraft(original, definition('sms'), draft)._form).toContain('先暂停');
  });
  it('writes only intentionally supplied credential values and retains non-secret settings', () => {
    const original = row('sms', { publicConfig: { keep: true } }); const draft = draftFor(original, definition('sms'));
    draft.replaceSecrets = true; draft.values.webhookToken = '  synthetic-not-a-real-token  '; draft.values.provider = 'webhook';
    const payload = integrationPayload(original, definition('sms'), draft);
    expect(payload.secrets).toEqual({ webhookToken: 'synthetic-not-a-real-token' }); expect(payload.state).toBe('UNCONFIGURED');
    expect(payload.publicConfig).toEqual({ keep: true, provider: 'webhook' }); expect(payload.publicConfig).not.toHaveProperty('webhookToken');
  });
  it('does not submit abandoned replacement inputs when replacement is unchecked', () => {
    const original = row(); const draft = draftFor(original, definition('sms')); draft.values.webhookToken = 'discarded-synthetic-value';
    expect(integrationPayload(original, definition('sms'), draft)).not.toHaveProperty('secrets');
  });
  it('blocks accidental enablement without any saved or replacement credentials', () => {
    const original = row(); const draft = draftFor(original, definition('sms')); draft.state = 'CONFIGURED'; draft.values.webhookUrl = 'https://example.com/sms';
    expect(validateIntegrationDraft(original, definition('sms'), draft)._form).toContain('尚未保存凭证');
  });
  it('requires public connection details before newly enabling', () => {
    const original = row('ai', { hasSecret: true }); const draft = draftFor(original, definition('ai')); draft.state = 'CONFIGURED';
    const errors = validateIntegrationDraft(original, definition('ai'), draft); expect(errors.baseUrl).toBeTruthy(); expect(errors.model).toBeTruthy();
  });
  it('offers no fake/mock provider choice and keeps nonfunctional commerce controls read-only', () => {
    expect(integrationDefinitions.flatMap(d => d.fields.flatMap(f => f.options ?? [])).some(o => ['mock', 'disabled'].includes(o.value))).toBe(false);
    expect(definition('commerce').readOnly).toBe(true); expect(definition('apple_iap').deployment).toBe(true); expect(definition('apple_iap').fields).toEqual([]);
    expect(() => integrationPayload(row('commerce'), definition('commerce'), draftFor(row('commerce'), definition('commerce')))).toThrow();
  });
  it('does not permit an unsupported saved provider to be silently enabled', () => {
    const original = row('sms', { publicConfig: { provider: 'mock' } }); const draft = draftFor(original, definition('sms'));
    draft.state = 'CONFIGURED';
    expect(validateIntegrationDraft(original, definition('sms'), draft).provider).toBeTruthy();
  });
  it('can explicitly pause an environment-configured service without filling or changing its public fields', () => {
    for (const key of ['sms', 'ai', 'object_storage']) {
      const original = row(key, { state: 'CONFIGURED', publicConfig: {} }); const draft = draftFor(original, definition(key)); draft.state = 'DISABLED';
      expect(validateIntegrationDraft(original, definition(key), draft)).toEqual({});
      expect(integrationPayload(original, definition(key), draft)).toEqual({ state: 'DISABLED', publicConfig: {} });
    }
  });
  it('represents inherited booleans and old string booleans without losing explicit false', () => {
    for (const value of [undefined, null, true, 'true', '1', 'yes']) {
      const original = row('object_storage', { publicConfig: value === undefined ? {} : { forcePathStyle: value } }); const draft = draftFor(original, definition('object_storage'));
      expect(draft.values.forcePathStyle).toBe(value == null ? 'inherit' : 'true'); draft.values.forcePathStyle = 'false';
      expect(integrationPayload(original, definition('object_storage'), draft).publicConfig.forcePathStyle).toBe(false);
    }
    const original = row('object_storage', { publicConfig: { forcePathStyle: true } }); const draft = draftFor(original, definition('object_storage')); draft.values.forcePathStyle = 'inherit';
    expect(integrationPayload(original, definition('object_storage'), draft).publicConfig.forcePathStyle).toBe(null);
  });
  it('preserves multiline PEM content for replacement', () => {
    const original = row('alipay'); const draft = draftFor(original, definition('alipay')); draft.replaceSecrets = true;
    draft.values.appId = 'synthetic-app'; draft.values.privateKeyPem = '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----'; draft.values.publicKeyPem = '-----BEGIN PUBLIC KEY-----\nsynthetic\n-----END PUBLIC KEY-----';
    const payload = integrationPayload(original, definition('alipay'), draft); expect(payload.secrets?.privateKeyPem).toBe(draft.values.privateKeyPem); expect(payload.secrets?.publicKeyPem).toBe(draft.values.publicKeyPem);
  });
  it('rejects URL credentials and insecure remote URLs while allowing local loopback', () => {
    const original = row(); const draft = draftFor(original, definition('sms'));
    for (const value of ['http://example.com/sms', 'https://user:secret@example.com', 'https://example.com/#token', 'javascript:alert(1)']) { draft.values.webhookUrl = value; expect(validateIntegrationDraft(original, definition('sms'), draft).webhookUrl).toBeTruthy(); }
    draft.values.webhookUrl = 'http://127.0.0.1:8081/local'; expect(validateIntegrationDraft(original, definition('sms'), draft).webhookUrl).toBeUndefined();
  });
  it('rejects query-bearing official redirects and invalid redirect domains', () => {
    let original = row('wechat_official'), draft = draftFor(original, definition('wechat_official')); draft.values.redirectUri = 'https://example.com/callback?x=1';
    expect(validateIntegrationDraft(original, definition('wechat_official'), draft).redirectUri).toBeTruthy();
    original = row('wecom'); draft = draftFor(original, definition('wecom')); draft.values.allowedRedirectHosts = 'https://example.com/page';
    expect(validateIntegrationDraft(original, definition('wecom'), draft).allowedRedirectHosts).toBeTruthy();
    draft.values.allowedRedirectHosts = 'shop.example.com\nlocalhost:5174'; expect(integrationPayload(original, definition('wecom'), draft).publicConfig.allowedRedirectHosts).toEqual(['shop.example.com', 'localhost:5174']);
  });
  it('requires a WeChat payment channel and checks key length without echoing credentials', () => {
    const original = row('wechat_pay'), draft = draftFor(original, definition('wechat_pay')); draft.replaceSecrets = true; draft.values.apiV3Key = 'synthetic-short';
    const errors = validateIntegrationDraft(original, definition('wechat_pay'), draft); expect(errors.appIdOfficial).toBeTruthy(); expect(errors.apiV3Key).toContain('32'); expect(JSON.stringify(errors)).not.toContain('synthetic-short');
    for (const key of ['appIdApp', 'appIdMini', 'appIdOfficial', 'appSecretMini']) expect(definition('wechat_pay').fields.find(f => f.key === key)?.secret).toBe(true);
  });
  it('does not accept public/private PEM fields interchanged', () => {
    const original = row('alipay'), draft = draftFor(original, definition('alipay')); draft.replaceSecrets = true;
    draft.values.privateKeyPem = '-----BEGIN PUBLIC KEY-----\nsynthetic\n-----END PUBLIC KEY-----';
    draft.values.publicKeyPem = '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----';
    const errors = validateIntegrationDraft(original, definition('alipay'), draft); expect(errors.privateKeyPem).toBeTruthy(); expect(errors.publicKeyPem).toBeTruthy();
  });
  it('preserves integration-only authorization and readonly inspection', () => {
    for (const role of ['SUPER_ADMIN', 'INTEGRATION_ADMIN']) expect(canAdminResource(role, 'integrations', 'write')).toBe(true);
    for (const role of ['READ_ONLY', 'APP_OPERATIONS', 'COMMERCE_OPERATIONS', 'FINANCE']) expect(canAdminResource(role, 'integrations', 'write')).toBe(false);
    expect(canAdminResource('READ_ONLY', 'integrations', 'read')).toBe(true);
  });
});
