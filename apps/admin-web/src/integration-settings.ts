export type IntegrationRow = { key: string; state: string; publicConfig?: Record<string, unknown>; hasSecret?: boolean; verificationStatus?: string; lastCheckedAt?: string | null; lastError?: string | null; updatedAt?: string };
export type ConfigField = { key: string; label: string; hint: string; secret?: boolean; required?: boolean; kind?: 'text' | 'url' | 'pem' | 'list' | 'boolean'; advanced?: boolean; options?: { label: string; value: string }[]; defaultValue?: string };
export type IntegrationDefinition = { key: string; title: string; group: string; short: string; purpose: string; prepare: string; note?: string; readOnly?: boolean; deployment?: boolean; fields: ConfigField[] };
const p = (key: string, label: string, hint: string, extra: Partial<ConfigField> = {}): ConfigField => ({ key, label, hint, ...extra });
const s = (key: string, label: string, hint: string, extra: Partial<ConfigField> = {}): ConfigField => p(key, label, hint, { secret: true, required: true, ...extra });
const provider = (value: string, label: string) => p('provider', '接入方式', '仅列出当前系统已经支持的方式；未选择时保留服务器配置。', { required: true, options: [{ value, label }] });
const url = (key: string, label: string, hint: string, extra: Partial<ConfigField> = {}) => p(key, label, hint, { kind: 'url', ...extra });
const appIdentity = [s('appId', '应用编号（AppID）', '从对应微信应用的开发资料中复制；不同类型应用不能混用。'), s('appSecret', '应用密钥（AppSecret）', '由该微信应用的管理员提供，不是微信登录密码。')];
export const integrationDefinitions: IntegrationDefinition[] = [
  { key: 'sms', title: '短信验证码', group: '登录与消息', short: '短', purpose: '发送注册、登录和绑定手机的验证码。', prepare: '请短信服务维护人员提供发送地址和访问令牌。目前使用短信中转接口，不直接填写阿里云或腾讯云短信账号。', fields: [provider('webhook', '短信中转接口'), url('webhookUrl', '短信发送地址', '由维护人员提供的 HTTPS 地址；不在地址中放入密钥。', { required: true }), s('webhookToken', '访问令牌', '用于验证短信发送请求，由短信接口维护人员提供。')] },
  { key: 'wechat_login', title: 'App 微信登录', group: '登录与消息', short: '微', purpose: '让手机 App 用户使用微信登录。', prepare: '准备微信开放平台中的移动应用 AppID 和 AppSecret。这里不填写公众号或小程序资料。', fields: appIdentity },
  { key: 'wechat_official', title: '商城微信登录', group: '登录与消息', short: '商', purpose: '在微信内打开商城时使用公众号网页授权。', prepare: '准备公众号 AppID、AppSecret 和授权返回地址；公众号网页授权域名需由维护人员核对。', note: '返回地址须与服务器配置的商城地址同源，不带问号参数或 #。要使用微信内支付，还需与微信支付中的公众号 AppID 一致。', fields: [...appIdentity, url('redirectUri', '授权返回地址', '由维护人员提供的商城授权返回页面地址，不是接口地址。', { required: true })] },
  { key: 'push', title: 'App 消息推送', group: '登录与消息', short: '推', purpose: '通过极光推送向手机发送通知。', prepare: '准备极光推送应用的 AppKey 和 Master Secret，并确认 App 已接入同一推送应用。', note: '保存后需要维护人员重启消息任务服务才能加载新配置。此页不发送测试通知。', fields: [provider('jpush', '极光推送'), s('appKey', '应用标识（AppKey）', '从极光应用资料复制。'), s('masterSecret', '服务端密钥（Master Secret）', '从同一极光应用资料复制，仅在服务器使用。')] },
  { key: 'wechat_pay', title: '微信支付', group: '支付收款', short: '付', purpose: '接收微信付款并处理退款。', prepare: '准备微信商户号、商户证书序列号、商户私钥、微信平台公钥及编号、API v3 密钥，以及实际使用渠道的 AppID。', note: '这一组同时影响 App、小程序和 H5。更换时要重新填写所有仍在使用的渠道资料。小程序 AppSecret 还用于小程序登录。', fields: [
    s('merchantId', '微信商户号', '商户收款账户编号，不是 AppID。'), s('serialNo', '商户证书序列号', '与下面商户私钥配套的证书序列号。'),
    s('apiV3Key', 'API v3 密钥', '微信商户平台设置的 32 字节密钥，不是商户登录密码。'),
    s('privateKeyPem', '商户私钥', '粘贴完整 PEM 内容，包括 BEGIN / END 两行。', { kind: 'pem' }),
    s('platformSerialNo', '微信平台公钥编号或证书序列号', '须与下面用于验证微信通知的公钥匹配。'), s('platformPublicKeyPem', '微信平台公钥', '不是商户私钥。粘贴完整公钥或平台证书 PEM。', { kind: 'pem' }),
    s('appIdOfficial', '公众号 AppID（微信内 / H5 / 扫码）', '微信内支付应与“商城微信登录”的公众号 AppID 相同。', { required: false }),
    s('appIdApp', '移动应用 AppID（手机 App）', '需要原生 App 支付时填写。', { required: false }), s('appIdMini', '小程序 AppID', '需要小程序支付或登录时填写，不要填公众号 AppID。', { required: false }), s('appSecretMini', '小程序 AppSecret', '需要小程序微信登录时填写；替换时请保留仍在使用的这项资料。', { required: false }),
    url('notifyUrl', '付款通知地址', '通常留空，由服务器生成；自定义时请由维护人员核对。', { advanced: true }), url('refundNotifyUrl', '退款通知地址', '通常留空，由服务器生成。', { advanced: true }),
  ] },
  { key: 'alipay', title: '支付宝支付', group: '支付收款', short: '支', purpose: '支持支付宝付款、退款和支付通知验证。', prepare: '准备支付宝开放平台应用编号、应用私钥和支付宝公钥，确认该应用已开通所需支付产品。', fields: [s('appId', '支付宝应用编号（AppID）', '从支付宝开放平台应用资料复制。'), s('privateKeyPem', '应用私钥', '粘贴完整 PEM 内容；不能填写支付宝公钥。', { kind: 'pem' }), s('publicKeyPem', '支付宝公钥', '用于验证支付宝响应和通知。', { kind: 'pem' }), url('gateway', '支付网关', '通常留空，使用支付宝官方网关；只有沙箱或特殊接入才修改。', { advanced: true }), url('notifyUrl', '付款通知地址', '通常留空，由服务器生成。', { advanced: true }), url('returnUrl', '非商城支付返回地址', '商城订单始终使用服务器的商城返回页面；此项不改变商城返回地址。', { advanced: true })] },
  { key: 'apple_iap', title: '苹果应用内购买', group: '支付收款', short: '苹', purpose: '处理 iPhone 的 App Store 应用内购买。', prepare: '请维护人员在服务器配置 App 的 Bundle ID、苹果根证书、验证环境，以及正式环境中的 Apple App ID，然后重启 API。', note: '此页只能保存启用状态。服务器验证资料不能在这里填写；状态开启不代表苹果验证已接通。退款由 App Store 处理。', deployment: true, fields: [] },
  { key: 'wecom', title: '企业微信员工推广', group: '运营与系统', short: '企', purpose: '员工登录、商品推广和推广归属。', prepare: '准备企业 ID、企业微信应用 ID 和应用 Secret，并请企业管理员配置可信域名。这里不是消费者公众号登录，也不是提现打款配置。', note: '服务器已设置商城地址时以服务器为准；保存这里的地址不会覆盖服务器地址。', fields: [s('corpId', '企业 ID', '企业微信管理资料中的 CorpID。'), s('agentId', '应用 ID', '自建应用的 AgentID，通常为数字。'), s('secret', '应用 Secret', '对应自建应用的密钥，不是企业微信登录密码。'), url('storefrontUrl', '商城地址', '填写用户实际访问的商城完整地址。', { required: true }), p('allowedRedirectHosts', '额外允许返回的域名', '一行一个域名，不含 https:// 或页面路径；通常无需额外填写。', { kind: 'list', advanced: true })] },
  { key: 'jushuitan', title: '聚水潭商品与订单', group: '运营与系统', short: '聚', purpose: '同步 ERP 商品、库存、订单、售后及物流。', prepare: '准备聚水潭应用 AppKey、AppSecret、授权访问令牌和店铺编号。请确认已分别取得查询、订单写入和售后写入权限。', note: '令牌到期需要重新授权并替换；系统尚不支持自动续期。填写资料不代表已获得全部业务权限。', fields: [p('shopId', '店铺编号', '订单和售后写入需要准确的聚水潭店铺编号。', { required: true }), s('appKey', '应用 AppKey', '从聚水潭应用资料复制。'), s('appSecret', '应用 AppSecret', '从同一应用资料复制。'), s('accessToken', '授权访问令牌', '店铺授权后取得的 Access Token，不是账号密码。'), url('apiBase', '接口服务器', '通常留空，使用聚水潭官方接口服务器。', { advanced: true }), ...[['sku', '商品查询'], ['inventory', '库存查询'], ['orderUpload', '订单写入'], ['afterSaleUpload', '售后写入'], ['fulfillment', '物流查询']].map(([key, label]) => p(`paths.${key}`, `${label}接口路径`, '通常留空，沿用系统默认；自定义路径必须以 / 开头。', { advanced: true }))] },
  { key: 'ai', title: 'AI 问答与报告', group: '运营与系统', short: 'AI', purpose: '为问答和健康报告提供 AI 服务。', prepare: '准备兼容 Chat Completions 的服务地址、模型名称和 API Key；服务地址通常包含 /v1，不要再附加 /chat/completions。', note: '所有支持的服务均通过兼容接口调用。保存不会生成报告或产生模型调用费用。', fields: [provider('openai_compatible', '兼容 Chat Completions 的服务'), url('baseUrl', 'AI 服务地址', '例如服务商提供的 https://服务域名/v1。', { required: true }), p('model', '模型名称', '填写服务商实际开通的模型名称，不是自行起的显示名称。', { required: true }), s('apiKey', '访问密钥（API Key）', '从已开通的模型服务取得。')] },
  { key: 'object_storage', title: '图片与文件存储', group: '运营与系统', short: '存', purpose: '保存图片、附件和报告文件。', prepare: '准备 S3 兼容存储的服务地址、存储桶名称及访问凭据。请维护人员确认私有文件访问规则。', note: '这里只支持 S3 兼容接入；不是公开文件开关，不填写 CDN 地址或服务器总加密密钥。', fields: [url('endpoint', '存储服务地址', '由存储服务提供的 Endpoint。', { required: true }), p('bucket', '存储桶名称', '填写已创建的存储桶名称。', { required: true }), s('accessKeyId', '访问标识（Access Key）', '请使用仅有该存储桶必要权限的账号。'), s('secretAccessKey', '访问密钥（Secret Key）', '与访问标识配套的密钥。'), p('region', '存储区域', '通常留空，默认 us-east-1；按服务商要求填写。', { advanced: true }), p('forcePathStyle', '使用路径式地址', '仅在存储服务要求时开启，由维护人员确认。', { kind: 'boolean', advanced: true })] },
  { key: 'commerce', title: '统一商城', group: '运营与系统', short: '店', purpose: '商城与 App 共用本系统的商品、订单和会员。', prepare: '日常经营请进入“商城设置”管理运费、优惠和业务规则。商城网站地址由维护人员在服务器设置。', note: '此项为接入说明，不是商城营业开关。改变旧记录状态不能关闭商城，因此这里不提供无效的开关。', readOnly: true, fields: [] },
];

export type IntegrationDraft = { state: string; replaceSecrets: boolean; values: Record<string, string | boolean> };
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function get(config: Record<string, unknown>, key: string): unknown { return key.split('.').reduce<unknown>((value, part) => object(value)[part], config); }
function put(config: Record<string, unknown>, key: string, value: unknown): void { const [parent, child] = key.split('.'); if (child) config[parent!] = { ...object(config[parent!]), [child]: value }; else config[key] = value; }
export function draftFor(row: IntegrationRow, definition: IntegrationDefinition): IntegrationDraft {
  const values: IntegrationDraft['values'] = {};
  for (const field of definition.fields) { const value = field.secret ? undefined : get(object(row.publicConfig), field.key); values[field.key] = field.kind === 'boolean' ? value == null ? 'inherit' : ['true', '1', 'yes'].includes(String(value).toLowerCase()) ? 'true' : 'false' : Array.isArray(value) ? value.join('\n') : String(value ?? field.defaultValue ?? ''); }
  return { state: row.state || 'UNCONFIGURED', replaceSecrets: false, values };
}
export function integrationStatus(row: IntegrationRow): { label: string; tone: 'success' | 'info' | 'warning' | 'danger' } {
  if (row.state === 'DISABLED') return { label: '已暂停', tone: 'info' };
  if (row.lastError || row.state === 'ERROR') return { label: '需要检查', tone: 'danger' };
  if (row.state === 'CONFIGURED') return row.verificationStatus === 'VERIFIED' && row.lastCheckedAt ? { label: '已通过真实调用', tone: 'success' } : { label: '已启用 · 待验证', tone: 'warning' };
  return { label: row.hasSecret ? '资料已存 · 未启用' : '未配置', tone: 'info' };
}
function safeUrl(value: string): boolean { try { const u = new URL(value); return !u.username && !u.password && !u.hash && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)); } catch { return false; } }
export function validateIntegrationDraft(row: IntegrationRow, definition: IntegrationDefinition, draft: IntegrationDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (definition.readOnly) return { _form: '此项目不通过配置表单更改，请使用商城业务设置。' };
  if (!['UNCONFIGURED', 'CONFIGURED', 'DISABLED', 'ERROR'].includes(draft.state)) errors._form = '请选择服务状态。';
  if (draft.replaceSecrets && row.state === 'CONFIGURED') errors._form = '请先暂停服务并保存，再重新打开页面替换凭证。';
  if (draft.state === 'CONFIGURED' && definition.fields.some(f => f.secret) && !draft.replaceSecrets && !row.hasSecret && row.state !== 'CONFIGURED') errors._form = '尚未保存凭证，请先填写整组凭证；服务器部署的凭证请由维护人员核对。';
  for (const f of definition.fields) {
    if (f.secret && !draft.replaceSecrets) continue;
    if (!f.secret && draft.state !== 'CONFIGURED' && draft.values[f.key] === draftFor(row, definition).values[f.key]) continue;
    const value = String(draft.values[f.key] ?? '').trim();
    if (f.required && (f.secret || draft.state === 'CONFIGURED') && !value) { errors[f.key] = `请填写${f.label}`; continue; }
    if (!value) continue;
    if (f.kind === 'url' && !safeUrl(value)) errors[f.key] = '请填写不含账号、密钥或 # 的完整 HTTPS 地址（本地调试允许回环 HTTP）。';
    if (f.key === 'redirectUri' && safeUrl(value) && new URL(value).search) errors[f.key] = '授权返回地址不能带问号参数。';
    if (f.options && !f.options.some(option => option.value === value)) errors[f.key] = '当前方式不在普通配置支持范围，请选择已支持的接入方式。';
    if (f.kind === 'pem' && !/^-----BEGIN (?:RSA )?(?:PRIVATE KEY|PUBLIC KEY|CERTIFICATE)-----[\s\S]+-----END (?:RSA )?(?:PRIVATE KEY|PUBLIC KEY|CERTIFICATE)-----$/.test(value.replace(/\\n/g, '\n'))) errors[f.key] = '请粘贴完整 PEM 文件内容，包括开头和结尾两行。';
    if (f.key === 'privateKeyPem' && !/BEGIN (?:RSA )?PRIVATE KEY/.test(value)) errors[f.key] = '这里需要私钥，不能填写公钥或证书。';
    if (['publicKeyPem', 'platformPublicKeyPem'].includes(f.key) && /PRIVATE KEY/.test(value)) errors[f.key] = '这里需要公钥或证书，不能填写私钥。';
    if (f.key === 'apiV3Key' && new TextEncoder().encode(value).length !== 32) errors[f.key] = 'API v3 密钥必须为 32 字节。';
    if ((f.key.startsWith('appId') && definition.key !== 'alipay') && !/^wx[A-Za-z0-9]{8,64}$/.test(value)) errors[f.key] = '请核对以 wx 开头的微信 AppID。';
    if (f.key === 'agentId' && !/^\d+$/.test(value)) errors[f.key] = '应用 ID 应为数字。';
    if (f.key.startsWith('paths.') && (!/^\/(?!\/)/.test(value) || /[?#\s]/.test(value))) errors[f.key] = '请输入以单个 / 开头、不含域名或参数的接口路径。';
    if (f.kind === 'list' && value.split(/[\n,，]+/).filter(v => v.trim()).some(v => !/^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+(?::\d+)?$/.test(v.trim()))) errors[f.key] = '每行填写一个域名，不带协议、路径或通配符。';
  }
  if (definition.key === 'wechat_pay' && draft.replaceSecrets && !['appIdApp', 'appIdMini', 'appIdOfficial'].some(key => String(draft.values[key] ?? '').trim())) errors.appIdOfficial = '请至少填写一种实际使用渠道的 AppID。';
  return errors;
}
export function integrationPayload(row: IntegrationRow, definition: IntegrationDefinition, draft: IntegrationDraft): { state: string; publicConfig: Record<string, unknown>; secrets?: Record<string, string> } {
  const errors = validateIntegrationDraft(row, definition, draft);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const publicConfig = JSON.parse(JSON.stringify(object(row.publicConfig))) as Record<string, unknown>;
  const secrets: Record<string, string> = {};
  const initial = draftFor(row, definition);
  for (const f of definition.fields) {
    const raw = draft.values[f.key]; const value = String(raw ?? '').trim();
    if (f.secret) { if (draft.replaceSecrets && value) secrets[f.key] = value.replace(/\\n/g, '\n'); continue; }
    // Preserve unshown fields and untouched nulls/nested defaults, including environment fallbacks.
    if (raw === initial.values[f.key]) continue;
    if (!value && get(publicConfig, f.key) == null) continue;
    put(publicConfig, f.key, f.kind === 'boolean' ? raw === 'inherit' ? null : raw === 'true' : f.kind === 'list' ? value.split(/[\n,，]+/).map(v => v.trim()).filter(Boolean) : value || null);
  }
  return { state: draft.state, publicConfig, ...(draft.replaceSecrets && Object.keys(secrets).length ? { secrets } : {}) };
}
