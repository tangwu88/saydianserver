import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mallRoot,
  memberRoot,
  ownTransport,
  request,
} from "../../../packages/health-screen-ui/src/member-access";

afterEach(() => vi.unstubAllGlobals());

describe("personal screen transport", () => {
  it("reads both the mall SMS challenge and the enveloped screen grant", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ challengeId: "synthetic", expiresIn: 300 }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: 200, data: { token: "screen-session" } }),
      );
    vi.stubGlobal("fetch", send);
    await expect(
      request(mallRoot + "/auth/code/request", { data: {} }),
    ).resolves.toEqual({ challengeId: "synthetic", expiresIn: 300 });
    await expect(
      request(memberRoot + "/login/session", {
        token: "member-session",
        data: {},
      }),
    ).resolves.toEqual({ token: "screen-session" });
  });
  it("reads only the authenticated profile even if a staff-link ID is supplied", async () => {
    const send = vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: 200, data: { missing: ["name"] } }),
      );
    vi.stubGlobal("fetch", send);
    vi.stubGlobal("sessionStorage", { getItem: () => "test-screen-token" });
    await ownTransport.profile(
      "different-member",
      new AbortController().signal,
    );
    expect(send).toHaveBeenCalledWith(
      memberRoot + "/me/profile",
      expect.objectContaining({
        cache: "no-store",
        headers: { Authorization: "Bearer test-screen-token" },
      }),
    );
  });
});
