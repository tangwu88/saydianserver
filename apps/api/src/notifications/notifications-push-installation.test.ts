import { BadRequestException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsService } from "./notifications.service";

afterEach(() => vi.unstubAllEnvs());

describe("push installation product routing", () => {
  it("keeps CN registrations and inbox queries separate from Say Ring", async () => {
    const upsert = vi.fn(async ({create}:any)=>create);
    const findMany = vi.fn(async(_input:any)=>[]);
    const count=vi.fn(async()=>0);
    const service=new NotificationsService({pushInstallation:{upsert}, notification:{findMany,count},$transaction:async(v:any)=>Promise.all(v)} as any);
    await service.registerInstallation("member",{installationId:"cn",registrationId:"fixture",platform:"android",product:"saydian-app-cn"});
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({provider:"jpush_saydian_cn"})}));
    await service.list("member",1,30,"saydian-app-cn");
    expect(findMany).toHaveBeenNthCalledWith(1,expect.objectContaining({where:expect.objectContaining({NOT:{OR:expect.arrayContaining([{eventId:{startsWith:"ring-share:"}}])}})}));
    await service.list("member");
    expect(findMany).toHaveBeenNthCalledWith(2,expect.objectContaining({where:expect.objectContaining({NOT:{eventId:{startsWith:"cn-ring-"}}})}));
  });
  it("stores Say Ring registrations under the isolated internal provider", async () => {
    vi.stubEnv("APP_REALM", "global");
    const upsert = vi.fn(async ({ create }: any) => create);
    const service = new NotificationsService({ pushInstallation: { upsert } } as any);

    await expect(
      service.registerInstallation("00000000-0000-0000-0000-000000000001", {
        installationId: "installation-1",
        registrationId: "registration-1",
        platform: "android",
        provider: "jpush",
        product: "say-ring",
        appVersion: "0.1.21",
        buildNumber: 1004,
        locale: "zh-Hans",
      }),
    ).resolves.toMatchObject({ registered: true });

    expect(upsert.mock.calls[0]?.[0].create).toMatchObject({
      provider: "jpush_say_ring",
      platform: "android",
      appVersion: "0.1.21",
      buildNumber: "1004",
    });
  });

  it("rejects unknown global product identities", async () => {
    vi.stubEnv("APP_REALM", "global");
    const service = new NotificationsService({ pushInstallation: { upsert: vi.fn() } } as any);
    await expect(
      service.registerInstallation("00000000-0000-0000-0000-000000000001", {
        installationId: "installation-1",
        registrationId: "registration-1",
        platform: "android",
        product: "another-app",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
