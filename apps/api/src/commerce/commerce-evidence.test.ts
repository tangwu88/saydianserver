import "reflect-metadata";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportService } from "../support/support.service";
import { afterSaleEvidenceReferences, evidencePurpose, validateEvidenceImage } from "./commerce-evidence";
import { CommerceEvidenceController, AdminCommerceEvidenceController } from "./commerce-evidence.controller";
import { UserAuthGuard } from "../common/user-auth.guard";
import { AdminAuthGuard } from "../admin/admin-auth";

const fileId="22222222-2222-4222-8222-222222222222",saleId="33333333-3333-4333-8333-333333333333";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSU8AAAAASUVORK5CYII=","base64");
const image=(buffer=png,mimetype="image/png")=>({buffer,size:buffer.length,mimetype,originalname:"synthetic-1px.png"}) as Express.Multer.File;
function fixture(){const send=vi.fn(async(command:any)=>command.constructor.name==="GetObjectCommand"?{Body:Readable.from(png)}:{}),rows:any[]=[];
  const db={fileObject:{create:vi.fn(async({data}:any)=>{const row={id:fileId,...data,status:"ACTIVE"};rows.push(row);return row;}),findFirst:vi.fn(async({where}:any)=>rows.find(row=>Object.entries(where).every(([key,value])=>row[key]===value))||null),findUnique:vi.fn(async()=>rows[0]||null),count:vi.fn(async(_input:any)=>1)},integrationConfig:{findUnique:vi.fn(async()=>null),updateMany:vi.fn()},commerceAfterSale:{findFirst:vi.fn(async()=>({order:{userId:"member-a"}}))},auditLog:{create:vi.fn()}};
  const service=new SupportService(db as any,{} as any);const storage=vi.fn(async()=>({s3:{send},bucket:"synthetic-private"}));(service as any).storage=storage;return {service,db,send,storage,rows};}
afterEach(()=>vi.unstubAllEnvs());
describe("private after-sale image evidence",()=>{
  it("checks real image signatures, MIME, actual bytes and size before storage",()=>{
    expect(validateEvidenceImage(image())).toBe("image/png");
    for(const invalid of [image(Buffer.from('<svg onload="alert(1)"></svg>')),image(png,"image/jpeg"),{...image(),size:0},image(Buffer.alloc(10*1024*1024+1)),image(png.subarray(0,-12))])expect(()=>validateEvidenceImage(invalid as any)).toThrow();
    const jpeg=Buffer.from([255,216,255,224,0,8,1,2,3,4,255,217]);expect(validateEvidenceImage(image(jpeg,"image/jpeg"))).toBe("image/jpeg");
    const webp=Buffer.alloc(20);webp.write("RIFF");webp.writeUInt32LE(12,4);webp.write("WEBPVP8 ",8);expect(validateEvidenceImage(image(webp,"image/webp"))).toBe("image/webp");
  });
  it("writes only to a private owned purpose and returns IDs, never a public URL",async()=>{const h=fixture();const result=await h.service.uploadCommerceEvidence("member-a",image());expect(result.id).toBe(fileId);expect(result).not.toHaveProperty("url");expect(h.rows[0]).toMatchObject({ownerUserId:"member-a",purpose:evidencePurpose,byteSize:png.length});expect(h.send.mock.calls[0]![0].input.Body).toEqual(png);expect(h.send.mock.calls[0]![0].input).not.toHaveProperty("ACL");});
  it("reports missing storage honestly and does not persist a pretend uploaded object on failure",async()=>{const h=fixture();h.storage.mockRejectedValue(Error("not configured"));expect(await h.service.commerceEvidenceCapability()).toMatchObject({enabled:false,maxFiles:9});await expect(h.service.uploadCommerceEvidence("member-a",image())).rejects.toThrow();expect(h.send).not.toHaveBeenCalled();expect(h.db.fileObject.create).not.toHaveBeenCalled();h.storage.mockResolvedValue({s3:{send:h.send},bucket:"private"});h.send.mockRejectedValue(Error("unreachable"));await expect(h.service.uploadCommerceEvidence("member-a",image())).rejects.toThrow("无法上传");expect(h.db.fileObject.create).not.toHaveBeenCalled();});
  it("private read requires matching member, purpose and active state; old public avatar API cannot read it",async()=>{const h=fixture();await h.service.uploadCommerceEvidence("member-a",image());await expect(h.service.commerceEvidence("member-b",fileId)).rejects.toThrow("不存在");expect((await h.service.commerceEvidence("member-a",fileId)).contentType).toBe("image/png");await expect(h.service.publicFile(fileId)).rejects.toThrow("不存在");h.rows[0].status="DELETED";await expect(h.service.commerceEvidence("member-a",fileId)).rejects.toThrow("不存在");});
  it("validates evidence IDs against owner, purpose, active state and limits before canonical references",async()=>{vi.stubEnv("APP_REALM","global");const h=fixture();expect(await afterSaleEvidenceReferences(h.db as any,"member-a",{evidenceFileIds:[fileId]})).toEqual([`file:${fileId}`]);expect(h.db.fileObject.count.mock.calls[0]![0]).toMatchObject({where:{ownerUserId:"member-a",purpose:evidencePurpose,status:"ACTIVE"}});for(const body of [{evidenceFileIds:[fileId,fileId]},{evidenceFileIds:["https://example.invalid/picture.png"]},{evidenceFileIds:Array(10).fill(fileId)},{evidenceImages:["https://example.invalid/p.png"]}])await expect(afterSaleEvidenceReferences(h.db as any,"member-a",body)).rejects.toThrow();h.db.fileObject.count.mockResolvedValue(0);await expect(afterSaleEvidenceReferences(h.db as any,"member-b",{evidenceFileIds:[fileId]})).rejects.toThrow("不属于");});
  it("retains old empty requests and domestic legacy evidence shape without changing existing upload semantics",async()=>{vi.stubEnv("APP_REALM","global");expect(await afterSaleEvidenceReferences({} as any,"a",{evidenceImages:[]})).toEqual([]);vi.stubEnv("APP_REALM","domestic");expect(await afterSaleEvidenceReferences({} as any,"a",{evidenceImages:["legacy-image"]})).toEqual(["legacy-image"]);});
  it("admin reader enforces resource READ, linked after-sale, actual file owner, and writes audit",async()=>{const h=fixture();await h.service.uploadCommerceEvidence("member-a",image());await expect(h.service.adminCommerceEvidence({id:"admin",role:"CONTENT_EDITOR"},saleId,fileId)).rejects.toThrow("无权");await h.service.adminCommerceEvidence({id:"admin",role:"READ_ONLY"},saleId,fileId,"test-request");expect(h.db.commerceAfterSale.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:saleId,evidenceImages:{has:`file:${fileId}`}}}));expect(h.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:"COMMERCE_EVIDENCE_READ",actorId:"admin",entityId:saleId})}));h.db.commerceAfterSale.findFirst.mockResolvedValue(null as any);await expect(h.service.adminCommerceEvidence({id:"admin",role:"SUPER_ADMIN"},saleId,fileId)).rejects.toThrow("不存在");});
  it("controllers preserve auth guards and send private no-store/nosniff binary responses",async()=>{expect(Reflect.getMetadata("__guards__",CommerceEvidenceController)).toContain(UserAuthGuard);expect(Reflect.getMetadata("__guards__",AdminCommerceEvidenceController)).toContain(AdminAuthGuard);const body={on:vi.fn(),pipe:vi.fn()},response={setHeader:vi.fn(),destroy:vi.fn()},controller=new CommerceEvidenceController({commerceEvidence:vi.fn(async()=>({body,contentType:"image/png",byteSize:png.length}))} as any);await controller.image({id:"member-a",sessionId:"session"},fileId,response as any);expect(response.setHeader).toHaveBeenCalledWith("cache-control","private, no-store");expect(response.setHeader).toHaveBeenCalledWith("x-content-type-options","nosniff");expect(body.pipe).toHaveBeenCalledWith(response);});
});

describe("administrator content images",()=>{
  it("stores a validated image under the public content purpose and returns its canonical file URL",async()=>{
    const h=fixture();
    const result=await h.service.uploadAdminContentImage("admin-1",image());
    expect(result).toMatchObject({id:fileId,sha256:expect.stringMatching(/^[a-f0-9]{64}$/),byteSize:png.length});
    expect(result.url).toBe(`http://localhost:8080/api/saydian-app/v2/files/${fileId}`);
    expect(h.rows[0]).toMatchObject({ownerUserId:null,purpose:"admin-content",contentType:"image/png"});
    expect(h.send.mock.calls[0]![0].input.Key).toMatch(/^admin-content\/admin-1\//);
    expect((await h.service.publicFile(fileId)).contentType).toBe("image/png");
  });

  it("rejects disguised or oversized content images before object storage",async()=>{
    const h=fixture();
    await expect(h.service.uploadAdminContentImage("admin-1",image(Buffer.from("not an image")))).rejects.toThrow();
    await expect(h.service.uploadAdminContentImage("admin-1",image(Buffer.alloc(10*1024*1024+1)))).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.db.fileObject.create).not.toHaveBeenCalled();
  });
});
