import { api, API_BASE, mallSessionStamp } from "./api";
import { mallStorage } from "./realm";
import { evidenceFile } from "./after-sale-images";

export const MEMBER_PROFILE_ROUTE = "/pages/member-profile/index";
export const MEMBER_PROFILE_API = "/storefront/member-profile";
export type ProfileForm = {
  nickname: string;
  gender: string;
  birthday: string;
  heightCm: string | number;
  weightKg: string | number;
};

export function profileInput(form: ProfileForm, avatarFileId?: string | null) {
  const nickname = form.nickname.trim();
  if (!nickname || nickname.length > 40)
    throw new Error("请填写1至40个字符的昵称");
  if (!["unspecified", "male", "female"].includes(form.gender))
    throw new Error("请选择性别");
  const birthday = form.birthday ? new Date(form.birthday) : null;
  if (
    birthday &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(form.birthday) ||
      !Number.isFinite(birthday.getTime()) ||
      birthday.toISOString().slice(0, 10) !== form.birthday ||
      birthday >= new Date())
  )
    throw new Error("请选择正确的出生日期");
  const input: Record<string, unknown> = {
    nickname,
    gender: form.gender,
    birthday: form.birthday || null,
  };
  for (const [key, label, min, max] of [
    ["heightCm", "身高", 50, 250],
    ["weightKg", "体重", 10, 500],
  ] as const) {
    const text = String(form[key]).trim();
    if (!text) continue;
    const value = Number(text);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(text) ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new Error(`请填写${min}至${max}之间的${label}`);
    input[key] = value;
  }
  if (avatarFileId !== undefined) input.avatarFileId = avatarFileId;
  return input;
}

/** Only update presentation fields; preserve the verified session and contact flags. */
export function cacheMemberProfile(profile: any, stamp: string) {
  const user = mallStorage.get("saidian-user");
  if (stamp !== mallSessionStamp() || !user?.id || profile?.id !== user.id)
    throw new Error("账号已切换，请重新打开个人资料");
  mallStorage.set("saidian-user", {
    ...user,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl || null,
  });
}

export function createMemberProfileClient() {
  const stamp = mallSessionStamp(),
    userId = mallStorage.get("saidian-user")?.id;
  let disposed = false,
    upload: UniApp.UploadTask | undefined;
  const check = () => {
    if (
      disposed ||
      !userId ||
      stamp !== mallSessionStamp() ||
      userId !== mallStorage.get("saidian-user")?.id
    )
      throw new Error("账号或页面已变化，请重新打开个人资料");
  };
  return {
    cancel() {
      disposed = true;
      upload?.abort();
    },
    async load() {
      check();
      const value = await api(MEMBER_PROFILE_API, {
        auth: true,
        sessionStamp: stamp,
      });
      check();
      if (value?.id !== userId) throw new Error("会员资料不匹配，请重试");
      return value;
    },
    async save(input: Record<string, unknown>) {
      check();
      const value = await api(MEMBER_PROFILE_API, {
        method: "PUT",
        auth: true,
        sessionStamp: stamp,
        data: input,
      });
      check();
      cacheMemberProfile(value, stamp);
      return value;
    },
    async uploadAvatar(selected: any): Promise<{ id: string; url: string }> {
      check();
      const file = evidenceFile(selected),
        token = String(mallStorage.get("saidian-token") || "");
      if (!token || mallStorage.get("saidian-user")?.phoneTestMode === true)
        throw new Error("请先使用已验证的会员账号登录");
      return new Promise((resolve, reject) => {
        upload = uni.uploadFile({
          url: API_BASE + MEMBER_PROFILE_API + "/avatar",
          filePath: file.path,
          name: "file",
          timeout: 30000,
          header: { Authorization: "Bearer " + token },
          success(response) {
            try {
              check();
              if (response.statusCode === 401)
                throw new Error("登录已失效，请重新登录后上传");
              if (response.statusCode < 200 || response.statusCode >= 300)
                throw new Error("头像上传失败，请重试");
              const value = JSON.parse(response.data),
                id = String(value?.id || "");
              const origin =
                typeof location === "undefined"
                  ? "https://app.saydian.cn"
                  : location.origin;
              const url = String(value?.url || "");
              if (
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
                url !== `${origin}/api/saydian-app/v2/files/${id}`
              )
                throw new Error("头像上传回执不正确，请重试");
              resolve({ id, url });
            } catch (error) {
              reject(
                error instanceof Error ? error : new Error("头像上传失败"),
              );
            }
          },
          fail() {
            reject(new Error("头像上传未完成，请重试"));
          },
        });
      });
    },
  };
}
