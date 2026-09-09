import { afterEach, describe, expect, it, vi } from "vitest";
import { api, clearAdminToken, getAdminRoles, hasAdminToken, responseData, setAdminRoles, setAdminToken } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("admin API envelope", () => {
  it("reads only the standardized data field", () => {
    expect(
      responseData<{ members: number }>({
        data: {
          code: 200,
          message: "OK",
          data: { members: 12 },
          timestamp: 1,
          requestId: "request-1",
        },
      }),
    ).toEqual({ members: 12 });
  });

  it("uses the international API for all admin resources", () => {
    expect(api.defaults.baseURL).toBe("/global/api/saydian-app/admin/v1");
  });

  it("keeps international tokens and roles separate from previous admin sessions", async () => {
    const storage = new Map([["saydian-admin-token", "synthetic-domestic-token"], ["saydian-admin-roles", '["SUPER_ADMIN"]']]);
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    expect(hasAdminToken()).toBe(false); expect(getAdminRoles()).toEqual([]);
    const adapter = vi.fn(async (config: any) => ({ data: {}, status: 200, statusText: "OK", headers: {}, config }));
    await api.get("/members", { adapter }); expect(adapter.mock.calls[0]![0].headers.Authorization).toBeUndefined();
    setAdminToken("synthetic-global-token"); setAdminRoles(["APP_OPERATIONS"]);
    await api.get("/members", { adapter }); expect(adapter.mock.calls[1]![0].headers.Authorization).toBe("Bearer synthetic-global-token");
    expect(storage.get("saydian-global-admin-token")).toBe("synthetic-global-token");
    expect(getAdminRoles()).toEqual(["APP_OPERATIONS"]);
    clearAdminToken(); expect(hasAdminToken()).toBe(false); expect(getAdminRoles()).toEqual([]);
    expect(storage.get("saydian-admin-token")).toBe("synthetic-domestic-token");
  });
});
