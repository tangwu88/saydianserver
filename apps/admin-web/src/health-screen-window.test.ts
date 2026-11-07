import { afterEach, expect, it, vi } from "vitest";
import { openHealthScreen } from "@saydian/health-screen-ui/open-window";
const id = "92f6efec-8b47-4f33-a4bb-8710254dd8d3";
afterEach(() => vi.unstubAllGlobals());
it("severs the opener before loading the protected internal screen", () => {
  const opened = {
    opener: {} as object | null,
    location: { replace: vi.fn(() => expect(opened.opener).toBeNull()) },
  };
  const open = vi.fn(() => opened);
  vi.stubGlobal("window", { open });
  openHealthScreen("vip", id);
  expect(open).toHaveBeenCalledWith("about:blank", "_blank");
  expect(opened.location.replace).toHaveBeenCalledWith(
    `/vip/members/${id}/health-screen`,
  );
});
it("falls back to the current authenticated tab when popups are blocked", () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { open: () => null, location: { assign } });
  openHealthScreen("admin", id);
  expect(assign).toHaveBeenCalledWith(`/admin/members/${id}/health-screen`);
});
it("rejects injected paths before opening a window", () => {
  const open = vi.fn();
  vi.stubGlobal("window", { open });
  expect(() => openHealthScreen("admin", "https://example.com/")).toThrow();
  expect(() =>
    openHealthScreen("https://example.com" as "admin", id),
  ).toThrow();
  expect(open).not.toHaveBeenCalled();
});
