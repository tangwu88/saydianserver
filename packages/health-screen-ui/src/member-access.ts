import type { HealthScreenTransport } from "@saydian/app-contracts";
export const ownKey = "saydian.health-screen.session";
export const memberRoot = "/api/saydian-app/v2/member-health-screen";
export const mallRoot = "/api/saidian-mall/v1";
export class ScreenRequestError extends Error {
  constructor(
    message: string,
    readonly response: { status: number; data: { errorKey?: string } },
  ) {
    super(message);
  }
}
export async function request<T>(
  url: string,
  options: {
    token?: string | null;
    data?: unknown;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: options.data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal ?? null,
    headers: {
      ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
      ...(options.data === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(options.data === undefined
      ? {}
      : { body: JSON.stringify(options.data) }),
  });
  const envelope = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ScreenRequestError(envelope.message || "暂时无法访问，请重试", {
      status: response.status,
      data: { errorKey: envelope.errorKey },
    });
  return (url.startsWith(mallRoot + "/") ? envelope : envelope.data) as T;
}
export const sessionKey = () => sessionStorage.getItem(ownKey);
function own<T>(
  path: string,
  params: Record<string, string | number | null | undefined> = {},
  data?: unknown,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v != null) query.set(k, String(v));
  return request<T>(
    memberRoot + "/me" + path + (query.size ? "?" + query : ""),
    { token: sessionKey(), data, signal },
  );
}
export const ownTransport: HealthScreenTransport = {
  profile: (_, signal) => own("/profile", {}, undefined, signal),
  completeProfile: (_, v) => own("/profile", {}, v),
  load: (_, days, signal) => own("", { days }, undefined, signal),
  updates: (_, days, signal) => own("/updates", { days }, undefined, signal),
  records: (_, days, metric, cursor, signal) =>
    own("/records", { days, metric, cursor }, undefined, signal),
  references: (_, cursor, signal) =>
    own("/references", { cursor }, undefined, signal),
  saveReference: (_, v) => own("/references", {}, v),
  voidReference: (_, id, reason) =>
    own("/references/" + encodeURIComponent(id) + "/void", {}, { reason }),
  generate: (_, days, inputDigest, requestKey) =>
    own("/analyses", {}, { days, inputDigest, requestKey }),
  result: (_, id, signal) =>
    own("/analyses/" + encodeURIComponent(id), {}, undefined, signal),
};
export function accessStatus(e: unknown) {
  return (e as { response?: { status?: number; data?: { errorKey?: string } } })
    ?.response;
}
