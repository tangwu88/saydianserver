import { describe, expect, it, vi } from "vitest";
import { compare } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { AdminService } from "./admin.service";

const input = {
  username: "support.test",
  displayName: "测试客服",
  password: "synthetic-password-12",
  roles: ["CUSTOMER_SERVICE"],
  active: false,
};
function harness() {
  const adminUser = {
    create: vi.fn(async ({ data }: any) => ({
      id: "synthetic-admin",
      ...data,
    })),
  };
  return {
    adminUser,
    service: new AdminService({ adminUser } as any, {} as any),
  };
}

describe("admin account creation", () => {
  it("creates a valid account with its selected roles and enabled state, hashing the password", async () => {
    const h = harness();
    await h.service.createAdmin(input);
    const call = h.adminUser.create.mock.calls[0]![0];
    expect(call.data).toMatchObject({
      username: input.username,
      displayName: input.displayName,
      role: "CUSTOMER_SERVICE",
      roles: ["CUSTOMER_SERVICE"],
      active: false,
    });
    expect(await compare(input.password, call.data.passwordHash)).toBe(true);
    expect(call.select).not.toHaveProperty("passwordHash");
  });
  it.each([
    [{ username: "帐号" }, "admin_username_invalid"],
    [{ displayName: " " }, "admin_display_name_invalid"],
    [{ password: "short" }, "admin_password_invalid"],
    [{ active: "false" }, "admin_active_invalid"],
    [{ roles: [] }, "admin_roles_invalid"],
    [{ roles: ["NO_SUCH_ROLE"] }, "admin_roles_invalid"],
  ])(
    "returns an actionable validation error before writing: %j",
    async (change, errorKey) => {
      const h = harness();
      await expect(
        h.service.createAdmin({ ...input, ...change }),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ errorKey }),
      });
      expect(h.adminUser.create).not.toHaveBeenCalled();
    },
  );
  it("maps a concurrent duplicate username to a clear conflict without exposing database details", async () => {
    const h = harness();
    h.adminUser.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("secret database detail", {
        code: "P2002",
        clientVersion: "6",
      }),
    );
    await expect(h.service.createAdmin(input)).rejects.toMatchObject({
      status: 409,
      response: {
        errorKey: "admin_username_exists",
        message: "后台账号已存在，请换一个账号",
      },
    });
  });
});
