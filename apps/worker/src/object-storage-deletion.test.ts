import { describe, expect, it, vi } from "vitest";
import { deleteObjectKeys } from "./object-storage-deletion";
import { S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

describe("object storage deletion", () => {
  it("sends the MD5 of the actual serialized XML in the signed request", async () => {
    let captured: any;
    const client = new S3Client({
      endpoint: "http://127.0.0.1:19000", region: "us-east-1", forcePathStyle: true,
      credentials: { accessKeyId: "synthetic-access-key", secretAccessKey: "synthetic-secret-key" },
      requestHandler: { handle: async (request: any) => {
        captured = request;
        return { response: { statusCode: 200, headers: { "content-type": "application/xml" },
          body: Readable.from(['<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>']) } };
      } },
    });
    try {
      await deleteObjectKeys(client, "private-bucket", ["avatar/member/a&b.png", "avatar/member/设备.png"]);
      expect(captured.headers["content-md5"]).toBe(createHash("md5").update(captured.body).digest("base64"));
      expect(captured.headers.authorization).toContain("content-md5");
      expect(String(captured.body)).toContain("a&amp;b.png");
    } finally { client.destroy(); }
  });
  it("batches exact keys without broad prefixes", async () => {
    const send = vi.fn(async () => ({ Errors: [] }));
    const keys = Array.from({ length: 1001 }, (_, index) => `avatar/member/file-${index}.png`);
    await deleteObjectKeys({ send } as any, "private-bucket", keys);
    expect(send).toHaveBeenCalledTimes(2);
    const calls = send.mock.calls as unknown as Array<[{ input: any }]>;
    const first = calls[0]![0].input;
    const second = calls[1]![0].input;
    expect(first).toMatchObject({ Bucket: "private-bucket", Delete: { Quiet: true } });
    expect(first.Delete.Objects).toHaveLength(1000);
    expect(second.Delete.Objects).toEqual([{ Key: keys[1000] }]);
  });

  it("fails the account cleanup when storage reports an object error", async () => {
    const send = vi.fn(async () => ({ Errors: [{ Key: "avatar/member/one.png", Code: "AccessDenied" }] }));
    await expect(deleteObjectKeys({ send } as any, "private-bucket", ["avatar/member/one.png"])).rejects.toThrow("rejected 1 deletion");
  });
});
