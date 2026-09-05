import { afterEach, describe, expect, it, vi } from "vitest";
import { Gender, IntegrationState } from "@prisma/client";
import type { PrismaService } from "../common/prisma.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
import {
  isFreshWechatAppState,
  WechatAppAuthService,
} from "./wechat-app-auth.service";

const now = Date.UTC(2026, 8, 5, 12, 0, 0);
const state = `sd_${now}_01234567-89ab-cdef-0123456789ab`;

function service(stateValue: IntegrationState = IntegrationState.CONFIGURED) {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    integrationConfig: {
      findUnique: vi.fn(async () => ({
        key: "wechat_login",
        state: stateValue,
        publicConfig: { appId: "wx1234567890abcdef" },
      })),
      updateMany,
    },
  } as unknown as PrismaService;
  const secrets = {
    resolve: vi.fn(async () => ({ appSecret: "server-only-secret-value" })),
  } as unknown as IntegrationSecretsService;
  return { auth: new WechatAppAuthService(prisma, secrets), updateMany };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native WeChat authorization", () => {
  it("accepts only a fresh client state", () => {
    expect(isFreshWechatAppState(state, now)).toBe(true);
    expect(isFreshWechatAppState(state, now + 10 * 60 * 1_000)).toBe(true);
    expect(isFreshWechatAppState(state, now + 10 * 60 * 1_000 + 1)).toBe(false);
    expect(isFreshWechatAppState("invalid", now)).toBe(false);
  });

  it("exchanges the one-time code server-side and returns no provider credential", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "provider-access-token",
            openid: "provider-open-id",
            unionid: "provider-union-id",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            openid: "provider-open-id",
            unionid: "provider-union-id",
            nickname: " 微信用户昵称 ",
            headimgurl: "https://thirdwx.example/avatar.png",
            sex: 2,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { auth, updateMany } = service();

    const identity = await auth.exchange({
      code: "one-time-code",
      state,
      platform: "harmony",
    });

    expect(identity).toEqual({
      openId: "provider-open-id",
      unionId: "provider-union-id",
      nickname: "微信用户昵称",
      avatarUrl: "https://thirdwx.example/avatar.png",
      gender: Gender.FEMALE,
    });
    expect(JSON.stringify(identity)).not.toContain("provider-access-token");
    const exchangeUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(exchangeUrl.origin + exchangeUrl.pathname).toBe(
      "https://api.weixin.qq.com/sns/oauth2/access_token",
    );
    expect(exchangeUrl.searchParams.get("code")).toBe("one-time-code");
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("does not call WeChat when the integration is not enabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { auth } = service(IntegrationState.UNCONFIGURED);
    await expect(
      auth.exchange({ code: "one-time-code", state, platform: "harmony" }),
    ).rejects.toThrow("微信登录暂时无法使用");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an already-used or invalid provider code to a fresh authorization request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ errcode: 40163, errmsg: "code been used" }), {
          status: 200,
        }),
      ),
    );
    const { auth } = service();
    await expect(
      auth.exchange({ code: "one-time-code", state, platform: "harmony" }),
    ).rejects.toThrow("微信授权已失效");
  });

  it("never accepts a profile returned for another OpenID", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: "token", openid: "expected-open-id" }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              openid: "different-open-id",
              nickname: "不可采用",
              headimgurl: "http://unsafe.example/avatar.png",
              sex: 1,
            }),
            { status: 200 },
          ),
        ),
    );
    const { auth } = service();
    await expect(
      auth.exchange({ code: "one-time-code", state, platform: "harmony" }),
    ).resolves.toEqual({
      openId: "expected-open-id",
      unionId: null,
      nickname: "微信用户",
      avatarUrl: null,
      gender: Gender.UNSPECIFIED,
    });
  });
});
