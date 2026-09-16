import { createHmac } from "node:crypto";
import { safeObject, secureEqual, sha256 } from "../common/crypto";
import { env } from "../common/environment";

export type WechatH5Profile = { nickname: string | null; avatarUrl: string | null };

export function safeWechatProfile(value: unknown): WechatH5Profile {
  const source = safeObject(value);
  const nickname = String(source.nickname ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || null;
  const rawAvatar = String(source.headimgurl ?? source.avatarUrl ?? "").trim();
  let avatarUrl: string | null = null;
  if (rawAvatar && rawAvatar.length <= 1024) {
    try {
      const parsed = new URL(rawAvatar);
      if (parsed.protocol === "https:") avatarUrl = parsed.toString();
    } catch {
      // Invalid provider URLs are ignored.
    }
  }
  return { nickname, avatarUrl };
}

export function signWechatProfile(profile: WechatH5Profile, bindTicket: string): string {
  const payload = Buffer.from(JSON.stringify({ profile, ticketHash: sha256(bindTicket), expiresAt: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${payload}.${profileSignature(payload)}`;
}

export function verifiedWechatProfile(value: unknown, bindTicket: string): WechatH5Profile {
  const proof = typeof value === "string" && value.length <= 4096 ? value : "";
  const parts = proof.split(".");
  if (parts.length !== 2 || !secureEqual(parts[1]!, profileSignature(parts[0]!))) return { nickname: null, avatarUrl: null };
  try {
    const claims = safeObject(JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")));
    if (claims.ticketHash !== sha256(bindTicket) || !Number.isSafeInteger(claims.expiresAt) || Number(claims.expiresAt) <= Date.now()) return { nickname: null, avatarUrl: null };
    return safeWechatProfile(claims.profile);
  } catch {
    return { nickname: null, avatarUrl: null };
  }
}

function profileSignature(payload: string): string {
  return createHmac("sha256", env("ACCESS_TOKEN_SECRET")).update(`wechat-profile-v1.${payload}`).digest("base64url");
}

export function wechatProfileBackfill(
  user: { nickname: string; avatarUrl: string | null },
  profile: WechatH5Profile,
) {
  const placeholder = /^(?:微信用户|Saydian user|赛电用户|用户\d{4})$/;
  return {
    ...(!user.avatarUrl && profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    ...(profile.nickname && placeholder.test(user.nickname) ? { nickname: profile.nickname } : {}),
  };
}
