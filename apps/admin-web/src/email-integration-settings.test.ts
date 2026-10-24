import { describe, expect, it } from 'vitest';
import { applicableIntegrationFields, draftFor, integrationDefinitions, integrationPayload, validateIntegrationDraft } from './integration-settings';
const definition = integrationDefinitions.find(d => d.key === 'email_otp')!;
describe('enterprise email settings', () => {
  it('switches to Aliyun with encrypted AccessKeys and fixed region fields', () => {
    const row = { key: 'email_otp', state: 'UNCONFIGURED', hasSecret: false, publicConfig: { provider: 'webhook', webhookUrl: 'https://example.invalid/mail' } };
    const draft = draftFor(row, definition);
    draft.state = 'CONFIGURED'; draft.replaceSecrets = true;
    Object.assign(draft.values, { provider: 'aliyun_dm', accessKeyId: 'synthetic-id', accessKeySecret: 'synthetic-secret', accountName: 'sender@example.com', deliveryVerified: 'false' });
    const payload = integrationPayload(row, definition, draft);
    expect(payload.secrets).toEqual({ accessKeyId: 'synthetic-id', accessKeySecret: 'synthetic-secret' });
    expect(payload.publicConfig).toMatchObject({ provider: 'aliyun_dm', accountName: 'sender@example.com' });
    expect(payload.publicConfig).not.toHaveProperty('webhookUrl');
    expect(JSON.stringify(payload.publicConfig)).not.toContain('synthetic-secret');
    draft.values.accountName = 'bad';
    expect(validateIntegrationDraft(row, definition, draft).accountName).toBeTruthy();
  });
  it('switches from webhook with only the selected fields and encrypts the SMTP password', () => {
    const row = { key: 'email_otp', state: 'UNCONFIGURED', hasSecret: false, publicConfig: { provider: 'webhook', webhookUrl: 'https://example.invalid/mail' } };
    const draft = draftFor(row, definition);
    draft.state = 'CONFIGURED'; draft.replaceSecrets = true;
    Object.assign(draft.values, { provider: 'wecom_smtp', fromAddress: 'sender@example.com', smtpPassword: 'synthetic-client-secret', deliveryVerified: 'false' });
    expect(applicableIntegrationFields(definition, draft).map(f => f.key)).toEqual(['provider', 'fromAddress', 'smtpPassword', 'deliveryVerified']);
    const payload = integrationPayload(row, definition, draft);
    expect(payload.publicConfig).toEqual({ provider: 'wecom_smtp', fromAddress: 'sender@example.com', deliveryVerified: false });
    expect(payload.secrets).toEqual({ smtpPassword: 'synthetic-client-secret' });
  });
  it('requires an email sender and a new credential when switching providers', () => {
    const row = { key: 'email_otp', state: 'CONFIGURED', hasSecret: true, publicConfig: { provider: 'webhook' } };
    const draft = draftFor(row, definition);
    Object.assign(draft.values, { provider: 'wecom_smtp', fromAddress: 'not-an-email' });
    expect(validateIntegrationDraft(row, definition, draft).fromAddress).toBeTruthy();
    expect(validateIntegrationDraft(row, definition, draft)._form).toBeTruthy();
  });
});
