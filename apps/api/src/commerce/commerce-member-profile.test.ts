import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CommerceMemberProfileController } from "./commerce-member-profile.controller";

const member = { id: "member-from-session", sessionId: "verified-session" };
const avatarId = "00000000-0000-4000-8000-000000000071";
function fixture() {
  const members = {
    profile: vi.fn(async (id) => ({ id, nickname: "同一App会员" })),
    saveProfile: vi.fn(async (id, data) => ({ id, ...data })),
  };
  const support = {
    uploadSayRingAvatar: vi.fn(async () => ({ id: avatarId })),
  };
  const prisma = {
    fileObject: { findFirst: vi.fn(async () => ({ id: avatarId })) },
  };
  return {
    members,
    support,
    prisma,
    controller: new CommerceMemberProfileController(
      members as any,
      support as any,
      prisma as any,
    ),
  };
}
describe("商城与App共用会员资料", () => {
  it("requires verified user sessions for all profile and avatar routes", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CommerceMemberProfileController),
    ).toContain(UserAuthGuard);
  });
  it("always reads the session owner through the existing App service", async () => {
    const h = fixture();
    await expect(h.controller.profile(member)).resolves.toMatchObject({
      id: member.id,
    });
    expect(h.members.profile).toHaveBeenCalledWith(member.id);
  });
  it("whitelists personal fields and cannot change another member, role, contact verification or partner ownership", async () => {
    const h = fixture();
    await h.controller.save(member, {
      nickname: "新昵称",
      gender: "female",
      birthday: "1995-01-02",
      heightCm: 165,
      weightKg: 55,
      id: "another-member",
      mobile: "+8613800000000",
      mobileVerifiedAt: "now",
      role: "SUPER_ADMIN",
      partnerId: "another-partner",
      avatarUrl: "https://evil.invalid/a.png",
    });
    expect(h.members.saveProfile).toHaveBeenCalledWith(member.id, {
      nickname: "新昵称",
      gender: "female",
      birthday: "1995-01-02",
      heightCm: 165,
      weightKg: 55,
    });
  });
  it("accepts only active avatar files owned by the current member", async () => {
    const h = fixture();
    await h.controller.save(member, { avatarFileId: avatarId });
    expect(h.prisma.fileObject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: avatarId,
          ownerUserId: member.id,
          purpose: "avatar",
          status: "ACTIVE",
        }),
      }),
    );
    expect(h.members.saveProfile).toHaveBeenCalledWith(member.id, {
      avatarUrl: expect.stringContaining(
        `/api/saydian-app/v2/files/${avatarId}`,
      ),
    });
    h.prisma.fileObject.findFirst.mockResolvedValueOnce(null as any);
    await expect(
      h.controller.save(member, { avatarFileId: avatarId }),
    ).rejects.toThrow("本人上传");
    expect(h.members.saveProfile).toHaveBeenCalledTimes(1);
    await expect(
      h.controller.save(member, { avatarFileId: "https://evil.invalid/a.png" }),
    ).rejects.toThrow();
  });
  it("allows removing a photo without changing other personal fields", async () => {
    const h = fixture();
    await h.controller.save(member, { avatarFileId: null });
    expect(h.members.saveProfile).toHaveBeenCalledWith(member.id, {
      avatarUrl: "",
    });
  });
  it("rejects disguised or oversized avatar bytes before the App upload service", () => {
    const h = fixture();
    for (const file of [
      undefined,
      {
        buffer: Buffer.from("<svg>script</svg>"),
        size: 17,
        mimetype: "image/png",
      },
      {
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
        size: 10 * 1024 * 1024 + 1,
        mimetype: "image/jpeg",
      },
    ])
      expect(() => h.controller.avatar(member, file as any)).toThrow();
    expect(h.support.uploadSayRingAvatar).not.toHaveBeenCalled();
  });
});
