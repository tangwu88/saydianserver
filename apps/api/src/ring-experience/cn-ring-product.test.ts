import { afterEach, expect, it, vi } from "vitest";
import { Script } from "node:vm";
import { RingExperienceService } from "./ring-experience.service";
import { RingWebController, CnRingWebController } from "./ring-web.controller";
import { cnRingProduct, ringClientAvailability, ringClientProduct } from "./ring-contract";

afterEach(() => vi.unstubAllEnvs());
function enabled() {
  vi.stubEnv("SAY_RING_SHARING_ENABLED", "true");
  vi.stubEnv("SAY_RING_CARE_ENABLED", "true");
  vi.stubEnv("SAY_RING_FIRMWARE_ENABLED", "true");
}

it("keeps old CN clients closed and leaves Say Ring capabilities compatible", () => {
  enabled();
  expect(ringClientAvailability(undefined, undefined)).toEqual({ sharing:true, care:true, firmware:true });
  expect(ringClientAvailability(cnRingProduct, undefined)).toMatchObject({product:cnRingProduct,sharing:false,care:false,firmware:false});
  expect(ringClientAvailability(cnRingProduct, "cn-ring-v1")).toMatchObject({product:cnRingProduct,sharing:true,care:true,firmware:false});
  expect(() => ringClientProduct("another-app")).toThrow("产品标识");
  vi.stubEnv("DEPLOYMENT_SITE", "us");
  expect(ringClientAvailability(cnRingProduct, "cn-ring-v1")).toMatchObject({sharing:false,care:false,firmware:false});
});

it("does not reuse another product's share token even for the same owner", async () => {
  enabled();
  const db: any = {ringShare:{upsert:vi.fn(async ({create}:any) => ({...create,id:"share"}))}};
  const service=new RingExperienceService(db);
  const input={token:"A".repeat(43),confirmed:true,snapshot:{kind:"sleep",date:"2026-11-27",fields:[{key:"sleepMinutes",value:420}]}};
  await service.createShare("member", input, cnRingProduct);
  expect(db.ringShare.upsert.mock.calls[0][0].create.product).toBe(cnRingProduct);
  db.ringShare.upsert.mockResolvedValue({id:"share",ownerId:"member",product:"say-ring",expiresAt:new Date(Date.now()+60000)});
  await expect(service.createShare("member",input,cnRingProduct)).rejects.toMatchObject({status:409});
});

it("filters share details, titles, invite previews and messages by product", async () => {
  enabled();
  const db:any={
    ringShare:{findFirst:vi.fn(async()=>null), findMany:vi.fn(async()=>[])},
    ringCareInvite:{findFirst:vi.fn(async()=>null),findMany:vi.fn(async()=>[])},
    ringCareMessage:{findMany:vi.fn(async()=>[])},
  };
  const service=new RingExperienceService(db);
  await expect(service.openShare({token:"A".repeat(43)},cnRingProduct)).rejects.toMatchObject({status:404});
  expect(db.ringShare.findFirst.mock.calls[0][0].where.product).toBe(cnRingProduct);
  await service.shares("member",true,undefined,cnRingProduct);
  expect(db.ringShare.findMany.mock.calls[0][0].where).toMatchObject({ownerId:"member",product:cnRingProduct});
  await expect(service.previewInvite({code:"ABCDEFGHJKLMNPQRSTUV"},cnRingProduct)).rejects.toMatchObject({status:404});
  expect(db.ringCareInvite.findFirst.mock.calls[0][0].where.product).toBe(cnRingProduct);
  await service.liveGreetings("member",undefined,cnRingProduct);
  expect(db.ringCareMessage.findMany.mock.calls[0][0].where.product).toBe(cnRingProduct);
});

it("stores CN inbox messages without enqueueing disabled system push", async () => {
  const tx:any={
    notification:{upsert:vi.fn(async()=>({id:"notification"}))},
    integrationConfig:{findUnique:vi.fn(async()=>null)},
    outboxEvent:{createMany:vi.fn()},
  };
  const service=new RingExperienceService(tx);
  await (service as any).notify(tx,"ring-care:fixture","member","relation","care",true,cnRingProduct);
  expect(tx.notification.upsert.mock.calls[0][0].create).toMatchObject({eventId:"cn-ring-care:fixture",body:"打开赛电SayDian查看。"});
  expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  tx.integrationConfig.findUnique.mockResolvedValue({state:"CONFIGURED"});
  await (service as any).notify(tx,"ring-share:fixture","member","share","share",true,cnRingProduct);
  expect(tx.outboxEvent.createMany.mock.calls[0][0].data[0].payload.product).toBe(cnRingProduct);
});

it("renders separate CN HTML without a Say Ring download or changing user titles", async () => {
  const ring:any={shareTitle:vi.fn(async()=>"Synthetic Say Ring <title>")};
  const render=async(Controller:any) => {
    let html="";
    const response:any={set:vi.fn().mockReturnThis(),type:vi.fn().mockReturnThis(),send:(body:string)=>{html=body;}};
    await new Controller(ring).page("share","app.saydian.cn","en-US","a".repeat(64),response);
    const script=html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(()=>new Script(script!)).not.toThrow();
    return html;
  };
  const cn=await render(CnRingWebController);
  expect(cn).toContain('data-product="saydian-app-cn"');
  expect(cn).toContain('/global/saydian-cn/ring/');
  expect(cn).toContain("cc.saidian.app");
  expect(cn).toContain("<title>Synthetic Say Ring &lt;title&gt;</title>");
  expect(cn).not.toContain('href="https://app.saydian.cn/down2"');
  expect(cn).toContain('id="download" hidden');
  expect(ring.shareTitle).toHaveBeenCalledWith("a".repeat(64),"zh-Hans",cnRingProduct);
  const original=await render(RingWebController);
  expect(original).toContain('href="https://app.saydian.cn/down2"');
  expect(original).toContain('data-product="say-ring"');
  vi.stubEnv("DEPLOYMENT_SITE","us");
  await expect(render(CnRingWebController)).rejects.toMatchObject({status:404});
});
