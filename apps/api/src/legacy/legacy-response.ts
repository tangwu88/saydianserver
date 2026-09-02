import type { SessionContract } from "@saydian/app-contracts";

export function legacySuccess<T>(data: T, message = "OK") {
  return { code: 200, message, data };
}

export function legacySession(
  session: SessionContract,
  member: Record<string, unknown>,
) {
  return legacySuccess({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expiration_time: 15 * 60,
    member,
  });
}
