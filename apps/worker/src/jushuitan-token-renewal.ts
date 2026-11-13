import type { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { jstRenewalKey, jstRenewalDue, jstRenewalPlan, type JstRenewal } from "@saydian/app-contracts";
import { decryptWorkerSecrets, encryptWorkerSecrets } from "./integration-secrets";

export function renewalSign(params: Record<string, string>, secret: string) {
  return createHash("md5").update(secret + Object.keys(params).filter(k => k !== "sign").sort().map(k => k + params[k]).join(""), "utf8").digest("hex");
}
export class JushuitanTokenRenewal {
  private nextScan = 0;
  constructor(private readonly prisma: PrismaClient, private readonly request: typeof fetch = fetch, private readonly clock = Date.now) {}
  async runOnce() {
    const now = this.clock();
    if (now < this.nextScan) return;
    this.nextScan = now + 60_000;
    // Avoid adding DB calls to unconfigured/test workers; actual clients always have appSetting.
    if (!this.prisma.appSetting) return;
    const row = await this.prisma.appSetting.findUnique({ where: { key: jstRenewalKey } });
    if (!row || jstRenewalDue(row.value as unknown as JstRenewal, now) === "WAIT") return;
    const claim = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM "IntegrationConfig" WHERE key = 'jushuitan' FOR UPDATE`;
      await tx.$queryRaw`SELECT key FROM "AppSetting" WHERE key = ${jstRenewalKey} FOR UPDATE`;
      const setting = await tx.appSetting.findUnique({ where: { key: jstRenewalKey } });
      if (!setting) return;
      const state = setting.value as unknown as JstRenewal, due = jstRenewalDue(state, now);
      if (due === "WAIT") return;
      const save = (value: JstRenewal) => tx.appSetting.update({ where: { key: jstRenewalKey }, data: { public: false, value: value as unknown as Prisma.InputJsonValue } });
      if (due !== "DUE") { await save({ ...state, enabled: false, status: "REAUTH_REQUIRED", message: due === "EXPIRED" ? "令牌已过期，请重新授权并填写新令牌" : "上次续期结果未确认，请核查授权后重新配置" }); return; }
      const integration = await tx.integrationConfig.findUnique({ where: { key: "jushuitan" } });
      if (integration?.state !== "CONFIGURED") return;
      const encrypted = await tx.integrationSecret.findUnique({ where: { integrationKey: "jushuitan" } });
      if (!encrypted) { await save({ ...state, enabled: false, status: "REAUTH_REQUIRED", message: "缺少加密授权资料，请重新配置" }); return; }
      if (state.secretVersion !== createHash("sha256").update(encrypted.ciphertext).digest("hex")) { await save({ ...state, enabled: false, status: "REAUTH_REQUIRED", message: "授权资料已更换，请重新填写对应有效期与令牌" }); return; }
      let stored: Record<string, unknown>;
      try { stored = decryptWorkerSecrets("jushuitan", encrypted); } catch { await save({ ...state, enabled: false, status: "ERROR", message: "授权资料无法解密，请联系管理员" }); return; }
      const appKey = String(stored.appKey ?? process.env.JUSHUITAN_APP_KEY ?? "").trim();
      const appSecret = String(stored.appSecret ?? process.env.JUSHUITAN_APP_SECRET ?? "").trim();
      const refreshToken = String(stored.refreshToken ?? "").trim();
      if (!appKey || !appSecret || !refreshToken) { await save({ ...state, enabled: false, status: "ERROR", message: "缺少AppKey、AppSecret或刷新令牌，请补全授权资料" }); return; }
      const running = { ...state, status: "RUNNING", attemptedAt: new Date(now).toISOString(), message: "正在续期" };
      await save(running);
      return { state: running, stored, encrypted, appKey, appSecret, refreshToken };
    });
    if (!claim) return;
    let pair: { access_token: string; refresh_token: string; expires_in: number } | undefined;
    let message = "续期请求结果未确认，请检查授权后重新配置", failure = "CHECK_REQUIRED";
    try {
      const params: Record<string, string> = { app_key: claim.appKey, timestamp: String(Math.floor(this.clock() / 1000)), grant_type: "refresh_token", charset: "utf-8", refresh_token: claim.refreshToken, scope: "all" };
      params.sign = renewalSign(params, claim.appSecret);
      const response = await this.request("https://openapi.jushuitan.com/openWeb/auth/refreshToken", { method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as Record<string, any>;
      if (response.ok && body.code === 0 && typeof body.data?.access_token === "string" && body.data.access_token.length > 0 && body.data.access_token.length < 4096 && typeof body.data.refresh_token === "string" && body.data.refresh_token.length > 0 && body.data.refresh_token.length < 4096 && Number.isSafeInteger(body.data.expires_in) && body.data.expires_in > 0 && body.data.expires_in <= 366 * 86400) pair = body.data;
      else { failure = "REAUTH_REQUIRED"; message = "聚水潭拒绝续期或返回无效令牌，请核对授权并重新配置"; }
    } catch { /* Never persist provider bodies, URLs, tokens or exception messages. */ }
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM "IntegrationConfig" WHERE key = 'jushuitan' FOR UPDATE`;
      await tx.$queryRaw`SELECT key FROM "AppSetting" WHERE key = ${jstRenewalKey} FOR UPDATE`;
      const current = await tx.appSetting.findUnique({ where: { key: jstRenewalKey } });
      const state = current?.value as unknown as JstRenewal | undefined;
      const secret = await tx.integrationSecret.findUnique({ where: { integrationKey: "jushuitan" } });
      if (!state || state.status !== "RUNNING" || state.attemptedAt !== claim.state.attemptedAt) return;
      const changed = secret?.ciphertext !== claim.encrypted.ciphertext || secret?.iv !== claim.encrypted.iv;
      let value: JstRenewal = { ...state, enabled: false, status: failure, message };
      if (pair && !changed) {
        const issuedAt = new Date(this.clock()).toISOString(), expiresAt = new Date(this.clock() + pair.expires_in * 1000).toISOString();
        const encrypted = encryptWorkerSecrets("jushuitan", { ...claim.stored, accessToken: pair.access_token, refreshToken: pair.refresh_token });
        await tx.integrationSecret.update({ where: { integrationKey: "jushuitan" }, data: encrypted });
        let nextAttemptAt = "";
        try { nextAttemptAt = jstRenewalPlan(issuedAt, expiresAt); } catch { /* Save the issued pair even when its lifetime cannot support another safe refresh. */ }
        value = { ...state, enabled: !!nextAttemptAt, status: nextAttemptAt ? "READY" : "CHECK_REQUIRED", message: nextAttemptAt ? "自动续期成功" : "新令牌已保存，但有效期不足16天，请核查授权后重新配置", issuedAt, expiresAt, renewedAt: issuedAt, nextAttemptAt, secretVersion: createHash("sha256").update(encrypted.ciphertext).digest("hex") };
      } else if (changed) value.message = "授权资料在续期期间被修改，请核查后重新配置";
      await tx.appSetting.update({ where: { key: jstRenewalKey }, data: { public: false, value: value as unknown as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { actorType: "SYSTEM", actorId: "jushuitan-token-renewal", action: "JUSHUITAN_TOKEN_RENEWAL", entityType: "INTEGRATION", entityId: "jushuitan", afterJson: { status: value.status, expiresAt: value.expiresAt } } });
    });
  }
}
