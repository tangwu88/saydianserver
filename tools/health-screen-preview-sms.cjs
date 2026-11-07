// Local transport for synthetic codes only. The real challenge, login and grants still run in the API.
const fs = require("node:fs"),
  path = require("node:path");
if (
  process.env.NODE_ENV !== "development" ||
  process.env.H5_DEMO_ENABLED !== "true" ||
  process.env.DATABASE_URL !==
    "postgresql://health_preview@127.0.0.1:55447/saydian_health_screen_preview"
)
  throw Error("Isolated health preview required");
// Keep the demo guard in force for every real integration. Supply a stub only for the captured transport.
const {
  IntegrationSecretsService,
} = require("../apps/api/src/common/integration-secrets.service.ts");
const resolveSecrets = IntegrationSecretsService.prototype.resolve;
IntegrationSecretsService.prototype.resolve = function (
  integrationKey,
  environmentMap,
) {
  if (integrationKey === "sms_global")
    return Promise.resolve({
      webhookUrl: "https://health-screen-preview.invalid/otp",
      webhookToken: "isolated-fixture",
    });
  return resolveSecrets.call(this, integrationKey, environmentMap);
};
const original = global.fetch;
global.fetch = async (url, options) => {
  if (String(url) === "https://health-screen-preview.invalid/otp") {
    const item = JSON.parse(options.body);
    if (
      !/^\+861990000790[1-9]$/.test(item.recipient) ||
      !/^\d{6}$/.test(item.code)
    )
      return new Response(null, { status: 400 });
    const dir = path.join(
      __dirname,
      "../artifacts/health-screen-profile-access/inbox",
    );
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    fs.writeFileSync(
      path.join(dir, item.recipient.slice(-4) + ".json"),
      JSON.stringify({ code: item.code, until: Date.now() + 300000 }),
      { mode: 0o600 },
    );
    return new Response("{}", { status: 200 });
  }
  const target = new URL(typeof url === "string" ? url : url.url || url.href);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
    throw Error("External services disabled for local health preview");
  return original(url, options);
};
