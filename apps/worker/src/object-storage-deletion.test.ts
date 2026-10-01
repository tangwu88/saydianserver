import { describe, expect, it, vi } from "vitest";
import { deleteObjectKeys } from "./object-storage-deletion";

describe("object storage deletion", () => {
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
