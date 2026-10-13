import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PartnerAdminService } from "./partner-admin.service";

describe("brand partner creation validation", () => {
  it.each(["", "short", "a".repeat(9), "a".repeat(129)])(
    "rejects an invalid password before any database mutation",
    async (password) => {
      const transaction = vi.fn();
      const service = new PartnerAdminService(
        { $transaction: transaction } as any,
        {} as any,
      );
      const result = service.create(
        "synthetic-admin",
        {
          username: "synthetic.partner",
          name: "合成测试伙伴",
          levelId: "11111111-1111-4111-8111-111111111111",
          password,
        },
        "synthetic-request",
      );
      await expect(result).rejects.toBeInstanceOf(BadRequestException);
      await expect(result).rejects.toThrow("密码须为10至128个字符");
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
