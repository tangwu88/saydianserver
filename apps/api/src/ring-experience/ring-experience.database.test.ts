import { spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, verify } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { sayRingFirmwareTarget } from "@saydian/app-contracts";
import { sign } from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authAudience, authIssuer } from "../common/deployment-realm";
import type { PrismaService } from "../common/prisma.service";
import { careAudio, currentCareWeek, ringSnapshot } from "./ring-contract";
import { firmwareQualified, RingFirmware } from "./ring-firmware";

const packageBytes = Buffer.from("Synthetic fixture; never a device image.");
const sha256 = createHash("sha256").update(packageBytes).digest("hex");
const firmwareIdentity = { platform: "ios", transport: "qring", model: "R8", hardware: "labA", fromVersion: "1.0" };
const firmwareApproval = "ios:qring:R8:labA:1.0:1.1:R21:" + sha256;

it("maps only approved product models and qualifies the exact file for each model and platform", () => {
  for (const [transport, model, packageModel] of [
    ["qring", "R8", "R21"], ["qring", "R21", "R21"],
    ["coolwear", "R7 Pro", "HR05"], ["coolwear", "R7u", "HR05"],
    ["coolwear", "R7", "HR01"], ["coolwear", "R7y", "HR01"],
  ] as const) {
    expect(sayRingFirmwareTarget(transport, model)?.packageModel).toBe(packageModel);
  }
  for (const [transport, model] of [
    ["qring", "R8 Pro"], ["qring", "R22"], ["qring", "R7C"],
    ["coolwear", "HR05"], ["coolwear", "HR01"], ["coolwear", "R8"],
    ["qring", "R7 Pro"], ["urion", "U19"], ["qring", "R8-R21"],
  ] as const) {
    expect(sayRingFirmwareTarget(transport, model)).toBeUndefined();
  }
  const release = { ...firmwareIdentity, version: "1.1", sha256 };
  expect(firmwareQualified(release, firmwareApproval)).toBe(true);
  for (const difference of [
    { sha256: "b".repeat(64) }, { model: "R21" }, { platform: "android" },
    { hardware: "labB" }, { fromVersion: "0.9" }, { version: "1.2" },
  ]) {
    expect(firmwareQualified({ ...release, ...difference }, firmwareApproval)).toBe(false);
  }
  expect(firmwareQualified(release, "ios:qring:R8:labA:1.0:1.1")).toBe(false);
  expect(firmwareQualified({ ...release, model: "R8PRO" },
    "ios:qring:R8PRO:labA:1.0:1.1:R21:" + sha256)).toBe(false);
});

it("stages a matching factory package only", async () => {
  const create = vi.fn();
  const firmware = new RingFirmware({ ringFirmwareRelease: { create } } as unknown as PrismaService);
  const file = { buffer: packageBytes, size: packageBytes.length } as Express.Multer.File;
  const draft = { ...firmwareIdentity, transport: "coolwear", model: "R7u",
    version: "1.1", sha256, minBuild: "1323", minBattery: "50", evidence: "isolated fixture" };
  await expect(firmware.stage({ ...draft, packageModel: "HR01" }, file)).rejects.toThrow("不匹配");
  await expect(firmware.stage({ ...draft, model: "HR05", packageModel: "HR05" }, file)).rejects.toThrow("不匹配");
  expect(create).not.toHaveBeenCalled();
  await firmware.stage({ ...draft, packageModel: "HR05" }, file);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ transport: "coolwear", model: "R7Ultra", sha256 }),
  }));
});

function wave(seconds: number) {
  const size = seconds * 16000 * 2;
  const data = Buffer.alloc(size + 44);
  data.write("RIFF", 0);
  data.writeUInt32LE(size + 36, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]] as const) {
    data.writeUInt16LE(value, offset);
  }
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.write("data", 36);
  data.writeUInt32LE(size, 40);
  return data;
}

it("uses a shared week across midnight and canonical bounded voice files", () => {
  expect(currentCareWeek(new Date("2026-11-22T16:00:00Z"))).toEqual({
    week: "2026-11-23", today: "2026-11-23",
  });
  expect(Buffer.from(careAudio(wave(10).toString("base64")))).toEqual(wave(10));
  expect(() => careAudio(wave(11).toString("base64"))).toThrow();
  expect(() => ringSnapshot({
    kind: "health", date: "2026-11-31", fields: [{key:"systolic",value:125}],
  })).toThrow();
  expect(() => ringSnapshot({
    kind: "health", date: "2026-11-23", fields: [{key:"memberId",value:"private"}],
  })).toThrow();
});

describe.runIf(process.env.RUN_RING_EXPERIENCE_DATABASE_TESTS === "1")("Say Ring HTTP + disposable PostgreSQL", () => {
  const base = "/global/api/saydian-app/v2/ring/";
  const secret = randomUUID() + randomUUID();
  const signer = generateKeyPairSync("ed25519");
  let db: PrismaClient, child: ChildProcess, root: string;
  const fixtures: string[] = [];
  let actor: Awaited<ReturnType<typeof member>>, second: typeof actor, third: typeof actor;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.username !== "ringqa" || url.pathname !== "/ringlab" || !url.port) {
      throw new Error("An isolated ringlab database on loopback is required");
    }
    db = new PrismaClient();
    const listener = createServer();
    await new Promise<void>((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
    const port = (listener.address() as {port:number}).port;
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    root = "http://127.0.0.1:" + port;
    let logs = "";
    child = spawn(process.execPath, ["dist/main.js"], {
      env: {
        PATH: process.env.PATH, DATABASE_URL: url.toString(), NODE_ENV: "test",
        HOST: "127.0.0.1", PORT: String(port), ACCESS_TOKEN_SECRET: secret,
        SAY_RING_SHARING_ENABLED: "true", SAY_RING_CARE_ENABLED: "true",
        SAY_RING_FIRMWARE_ENABLED: "true",
        SAY_RING_FIRMWARE_SIGNING_KEY_B64: signer.privateKey.export({type:"pkcs8",format:"der"}).toString("base64"),
        SAY_RING_VERIFIED_FIRMWARE_UPGRADES: firmwareApproval,
      },
      stdio: ["ignore","pipe","pipe"],
    });
    child.stdout?.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-1800); });
    child.stderr?.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-1800); });
    let ready = false;
    for (let retry = 0; retry < 70; retry++) {
      try { ready = (await fetch(root + base + "capabilities", {signal: AbortSignal.timeout(200)})).ok; }
      catch { /* Wait for the real HTTP port. */ }
      if (ready || child.exitCode !== null) break;
      await delay(100);
    }
    if (!ready) throw new Error(logs || "Build the API first");
    [actor, second, third] = await Promise.all([member(), member(), member()]);
  }, 20_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await db?.user.deleteMany({where:{id:{in:fixtures}}});
    await db?.$disconnect();
  });

  it("paginates the owner's history and retains expired reactions without reopening the public link", async () => {
    const token = randomBytes(32).toString("base64url");
    const snapshot = {kind:"sleep",date:"2026-11-01",fields:[
      {key:"rangeEnd",value:"2026-11-07"},
      {key:"sleepAverageMinutes",value:415}, {key:"recordDays",value:5},
    ]};
    const create = await request("shares","POST",actor.token,{token,confirmed:true,snapshot});
    expect(create.status).toBe(201);
    await request("shares/respond","POST",undefined,{token,visitor:randomUUID(),kind:"hug"});
    await db.ringShare.update({where:{id:create.data.id},data:{
      expiresAt:new Date(Date.now()-1000), createdAt:new Date(Date.now()-30000),
    }});
    await db.ringShare.createMany({data:Array.from({length:32},()=>({
      ownerId:actor.id,digest:randomBytes(32).toString("hex"),snapshot,
      expiresAt:new Date(Date.now()+24_000),
    }))});
    const query = "shares?history=true";
    const first = await request(query,"GET",actor.token);
    expect(first.data.entries).toHaveLength(30);
    const last = await request(query+"&before="+first.data.nextBefore,"GET",actor.token);
    expect(last.data.entries).toHaveLength(3);
    expect(last.data.entries.at(-1).id).toBe(create.data.id);
    expect(last.data.entries.at(-1).reactions[0].kind).toBe("hug");
    expect((await request(query+"&before="+first.data.nextBefore,"GET",second.token)).status).toBe(404);
    expect((await request("shares/open","POST",undefined,{token})).status).toBe(404);
    const path = "shares/" + create.data.id;
    const day = new Date("2026-11-03T13:15:22Z");
    await db.ringShareReaction.createMany({data:Array.from({length:31},()=>({
      shareId:create.data.id, visitor:randomBytes(32).toString("hex"), kind:"walk", createdAt:day,
    }))});
    const replies = await request(path,"GET",actor.token);
    const older = await request(path+"?before="+replies.data.nextBefore,"GET",actor.token);
    expect(replies.data.share._count.reactions).toBe(32);
    expect(replies.data.reactions).toHaveLength(30);
    expect(replies.data.reactions[0].kind).toBe("hug");
    expect(older.data.reactions).toEqual(Array.from({length:2},()=>({
      kind:"walk", name:null, createdAt:day.toISOString(),
    })));
    expect(older.data.nextBefore).toBeNull();
    expect((await request(path,"GET")).status).toBe(401);
    expect((await request(path,"GET",second.token)).status).toBe(404);
    expect((await request(path+"?before=invalid","GET",actor.token)).status).toBe(400);
  });

  async function member() {
    const user = await db.user.create({data:{nickname:"Synthetic Ring Member"}});
    fixtures.push(user.id);
    const jti = randomUUID();
    const session = await db.userSession.create({data:{
      userId:user.id, accessJti:jti, refreshTokenHash:randomBytes(32).toString("hex"),
      expiresAt:new Date(Date.now()+3_600_000),
    }});
    return {id:user.id, token:sign({typ:"access",sid:session.id},secret,{
      subject:user.id,jwtid:jti,issuer:authIssuer(),audience:authAudience(),expiresIn:"1h",
    })};
  }

  async function request(route: string, method: string, bearer?: string, body?: unknown) {
    const result = await fetch(root + (route.startsWith("/") ? route : base + route),{
      method, headers: {
        ...(bearer ? {authorization:"Bearer " + bearer} : {}),
        ...(body !== undefined ? {"content-type":"application/json"} : {}),
      },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    });
    const value = await result.json();
    return {status:result.status, data:value.data, cache:result.headers.get("cache-control")};
  }

  it("authorizes creation/revocation, preserves exact selected values, and deduplicates visitors", async () => {
    const token = randomBytes(32).toString("base64url");
    const snapshot = {kind:"health",date:"2026-11-23",note:"Synthetic </title> & <img src=x>",fields:[
      {key:"systolic",value:122.5}, {key:"diastolic",value:81},
    ]};
    expect((await request("shares", "POST", undefined, {token,confirmed:true,snapshot})).status).toBe(401);
    const create = await request("shares","POST",actor.token,{token,confirmed:true,snapshot});
    expect(create.status).toBe(201);
    expect((await request("shares","POST",actor.token,{token,confirmed:true,snapshot})).data.id).toBe(create.data.id);
    const {data,cache} = await request("shares/open","POST",undefined,{token});
    expect(cache).toContain("no-store");
    expect(data.snapshot).toEqual(snapshot);
    expect(data.sharerName).toBe("Synthetic Ring Member");
    expect(data.projectNames).toEqual(["血压记录","Blood pressure record"]);
    const reference = createHash("sha256").update(token).digest("hex");
    expect(data.titleRef).toBe(reference);
    expect((await request("shares/open","POST",undefined,{token:reference})).status).toBe(404);
    const visitor = randomUUID();
    await Promise.all([1,2].map(() => request("shares/respond","POST",undefined,{token,visitor,kind:"cheer"})));
    const shares = await request("shares","GET",actor.token);
    expect(shares.data.entries[0].reactions).toHaveLength(1);
    expect(shares.data.entries[0].reactions[0].name).toBeNull();
    const inbox = "/global/api/saydian-app/v2/notifications";
    const deepLink = "/ring/shares/" + create.data.id;
    async function notices(bearer: string) {
      return (await request(inbox,"GET",bearer)).data.items
        .filter((item: {deepLink?: string}) => item.deepLink === deepLink);
    }
    const firstNotices = await notices(actor.token);
    expect(firstNotices).toHaveLength(1);
    expect(firstNotices[0].readAt).toBeNull();
    await request(inbox+"/"+firstNotices[0].eventId+"/read","POST",actor.token);
    expect((await request("shares/respond","POST",undefined,{token,visitor:randomUUID(),kind:"walk"})).status).toBe(200);
    const latest = await notices(actor.token);
    expect(latest).toHaveLength(2);
    expect(latest.find((item: {eventId: string}) => item.eventId !== firstNotices[0].eventId).readAt).toBeNull();
    expect(latest.find((item: {eventId: string}) => item.eventId === firstNotices[0].eventId).readAt).not.toBeNull();
    expect(await notices(second.token)).toHaveLength(0);
    const queued = await db.outboxEvent.findMany({
      where:{aggregateType:"ring_share",aggregateId:create.data.id}, orderBy:{eventId:"asc"},
    });
    expect(queued.map((item)=>item.eventId)).toEqual(latest.map((item: {eventId: string})=>item.eventId).sort());
    expect(queued.map((item)=>Object.keys(item.payload as object).sort())).toEqual([
      ["deepLink","notificationId","userId"], ["deepLink","notificationId","userId"],
    ]);
    expect((await request("shares/member-response","POST",second.token,{token,kind:"walk",named:true})).status).toBe(403);
    const h5 = root + "/global/say-ring/share";
    const page = await fetch(h5);
    expect(page.status).toBe(200);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await page.text()).toContain("<title>Say Ring</title>");
    const titleUrl = h5 + "?title=" + reference;
    const titled = await fetch(titleUrl, {headers:{"accept-language":"en-US,en;q=0.9"}});
    expect(titled.status).toBe(200);
    expect(titled.headers.get("cache-control")).toContain("no-store");
    const markup = await titled.text();
    expect(markup).toContain("<title>Synthetic Ring Member · Blood pressure record · Synthetic &lt;/title&gt; &amp; &lt;img src=x&gt; · Say Ring</title>");
    expect(markup).not.toContain(token);
    expect(markup).not.toContain("122.5");
    const chinese = await fetch(titleUrl, {headers:{"accept-language":"zh-CN,en;q=0.7"}});
    expect(await chinese.text()).toContain("Synthetic Ring Member · 血压记录 · Synthetic");
    await request("shares/" + create.data.id,"DELETE",third.token);
    expect((await request("shares/open","POST",undefined,{token})).status).toBe(200);
    await request("shares/" + create.data.id,"DELETE",actor.token);
    expect((await request("shares/open","POST",undefined,{token})).status).toBe(404);
    expect((await request("shares/" + create.data.id,"GET",actor.token)).status).toBe(404);
    expect(await (await fetch(titleUrl)).text()).toContain("<title>Say Ring</title>");
  });

  it("accepts only one claimant, delivers messages, and keeps voice and goals inside the relationship", async () => {
    const invitation = await request("care/invitations","POST",actor.token);
    const code = invitation.data.code;
    expect((await request("care/invitations/preview","POST",undefined,{code})).status).toBe(200);
    const attempts = await Promise.all([second,third].map((user) =>
      request("care/invitations/accept","POST",user.token,{code,confirmed:true,metrics:[]})));
    const won = attempts.findIndex((x)=>x.status===201);
    expect(won).toBeGreaterThanOrEqual(0);
    expect(attempts[1-won]!.status).toBe(404);
    const [recipient, outsider] = won === 0 ? [second,third] : [third,second];
    const id = attempts[won]!.data.relationshipId;
    expect(await db.carePermission.count({where:{relationshipId:id}})).toBe(0);
    expect((await request("care/invitations/accept","POST",recipient.token,{code,confirmed:true,metrics:[]})).data.relationshipId).toBe(id);
    const path = "care/" + id + "/";
    const messageId = randomUUID();
    await request(path+"settings","PUT",recipient.token,{muted:true});
    const greeting = {messageId,kind:"thinking",keepQuiet:true};
    expect((await request(path+"messages","POST",actor.token,greeting)).status).toBe(201);
    expect((await request(path+"messages","POST",actor.token,greeting)).status).toBe(201);
    expect(await db.outboxEvent.count({where:{eventId:"ring-care:"+messageId}})).toBe(0);
    expect((await request(path+"messages","GET",recipient.token)).data.messages).toHaveLength(1);
    expect((await request(path+"messages","GET",outsider.token)).status).toBe(404);

    const voiceId = randomUUID();
    expect((await request(path+"messages","POST",recipient.token,{
      messageId:voiceId, kind:"voice", audio:wave(1).toString("base64"),
    })).status).toBe(201);
    const voice = root + base + path+"messages/"+voiceId+"/audio";
    expect((await fetch(voice,{headers:{authorization:"Bearer "+outsider.token}})).status).toBe(404);
    const audio = await fetch(voice,{headers:{authorization:"Bearer "+actor.token}});
    expect(audio.status).toBe(200);
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(wave(1));
    const {week,today} = currentCareWeek();
    await request(path+"goals","PUT",actor.token,{week,target:2});
    const usingRecord = {week,day:today,source:"workout"};
    expect((await request(path+"goals","PUT",actor.token,usingRecord)).status).toBe(409);
    await db.healthRecord.create({data:{
      userId:actor.id, clientRecordId:"qa-ring-walk-steps", metric:"STEPS",
      observedAt:new Date(), timezoneOffsetMinutes:480, values:{value:1374}, unit:"steps",
      sourcePlatform:"ios", sourceMeasurementSource:"wearable", quality:"VALID",
    }});
    expect((await request(path+"goals","GET",actor.token)).data.activityAvailable).toBe(true);
    expect((await request(path+"goals","GET",recipient.token)).data.activityAvailable).toBe(false);
    expect((await request(path+"goals","PUT",actor.token,usingRecord)).status).toBe(200);
    await Promise.all([1,2].map(() => request(path+"goals","PUT",actor.token,{week,day:today,source:"manual"})));
    const plans = await request(path+"goals","GET",recipient.token);
    expect(plans.data.members).toEqual([{mine:false,target:2,completed:1,checkedToday:false,paused:false}]);
    expect((await request(path+"settings","PUT",recipient.token,{blocked:true})).status).toBe(200);
    expect((await fetch(voice,{headers:{authorization:"Bearer "+actor.token}})).status).toBe(404);
  });

  it("serves signed firmware only for the exact qualified target and honors pause", async () => {
    const identity = firmwareIdentity;
    const lookup = { ...identity, packageModel: "R21", appBuild: 1318 };
    const release = await db.ringFirmwareRelease.create({data:{...identity,version:"1.1",
      minBuild:1318,minBattery:30,bytes:packageBytes.byteLength,sha256,
      package:Uint8Array.from(packageBytes),enabled:true,evidence:"isolated fixture"}});
    try {
      const result = await request("firmware/lookup","POST",actor.token,lookup);
      expect(result.data.available).toBe(true);
      const payload = Buffer.from(result.data.payload,"base64url");
      expect(verify(null,payload,signer.publicKey,Buffer.from(result.data.signature,"base64url"))).toBe(true);
      expect(JSON.parse(payload.toString()).sha256).toBe(sha256);
      expect(JSON.parse(payload.toString()).packageModel).toBe("R21");
      expect((await request("firmware/lookup","POST",actor.token,{...identity,appBuild:1318})).data.available).toBe(false);
      expect((await request("firmware/lookup","POST",actor.token,{...lookup,packageModel:"HR05"})).data.available).toBe(false);
      expect((await request("firmware/lookup","POST",actor.token,{...lookup,hardware:"labB"})).data.available).toBe(false);
      expect((await request("firmware/lookup","POST",actor.token,{...lookup,model:"R21"})).data.available).toBe(false);
      const download = () => fetch(root + base + "firmware/packages/" + release.id,
        {headers:{authorization:"Bearer "+actor.token}});
      expect(Buffer.from(await (await download()).arrayBuffer())).toEqual(packageBytes);
      const otherFile = Buffer.from("A different synthetic file for the same version.");
      await db.ringFirmwareRelease.update({where:{id:release.id},data:{
        sha256:createHash("sha256").update(otherFile).digest("hex"), bytes:otherFile.byteLength,
        package:Uint8Array.from(otherFile),
      }});
      expect((await request("firmware/lookup","POST",actor.token,lookup)).data.available).toBe(false);
      expect((await download()).status).toBe(404);
      await db.ringFirmwareRelease.update({where:{id:release.id},data:{
        enabled:false,sha256,bytes:packageBytes.byteLength,package:Uint8Array.from(packageBytes),
      }});
      expect((await download()).status).toBe(404);
    } finally { await db.ringFirmwareRelease.delete({where:{id:release.id}}); }
  });
});
