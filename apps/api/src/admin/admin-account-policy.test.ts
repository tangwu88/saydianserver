import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { isEnabledSuperAdmin, protectLastSuperAdmin } from "./admin-account-policy";

type Row = { id: string; active: boolean; role: string; roles: string[] };
const row = (id: string, roles = ["SUPER_ADMIN"]): Row => ({ id, active: true, role: "SUPER_ADMIN", roles });
describe("last enabled super administrator", () => {
  it("mirrors server effective roles, including legacy fallback", () => {
    assert.equal(isEnabledSuperAdmin(row("a", [])), true);
    assert.equal(isEnabledSuperAdmin(row("a", ["READ_ONLY"])), false);
    assert.equal(isEnabledSuperAdmin({ ...row("a"), active: false }), false);
    assert.equal(isEnabledSuperAdmin(row("a", ["FINANCE", "SUPER_ADMIN"])), true);
  });
  it("blocks demotion or deactivation of the last administrator after acquiring its lock", async () => {
    let locked = false;
    const tx = {
      $executeRaw: async () => { locked = true; },
      adminUser: {
        findUnique: async () => { assert(locked); return row("a"); },
        findMany: async () => [],
      },
    } as unknown as Prisma.TransactionClient;
    await assert.rejects(protectLastSuperAdmin(tx,"a",{active:false}), /至少保留/);
    await assert.rejects(protectLastSuperAdmin(tx,"a",{roles:["READ_ONLY"]}), /至少保留/);
    await protectLastSuperAdmin(tx,"a",{roles:["FINANCE","SUPER_ADMIN"]});
  });
  it("serializes two concurrent demotions: at most one succeeds and one super administrator remains", async () => {
    const rows = [row("a"), row("b", [])];
    let tail = Promise.resolve();
    const demote = async (id: string) => {
      let release = () => {};
      const tx = {
        $executeRaw: async () => {
          const previous = tail;
          tail = new Promise<void>(resolve => { release = resolve; });
          await previous;
        },
        adminUser: {
          findUnique: async () => rows.find(item => item.id === id),
          findMany: async () => rows.filter(item => item.id !== id && item.active),
        },
      } as unknown as Prisma.TransactionClient;
      try {
        await protectLastSuperAdmin(tx,id,{roles:["READ_ONLY"]});
        Object.assign(rows.find(item => item.id === id)!,{role:"READ_ONLY",roles:["READ_ONLY"]});
      } finally { release(); }
    };
    const outcomes = await Promise.allSettled([demote("a"), demote("b")]);
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length,1);
    assert.equal(outcomes.filter(item => item.status === "rejected").length,1);
    assert.equal(rows.filter(isEnabledSuperAdmin).length,1);
  });
});
