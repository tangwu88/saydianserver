import { BadRequestException, Injectable } from "@nestjs/common";
import { Gender, Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  profile(userId: string) {
    return this.auth.profile(userId);
  }

  async saveProfile(userId: string, input: unknown) {
    const body = safeObject(input);
    const data: Prisma.UserUpdateInput = {};
    if (body.nickname !== undefined) {
      const nickname = String(body.nickname).trim();
      if (!nickname || nickname.length > 40) throw new BadRequestException("昵称不正确");
      data.nickname = nickname;
    }
    if (body.avatarUrl !== undefined || body.head_portrait !== undefined) {
      const avatarUrl = String(body.avatarUrl ?? body.head_portrait ?? "").trim();
      if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
        throw new BadRequestException("头像地址不正确");
      }
      data.avatarUrl = avatarUrl || null;
    }
    if (body.gender !== undefined || body.sex !== undefined) {
      const gender = String(body.gender ?? body.sex).toLowerCase();
      data.gender =
        gender === "male" || gender === "1"
          ? Gender.MALE
          : gender === "female" || gender === "2"
            ? Gender.FEMALE
            : Gender.UNSPECIFIED;
    }
    if (body.birthday !== undefined) {
      const birthday = body.birthday ? new Date(String(body.birthday)) : null;
      if (birthday && (Number.isNaN(birthday.valueOf()) || birthday >= new Date())) {
        throw new BadRequestException("出生日期不正确");
      }
      data.birthday = birthday;
    }
    for (const [field, legacyField, min, max] of [
      ["heightCm", "height", 50, 250],
      ["weightKg", "weight", 10, 500],
    ] as const) {
      if (body[field] !== undefined || body[legacyField] !== undefined) {
        const value = Number(body[field] ?? body[legacyField]);
        if (!Number.isFinite(value) || value < min || value > max) {
          throw new BadRequestException(field === "heightCm" ? "身高不正确" : "体重不正确");
        }
        data[field] = new Prisma.Decimal(value);
      }
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.auth.profile(userId);
  }

  async goals(userId: string) {
    const goal = await this.prisma.activityGoal.findUnique({ where: { userId } });
    return {
      steps: goal?.steps ?? null,
      distanceMeters: goal?.distanceMeters ?? null,
      caloriesKcal: goal?.caloriesKcal ?? null,
    };
  }

  async saveGoals(userId: string, input: unknown) {
    const body = safeObject(input);
    const steps = integerOrNull(body.steps, 100, 100_000, "步数目标不正确");
    const distanceMeters = integerOrNull(
      body.distanceMeters ?? body.juli,
      100,
      200_000,
      "距离目标不正确",
    );
    const caloriesKcal = integerOrNull(
      body.caloriesKcal ?? body.reliang,
      10,
      20_000,
      "热量目标不正确",
    );
    await this.prisma.activityGoal.upsert({
      where: { userId },
      create: { userId, steps, distanceMeters, caloriesKcal },
      update: { steps, distanceMeters, caloriesKcal },
    });
    return this.goals(userId);
  }
}

function integerOrNull(
  value: unknown,
  min: number,
  max: number,
  message: string,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new BadRequestException(message);
  }
  return result;
}
